import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backtest } from '../src/backtest.js';
import { loadConfig } from '../src/config.js';
import { cyclical } from './helpers.mjs';
import { getStrategy, resolveParams } from '../src/strategy/registry.js';

const INSTRUMENT = { qtyTickSize: '0.00001', priceTickSize: '0.01' };

function config(overrides = {}) {
  return loadConfig('/nonexistent-config.json', {
    instruments: ['BTC_USD'],
    strategy: { name: 'sma-cross', params: { fastPeriod: 5, slowPeriod: 12, trendPeriod: 0 } },
    risk: {
      maxPositionQuote: 500,
      maxTotalExposureQuote: 1000,
      maxOpenPositions: 1,
      maxTradesPerDay: 100,
      dailyLossLimitQuote: 100000,
      minSecondsBetweenTrades: 0,
      stopLossPct: 50,
      takeProfitPct: 0,
      trailingStopPct: 0,
      reserveQuote: 0,
    },
    paper: { startingQuote: 1000 },
    ...overrides,
  });
}

/** Candles whose opens are deliberately nowhere near any close. */
function gappedCandles(closes, { start = 1_700_000_000_000, step = 900_000 } = {}) {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1] * 0.8;
    return {
      time: start + i * step,
      open,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      close,
      volume: 10,
    };
  });
}

function run(candles, cfg = config()) {
  return backtest({ candles, config: cfg, instrument: INSTRUMENT, symbol: 'BTC_USD' });
}

test('a signal fills at the next bar open, not the signal bar close', () => {
  const closes = cyclical(200);
  const candles = gappedCandles(closes);
  const result = run(candles);
  assert.ok(result.trades > 0, 'no trades to check');

  const { slippageBps } = config().execution;
  const opens = new Set(candles.map((c) => c.open.toFixed(6)));
  const closeSet = new Set(candles.map((c) => c.close.toFixed(6)));

  for (const trade of result.tradeLog) {
    if (trade.kind !== 'signal' && trade.kind !== 'forced') continue;
    const unslipped = trade.entryPrice / (1 + slippageBps / 10_000);
    assert.ok(
      opens.has(unslipped.toFixed(6)),
      `entry ${trade.entryPrice} does not correspond to any bar open`,
    );
    assert.ok(!closeSet.has(unslipped.toFixed(6)), 'entry landed on a close -- look-ahead bias');
  }
});

test('when a bar spans both the stop and the target, the stop wins', () => {
  // Place the enormous bar immediately after the first entry, so a position is
  // definitely open when it arrives.
  const closes = cyclical(120);
  const all = closes.map((close, i) => ({
    time: 1_700_000_000_000 + i * 900_000,
    open: i === 0 ? close : closes[i - 1],
    high: close * 1.002,
    low: close * 0.998,
    close,
    volume: 10,
  }));

  const strategy = getStrategy('sma-cross');
  const params = resolveParams(strategy, { fastPeriod: 5, slowPeriod: 12, trendPeriod: 0 });
  let signalBar = -1;
  for (let i = strategy.warmup(params); i < all.length; i++) {
    if (strategy.evaluate({ candles: all, index: i, position: null }, params).action === 'buy') {
      signalBar = i;
      break;
    }
  }
  assert.ok(signalBar > 0, 'the fixture never produced a buy signal');

  const candles = all.slice(0, signalBar + 1);
  const entryOpen = all[signalBar].close;
  candles.push({
    time: all[signalBar].time + 900_000,
    open: entryOpen,
    high: entryOpen * 1.5, // far past a 6% target
    low: entryOpen * 0.5, // far past a 3% stop
    close: entryOpen,
    volume: 10,
  });

  const cfg = config({ risk: { ...config().risk, stopLossPct: 3, takeProfitPct: 6 } });
  const result = run(candles, cfg);

  assert.equal(result.trades, 1, 'expected exactly one trade');
  assert.equal(result.tradeLog[0].kind, 'stop-loss', 'the backtest awarded itself the better outcome');
});

test('fees and slippage make the result worse, never better', () => {
  const candles = gappedCandles(cyclical(240));
  const free = run(candles, config({ execution: { ...config().execution, takerFeeBps: 0, makerFeeBps: 0, slippageBps: 0 } }));
  const costly = run(candles, config({ execution: { ...config().execution, takerFeeBps: 20, makerFeeBps: 20, slippageBps: 30 } }));

  assert.ok(free.trades > 0);
  assert.ok(costly.endingCash <= free.endingCash, 'charging fees improved the result');
  assert.equal(free.feesPaid, 0);
  assert.ok(costly.feesPaid > 0);
});

test('the summary adds up', () => {
  const result = run(gappedCandles(cyclical(240)));
  assert.equal(result.wins + result.losses, result.trades);
  assert.equal(result.tradeLog.length, result.trades);
  assert.ok(result.maxDrawdownPct >= 0);
  assert.ok(Number.isFinite(result.sharpe));
  assert.ok(
    Math.abs(result.totalReturnPct - ((result.endingCash - result.startingCash) / result.startingCash) * 100) < 1e-9,
  );
});

test('the backtest never spends more than the balance', () => {
  const result = run(gappedCandles(cyclical(240)));
  for (const point of result.equityCurve) assert.ok(point.equity > 0, 'equity went negative');
  assert.ok(result.endingCash >= 0);
});

test('too little history is an error, not a meaningless result', () => {
  assert.throws(() => run(gappedCandles(cyclical(15))), /need more than/);
});
