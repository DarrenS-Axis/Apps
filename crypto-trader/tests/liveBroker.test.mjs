import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveBroker } from '../src/exec/liveBroker.js';
import { InstrumentCatalogue } from '../src/exchange/instruments.js';
import { loadConfig } from '../src/config.js';
import { configureLogging } from '../src/log.js';

configureLogging({ level: 'error' });

const config = loadConfig('/nonexistent-config.json', {
  instruments: ['BTC_USD'],
  quoteCurrency: 'USD',
  execution: {
    orderType: 'LIMIT',
    limitOffsetBps: 10,
    slippageBps: 10,
    takerFeeBps: 10,
    makerFeeBps: 10,
    maxSpreadBps: 50,
  },
});

const FILLED = {
  order_id: '123',
  status: 'FILLED',
  cumulative_quantity: '0.005',
  cumulative_value: '500',
  cumulative_fee: '0.5',
  avg_price: '100000',
  fee_instrument_name: 'USD',
};

/** A stand-in exchange whose behaviour each test dictates. */
class FakeClient {
  constructor(overrides = {}) {
    this.submitted = [];
    this.createCalls = 0;
    Object.assign(this, overrides);
  }

  async getInstruments() {
    return [{
      symbol: 'BTC_USD',
      inst_type: 'CCY_PAIR',
      base_ccy: 'BTC',
      quote_ccy: 'USD',
      price_tick_size: '0.01',
      qty_tick_size: '0.00001',
      quote_decimals: 2,
      quantity_decimals: 5,
      tradable: true,
    }];
  }

  async getUserBalance() {
    return [{
      instrument_name: 'USD',
      position_balances: [
        { instrument_name: 'USD', quantity: '1000', reserved_qty: '200' },
        { instrument_name: 'BTC', quantity: '0.01', reserved_qty: '0.002' },
      ],
    }];
  }

  async privatePost(method, params) {
    if (method === 'private/create-order') {
      this.createCalls += 1;
      this.submitted.push(params);
      if (this.onCreate) return this.onCreate(params);
      return { order_id: '123', client_oid: params.client_oid };
    }
    throw new Error(`unexpected call ${method}`);
  }

  async getOrderDetail() {
    return FILLED;
  }

  async getOrderByClientOid(clientOid) {
    if (this.foundByClientOid) return { ...FILLED, client_oid: clientOid };
    throw new Error('not found');
  }

  async getOpenOrders() {
    return this.openOrders ?? [];
  }

  async cancelOrder() {}
}

async function makeBroker(client) {
  const catalogue = new InstrumentCatalogue(client);
  await catalogue.refresh();
  return new LiveBroker({ client, catalogue, config });
}

test('available balances subtract what is already reserved', async () => {
  const broker = await makeBroker(new FakeClient());
  assert.equal(await broker.availableQuote(), 800);
  assert.equal(await broker.availableBase('BTC_USD'), 0.008);
});

test('a limit buy prices through the touch and leaves room for the fee', async () => {
  const client = new FakeClient();
  const broker = await makeBroker(client);
  await broker.buy({ instrument: 'BTC_USD', quoteAmount: 500, price: 100_000 });

  const order = client.submitted[0];
  assert.equal(order.side, 'BUY');
  assert.equal(order.type, 'LIMIT');
  assert.equal(order.time_in_force, 'IMMEDIATE_OR_CANCEL');
  // 10bp above the mark, rounded to the price tick.
  assert.equal(order.price, '100100.00');
  // Total outlay including the fee must stay inside the budget.
  const outlay = Number(order.quantity) * Number(order.price) * (1 + 10 / 10_000);
  assert.ok(outlay <= 500 + 1e-6, `outlay ${outlay} exceeded the 500 budget`);
  assert.equal(typeof order.quantity, 'string');
});

test('a sell is capped at the quantity actually held', async () => {
  const client = new FakeClient();
  const broker = await makeBroker(client);
  // Ask for far more than the 0.008 available.
  await broker.sell({ instrument: 'BTC_USD', quantity: 5, price: 100_000 });
  assert.equal(client.submitted[0].quantity, '0.00800');
  assert.equal(client.submitted[0].side, 'SELL');
});

test('an order too small to make one tick is refused before it is sent', async () => {
  const client = new FakeClient();
  const broker = await makeBroker(client);
  await assert.rejects(
    () => broker.buy({ instrument: 'BTC_USD', quoteAmount: 0.0001, price: 100_000 }),
    /below one quantity tick/,
  );
  assert.equal(client.createCalls, 0, 'a dust order was sent to the exchange');
});

test('a create-order failure is not retried blindly', async () => {
  const client = new FakeClient({
    onCreate() {
      throw new Error('socket hang up');
    },
  });
  const broker = await makeBroker(client);
  await assert.rejects(() => broker.buy({ instrument: 'BTC_USD', quoteAmount: 500, price: 100_000 }));
  assert.equal(client.createCalls, 1, 'the order was submitted more than once');
});

test('an order that landed despite a lost response is picked up, not abandoned', async () => {
  // The dangerous case: the order filled but we never saw the reply. Treating that
  // as a failure would leave a real position with no stop on it.
  const client = new FakeClient({
    foundByClientOid: true,
    onCreate() {
      throw new Error('socket hang up');
    },
  });
  const broker = await makeBroker(client);
  const fill = await broker.buy({ instrument: 'BTC_USD', quoteAmount: 500, price: 100_000 });

  assert.equal(fill.quantity, 0.005);
  assert.equal(fill.price, 100_000);
  assert.equal(fill.simulated, false);
});

test('an order resting on the book after a lost response is also picked up', async () => {
  let clientOid;
  const client = new FakeClient({
    onCreate(params) {
      clientOid = params.client_oid;
      throw new Error('gateway timeout');
    },
  });
  client.getOpenOrders = async () => [{ order_id: '999', client_oid: clientOid }];
  const broker = await makeBroker(client);
  const fill = await broker.buy({ instrument: 'BTC_USD', quoteAmount: 500, price: 100_000 });
  assert.equal(fill.quantity, 0.005);
});

test('a fee charged in the base currency is valued in quote', async () => {
  const client = new FakeClient();
  client.getOrderDetail = async () => ({ ...FILLED, fee_instrument_name: 'BTC', cumulative_fee: '0.00001' });
  const broker = await makeBroker(client);
  const fill = await broker.buy({ instrument: 'BTC_USD', quoteAmount: 500, price: 100_000 });
  assert.equal(fill.fee, 0.00001 * 100_000);
});
