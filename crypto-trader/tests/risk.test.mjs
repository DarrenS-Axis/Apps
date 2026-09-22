import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEntry, checkExit, protectiveExit, currentExposure, enforceDailyLoss } from '../src/risk/guard.js';
import { loadConfig } from '../src/config.js';
import { emptyState, StateStore } from '../src/state/store.js';
import { tempPaths } from './helpers.mjs';

const config = loadConfig('/nonexistent-config.json', {
  instruments: ['BTC_USD', 'ETH_USD'],
});

function freshState() {
  return emptyState('paper', 'USD', 1000);
}

function entry(state, extra = {}) {
  return checkEntry({
    state,
    config,
    instrument: 'BTC_USD',
    price: 100,
    availableQuote: 1000,
    now: 1_000_000_000,
    ...extra,
  });
}

test('a clean state allows an entry, sized to the per-trade cap', () => {
  const decision = entry(freshState());
  assert.equal(decision.allowed, true);
  assert.equal(decision.quoteAmount, config.risk.maxPositionQuote);
});

test('a halted bot opens nothing', () => {
  const state = freshState();
  state.halted = true;
  state.haltReason = 'daily-loss-limit';
  const decision = entry(state);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /halted/);
});

test('an instrument outside the configured list is refused', () => {
  const decision = entry(freshState(), { instrument: 'DOGE_USD' });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /not in the configured instruments/);
});

test('it will not double up on an instrument it already holds', () => {
  const state = freshState();
  state.positions.BTC_USD = { instrument: 'BTC_USD', quantity: 1, entryPrice: 100, costBasis: 100 };
  const decision = entry(state);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /already holding/);
});

test('the open position count is capped', () => {
  const state = freshState();
  for (let i = 0; i < config.risk.maxOpenPositions; i++) {
    state.positions[`X${i}_USD`] = { instrument: `X${i}_USD`, quantity: 1, entryPrice: 1, costBasis: 1 };
  }
  const decision = entry(state);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /open positions/);
});

test('the daily trade count is capped', () => {
  const state = freshState();
  state.day.trades = config.risk.maxTradesPerDay;
  assert.match(entry(state).reason, /trades today/);
});

test('the daily loss limit blocks new entries', () => {
  const state = freshState();
  state.day.realisedPnl = -config.risk.dailyLossLimitQuote;
  assert.match(entry(state).reason, /today/);
});

test('trades are spaced out by the cooldown', () => {
  const state = freshState();
  state.lastTradeAt = 1_000_000_000 - 5_000; // 5s ago, cooldown is 60s
  assert.match(entry(state).reason, /since the last trade/);
});

test('size is clipped to the remaining exposure headroom', () => {
  const state = freshState();
  const headroom = 40;
  state.positions.ETH_USD = {
    instrument: 'ETH_USD',
    quantity: 1,
    entryPrice: config.risk.maxTotalExposureQuote - headroom,
    costBasis: 1,
  };
  const decision = entry(state);
  assert.equal(decision.allowed, true);
  assert.equal(decision.quoteAmount, headroom);
});

test('size is clipped to the balance, less the reserve', () => {
  const withReserve = loadConfig('/nonexistent-config.json', {
    instruments: ['BTC_USD'],
    risk: { ...config.risk, reserveQuote: 970 },
  });
  const decision = checkEntry({
    state: freshState(),
    config: withReserve,
    instrument: 'BTC_USD',
    price: 100,
    availableQuote: 1000,
    now: 1_000_000_000,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.quoteAmount, 30);
});

test('an unusable price is refused', () => {
  assert.equal(entry(freshState(), { price: 0 }).allowed, false);
  assert.equal(entry(freshState(), { price: Number.NaN }).allowed, false);
});

test('exposure is marked to the current price, not the entry', () => {
  const state = freshState();
  state.positions.BTC_USD = { instrument: 'BTC_USD', quantity: 2, entryPrice: 100, costBasis: 200 };
  assert.equal(currentExposure(state, {}), 200);
  assert.equal(currentExposure(state, { BTC_USD: 150 }), 300);
});

test('exits are allowed even when the bot is halted', () => {
  const state = freshState();
  state.halted = true;
  state.positions.BTC_USD = { instrument: 'BTC_USD', quantity: 1, entryPrice: 100, costBasis: 100 };
  assert.equal(checkExit({ state, instrument: 'BTC_USD' }).allowed, true);
});

test('an exit with no position is refused', () => {
  assert.equal(checkExit({ state: freshState(), instrument: 'BTC_USD' }).allowed, false);
});

const position = { instrument: 'BTC_USD', quantity: 1, entryPrice: 100, highWaterMark: 100 };
const risk = { stopLossPct: 3, takeProfitPct: 6, trailingStopPct: 0 };

test('the stop fires at the configured loss', () => {
  assert.equal(protectiveExit(position, 97, risk).kind, 'stop-loss');
  assert.equal(protectiveExit(position, 97.5, risk).hit, false);
});

test('the target fires at the configured gain', () => {
  assert.equal(protectiveExit(position, 106, risk).kind, 'take-profit');
  assert.equal(protectiveExit(position, 105.9, risk).hit, false);
});

test('the trailing stop measures from the peak, not the entry', () => {
  const trailing = { stopLossPct: 0, takeProfitPct: 0, trailingStopPct: 5 };
  const runUp = { ...position, highWaterMark: 200 };
  // Still well above entry, but 10% off the peak.
  assert.equal(protectiveExit(runUp, 180, trailing).kind, 'trailing-stop');
  assert.equal(protectiveExit(runUp, 195, trailing).hit, false);
});

test('the daily loss limit halts the store once breached', () => {
  const paths = tempPaths();
  const store = new StateStore({ file: paths.state, journal: paths.journal });
  store.load('paper', 'USD', 1000);
  store.state.day.realisedPnl = -config.risk.dailyLossLimitQuote;
  enforceDailyLoss(store, config.risk);
  assert.equal(store.state.halted, true);
  assert.equal(store.state.haltReason, 'daily-loss-limit');
});
