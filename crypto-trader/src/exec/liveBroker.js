/**
 * Live broker -- this one spends real money.
 *
 * Default execution is a marketable LIMIT order with IMMEDIATE_OR_CANCEL: priced
 * through the touch by `limitOffsetBps` so it fills like a market order, but with
 * a hard ceiling on what it can pay. A plain market order has no such ceiling, and
 * on a thin book at an awkward moment that difference is the whole ball game. It
 * also sidesteps a real wart in the API, where a spot MARKET BUY is sized in quote
 * currency (`notional`) while every other order is sized in base units.
 *
 * The trade-off is that an IOC order can come back partly filled or not filled at
 * all. Both are handled: the caller is told what actually filled, not what was asked
 * for, and the engine records the position from the fill.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Broker } from './broker.js';
import { formatQuantity, formatPrice, isDust } from './sizing.js';
import { log } from '../log.js';

const FILL_POLL_MS = 500;
const FILL_TIMEOUT_MS = 30_000;
const SETTLED = new Set(['FILLED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED']);

export class LiveBroker extends Broker {
  /**
   * @param {object} opts
   * @param {import('../exchange/client.js').CryptoComClient} opts.client
   * @param {import('../exchange/instruments.js').InstrumentCatalogue} opts.catalogue
   * @param {object} opts.config
   */
  constructor({ client, catalogue, config }) {
    super();
    this.client = client;
    this.catalogue = catalogue;
    this.config = config;
    this.quoteCurrency = config.quoteCurrency;
  }

  /** Spendable balance per currency, from the exchange's position balances. */
  async #balances() {
    const accounts = await this.client.getUserBalance();
    const balances = new Map();
    for (const account of accounts) {
      for (const position of account.position_balances ?? []) {
        const quantity = Number(position.quantity ?? 0);
        const reserved = Number(position.reserved_qty ?? 0);
        // Anything reserved is already committed to a resting order.
        balances.set(position.instrument_name, Math.max(0, quantity - reserved));
      }
    }
    return balances;
  }

  async availableQuote() {
    const balances = await this.#balances();
    return balances.get(this.quoteCurrency) ?? 0;
  }

  async availableBase(instrument) {
    const { baseCurrency } = this.catalogue.get(instrument);
    const balances = await this.#balances();
    return balances.get(baseCurrency) ?? 0;
  }

  async buy({ instrument, quoteAmount, price }) {
    const meta = this.catalogue.get(instrument);
    const { orderType, limitOffsetBps, takerFeeBps } = this.config.execution;

    if (orderType === 'MARKET') {
      // Spot market buys are sized in quote currency on this exchange.
      const notional = Number(quoteAmount).toFixed(meta.quoteDecimals ?? 2);
      return this.#submit({
        instrument,
        side: 'BUY',
        type: 'MARKET',
        extra: { notional },
        askedQuantity: null,
      });
    }

    const limitPrice = formatPrice(price * (1 + limitOffsetBps / 10_000), meta.priceTickSize);
    // Leave room for the fee so the total outlay stays inside the budget.
    const budget = quoteAmount / (1 + takerFeeBps / 10_000);
    const quantity = formatQuantity(budget / Number(limitPrice), meta.qtyTickSize);
    if (isDust(quantity)) {
      throw new Error(
        `${quoteAmount.toFixed(2)} ${this.quoteCurrency} is below one quantity tick of ${instrument} at ${price}`,
      );
    }

    return this.#submit({
      instrument,
      side: 'BUY',
      type: 'LIMIT',
      extra: { quantity, price: limitPrice, time_in_force: 'IMMEDIATE_OR_CANCEL' },
      askedQuantity: Number(quantity),
    });
  }

  async sell({ instrument, quantity, price }) {
    const meta = this.catalogue.get(instrument);
    const { orderType, limitOffsetBps } = this.config.execution;

    // Never try to sell more than the exchange says we hold; fees and rounding
    // mean the position we think we have can be a tick larger than reality.
    const held = await this.availableBase(instrument);
    const sellable = formatQuantity(Math.min(quantity, held), meta.qtyTickSize);
    if (isDust(sellable)) {
      throw new Error(`nothing sellable in ${instrument} (holding ${held})`);
    }

    if (orderType === 'MARKET') {
      return this.#submit({
        instrument,
        side: 'SELL',
        type: 'MARKET',
        extra: { quantity: sellable },
        askedQuantity: Number(sellable),
      });
    }

    const limitPrice = formatPrice(price * (1 - limitOffsetBps / 10_000), meta.priceTickSize);
    return this.#submit({
      instrument,
      side: 'SELL',
      type: 'LIMIT',
      extra: { quantity: sellable, price: limitPrice, time_in_force: 'IMMEDIATE_OR_CANCEL' },
      askedQuantity: Number(sellable),
    });
  }

  /** Place an order and wait for it to reach a settled state. */
  async #submit({ instrument, side, type, extra, askedQuantity }) {
    const clientOid = randomUUID();
    log.info('placing order', { instrument, side, type, ...extra, client_oid: clientOid });

    // Deliberately not retried. A retry whose predecessor actually succeeded would
    // either open a second position or be rejected as a duplicate -- and a rejection
    // would leave us believing the order failed while it sits filled on the exchange.
    // Instead, on any failure we go and find out what really happened.
    let response;
    try {
      response = await this.client.privatePost(
        'private/create-order',
        { instrument_name: instrument, side, type, client_oid: clientOid, ...extra },
        { retryable: false },
      );
    } catch (err) {
      const recovered = await this.#reconcile(clientOid, instrument, err);
      if (!recovered) throw err;
      response = recovered;
    }

    const orderId = response.order_id ?? response.orderId;
    if (!orderId) throw new Error('the exchange accepted the order but returned no order_id');

    const detail = await this.#awaitSettlement(orderId, instrument);
    const filled = Number(detail.cumulative_quantity ?? 0);
    const value = Number(detail.cumulative_value ?? 0);
    const fee = Number(detail.cumulative_fee ?? 0);
    const avgPrice = filled > 0 ? Number(detail.avg_price ?? value / filled) : 0;

    if (filled === 0) {
      log.warn('order did not fill', { instrument, side, status: detail.status, order_id: orderId });
    } else if (askedQuantity !== null && filled < askedQuantity * 0.999) {
      log.warn('partial fill', { instrument, side, asked: askedQuantity, filled, order_id: orderId });
    }

    return {
      quantity: filled,
      price: avgPrice,
      // Fees can be charged in the base currency on a buy; value it at the fill price.
      fee: detail.fee_instrument_name === this.quoteCurrency ? fee : fee * (avgPrice || 0),
      orderId: String(orderId),
      status: detail.status,
      simulated: false,
    };
  }

  /**
   * Work out whether an order we failed to get a response for actually landed.
   *
   * The dangerous case is a request that reached the exchange and filled, but whose
   * response we never saw: treating that as a failure leaves a real position nobody
   * is tracking, with no stop on it. The client order id is what lets us ask.
   */
  async #reconcile(clientOid, instrument, cause) {
    log.warn('order submission failed; checking whether it landed', {
      instrument,
      client_oid: clientOid,
      error: cause.message,
    });

    try {
      const found = await this.client.getOrderByClientOid(clientOid);
      if (found?.order_id) {
        log.warn('the order did land; carrying on with it', {
          order_id: found.order_id,
          status: found.status,
        });
        return found;
      }
    } catch (err) {
      log.debug('lookup by client order id found nothing', { error: err.message });
    }

    try {
      const open = await this.client.getOpenOrders(instrument);
      const match = open.find((order) => order.client_oid === clientOid);
      if (match) {
        log.warn('the order is resting on the book; carrying on with it', { order_id: match.order_id });
        return match;
      }
    } catch (err) {
      log.debug('could not list open orders', { error: err.message });
    }

    log.info('the order did not reach the exchange; nothing was opened', { client_oid: clientOid });
    return null;
  }

  async #awaitSettlement(orderId, instrument) {
    const deadline = Date.now() + FILL_TIMEOUT_MS;
    let last = null;
    while (Date.now() < deadline) {
      await sleep(FILL_POLL_MS);
      try {
        last = await this.client.getOrderDetail(orderId);
        if (SETTLED.has(String(last.status).toUpperCase())) return last;
      } catch (err) {
        log.warn('could not read the order yet', { order_id: orderId, error: err.message });
      }
    }

    // An IOC order should never reach here. If it somehow rests on the book,
    // pull it rather than leaving an order nobody is tracking.
    log.error('order did not settle in time, cancelling', { order_id: orderId, instrument });
    try {
      await this.client.cancelOrder({ instrumentName: instrument, orderId });
    } catch (err) {
      log.error('cancel failed; check the exchange by hand', { order_id: orderId, error: err.message });
    }
    return last ?? { status: 'UNKNOWN', cumulative_quantity: 0, cumulative_value: 0, cumulative_fee: 0 };
  }

  async cancelAll(instrument) {
    try {
      await this.client.cancelAllOrders(instrument);
    } catch (err) {
      log.warn('cancel-all failed', { instrument, error: err.message });
    }
  }
}
