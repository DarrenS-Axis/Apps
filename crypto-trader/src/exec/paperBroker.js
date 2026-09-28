/**
 * Simulated broker.
 *
 * Runs the whole engine against fake balances held in the state file, while still
 * pulling real prices from the exchange. Fees and slippage are charged at the
 * configured rates so the reported P&L is not the fantasy that "fills at the mid,
 * for free" would give you.
 *
 * What it still cannot model: order book depth, partial fills, outages, and the
 * fact that your own order would have moved the price. Paper results are a sanity
 * check on the logic, not a forecast of returns.
 */
import { randomUUID } from 'node:crypto';
import { Broker, feeFor, withSlippage } from './broker.js';
import { formatQuantity, isDust } from './sizing.js';
import { log } from '../log.js';

export class PaperBroker extends Broker {
  /**
   * @param {object} opts
   * @param {import('../state/store.js').StateStore} opts.store
   * @param {import('../exchange/instruments.js').InstrumentCatalogue} opts.catalogue
   * @param {object} opts.config
   */
  constructor({ store, catalogue, config }) {
    super();
    this.store = store;
    this.catalogue = catalogue;
    this.config = config;
    this.quoteCurrency = config.quoteCurrency;
  }

  get balances() {
    return this.store.state.paperBalances;
  }

  async availableQuote() {
    return this.balances[this.quoteCurrency] ?? 0;
  }

  async availableBase(instrument) {
    const { baseCurrency } = this.catalogue.get(instrument);
    return this.balances[baseCurrency] ?? 0;
  }

  /**
   * @param {{instrument: string, quoteAmount: number, price: number}} order
   * @returns {Promise<import('./broker.js').Fill>}
   */
  async buy({ instrument, quoteAmount, price }) {
    const meta = this.catalogue.get(instrument);
    const { slippageBps, takerFeeBps } = this.config.execution;

    const fillPrice = withSlippage(price, 'buy', slippageBps);
    // Size from the amount left after the fee, so the total spend matches the budget.
    const spendable = quoteAmount / (1 + takerFeeBps / 10_000);
    const quantity = Number(formatQuantity(spendable / fillPrice, meta.qtyTickSize));

    if (isDust(String(quantity))) {
      throw new Error(
        `${quoteAmount.toFixed(2)} ${this.quoteCurrency} is below one quantity tick of ${instrument} at ${price}`,
      );
    }

    const notional = quantity * fillPrice;
    const fee = feeFor(notional, takerFeeBps);
    const cost = notional + fee;

    const available = await this.availableQuote();
    if (cost > available + 1e-9) {
      throw new Error(`simulated balance ${available.toFixed(2)} cannot cover ${cost.toFixed(2)}`);
    }

    this.balances[this.quoteCurrency] = available - cost;
    this.balances[meta.baseCurrency] = (this.balances[meta.baseCurrency] ?? 0) + quantity;
    this.store.save();

    log.debug('simulated buy', { instrument, quantity, price: fillPrice, fee });
    return { quantity, price: fillPrice, fee, orderId: `paper-${randomUUID()}`, simulated: true };
  }

  /**
   * @param {{instrument: string, quantity: number, price: number}} order
   * @returns {Promise<import('./broker.js').Fill>}
   */
  async sell({ instrument, quantity, price }) {
    const meta = this.catalogue.get(instrument);
    const { slippageBps, takerFeeBps } = this.config.execution;

    const held = await this.availableBase(instrument);
    const sellable = Number(formatQuantity(Math.min(quantity, held), meta.qtyTickSize));
    if (isDust(String(sellable))) {
      throw new Error(`nothing to sell in ${instrument} (holding ${held})`);
    }

    const fillPrice = withSlippage(price, 'sell', slippageBps);
    const notional = sellable * fillPrice;
    const fee = feeFor(notional, takerFeeBps);

    this.balances[meta.baseCurrency] = held - sellable;
    this.balances[this.quoteCurrency] = (this.balances[this.quoteCurrency] ?? 0) + notional - fee;
    this.store.save();

    log.debug('simulated sell', { instrument, quantity: sellable, price: fillPrice, fee });
    return { quantity: sellable, price: fillPrice, fee, orderId: `paper-${randomUUID()}`, simulated: true };
  }
}
