/** Shared fixtures: a fake exchange, so the engine can be driven without a network. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempPaths(prefix = 'cdc-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, state: join(dir, 'state.json'), journal: join(dir, 'trades.ndjson') };
}

/** Candles from a list of closes, with a small deterministic range around each. */
export function candlesFrom(closes, { start = 1_700_000_000_000, step = 900_000, spread = 0.002 } = {}) {
  return closes.map((close, i) => ({
    time: start + i * step,
    open: i === 0 ? close : closes[i - 1],
    high: close * (1 + spread),
    low: close * (1 - spread),
    close,
    volume: 10,
  }));
}

/**
 * A cyclical price path with a mild uptrend.
 *
 * Crossover strategies need price to actually change direction; a smooth ramp
 * crosses once during warmup and then never again, which makes for a fixture that
 * silently tests nothing. The long cycle here produces several round trips.
 */
export function cyclical(bars = 160, base = 100) {
  const closes = [];
  for (let i = 0; i < bars; i++) {
    const cycle = Math.sin(i / 9) * 0.14;
    const ripple = Math.sin(i / 2.5) * 0.02;
    const drift = (i / bars) * 0.1;
    closes.push(base * (1 + cycle + ripple + drift));
  }
  return closes;
}

/** Cyclical long enough to get a position on, then a cliff only a stop can catch. */
export function cyclicalThenCrash(bars = 60, dropPct = 40) {
  const closes = cyclical(bars);
  const last = closes.at(-1);
  closes.push(last * (1 - dropPct / 100));
  return closes;
}

const INSTRUMENT = {
  symbol: 'BTC_USD',
  inst_type: 'CCY_PAIR',
  base_ccy: 'BTC',
  quote_ccy: 'USD',
  price_tick_size: '0.01',
  qty_tick_size: '0.00001',
  quote_decimals: 2,
  quantity_decimals: 5,
  tradable: true,
};

/**
 * Stands in for CryptoComClient. `advance()` reveals one more candle, which is how
 * a test walks the engine forward in time.
 */
export class FakeClient {
  constructor(candles, { symbol = 'BTC_USD', spreadBps = 5 } = {}) {
    this.allCandles = candles;
    this.symbol = symbol;
    this.spreadBps = spreadBps;
    this.visible = candles.length;
    this.now = candles.at(-1).time + 900_000;
    this.calls = [];
  }

  /** How many candles the client will admit to having. */
  reveal(count) {
    this.visible = Math.min(count, this.allCandles.length);
    this.now = this.allCandles[this.visible - 1].time + 900_000;
  }

  advance() {
    this.reveal(this.visible + 1);
  }

  get candles() {
    return this.allCandles.slice(0, this.visible);
  }

  async getInstruments() {
    return [{ ...INSTRUMENT, symbol: this.symbol }];
  }

  async getCandlesticks(instrument, _timeframe, { count = 300 } = {}) {
    this.calls.push({ method: 'candles', instrument });
    return this.candles.slice(-count);
  }

  async getBook(instrument) {
    this.calls.push({ method: 'book', instrument });
    const mid = this.candles.at(-1).close;
    const half = (mid * this.spreadBps) / 20_000;
    return { bids: [[(mid - half).toFixed(2), '10', '1']], asks: [[(mid + half).toFixed(2), '10', '1']] };
  }

  async getTickers() {
    return [];
  }
}

/** Freeze Date.now so "is this candle closed" is decided by the fixture, not the clock. */
export function withFakeClock(at, fn) {
  const real = Date.now;
  Date.now = () => at;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}
