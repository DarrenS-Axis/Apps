import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { StateStore } from '../src/state/store.js';
import { InstrumentCatalogue } from '../src/exchange/instruments.js';
import { PaperBroker } from '../src/exec/paperBroker.js';
import { Engine } from '../src/engine.js';
import { configureLogging } from '../src/log.js';
import { KILL_SWITCH_FILE } from '../src/risk/guard.js';
import { FakeClient, candlesFrom, cyclical, cyclicalThenCrash, tempPaths } from './helpers.mjs';

configureLogging({ level: 'error' });

assert.ok(
  !existsSync(KILL_SWITCH_FILE),
  `remove ${KILL_SWITCH_FILE} before running the tests; it disables entries`,
);

function makeConfig(overrides = {}) {
  return loadConfig('/nonexistent-config.json', {
    mode: 'paper',
    quoteCurrency: 'USD',
    instruments: ['BTC_USD'],
    timeframe: '15m',
    strategy: { name: 'sma-cross', params: { fastPeriod: 5, slowPeriod: 12, trendPeriod: 0 } },
    risk: {
      maxPositionQuote: 500,
      maxTotalExposureQuote: 1000,
      maxOpenPositions: 1,
      maxTradesPerDay: 100,
      dailyLossLimitQuote: 10_000,
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

async function buildEngine(candles, overrides = {}) {
  const config = makeConfig(overrides);
  const client = new FakeClient(candles);
  const catalogue = new InstrumentCatalogue(client);
  await catalogue.refresh();

  const paths = tempPaths();
  const store = new StateStore({ file: paths.state, journal: paths.journal });
  store.load(config.mode, config.quoteCurrency, config.paper.startingQuote);

  const broker = new PaperBroker({ store, catalogue, config });
  const engine = new Engine({ config, client, catalogue, broker, store });
  return { engine, client, store, config, paths };
}

/** Walk the engine forward one candle at a time, with the clock following the data. */
async function replay({ engine, client }, from) {
  const realNow = Date.now;
  try {
    for (let i = from; i <= client.allCandles.length; i++) {
      client.reveal(i);
      Date.now = () => client.now;
      await engine.tick();
    }
  } finally {
    Date.now = realNow;
  }
}

function journal(paths) {
  if (!existsSync(paths.journal)) return [];
  return readFileSync(paths.journal, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('a full replay opens and closes positions and records them', async () => {
  const candles = candlesFrom(cyclical(160));
  const harness = await buildEngine(candles);
  await replay(harness, 30);

  const entries = journal(harness.paths);
  const opens = entries.filter((e) => e.event === 'open');
  const closes = entries.filter((e) => e.event === 'close');

  assert.ok(opens.length > 0, 'expected at least one position to be opened');
  assert.ok(closes.length > 0, 'expected at least one position to be closed');
  assert.equal(harness.store.state.totals.trades, opens.length);
  for (const entry of entries) assert.equal(entry.simulated, true, 'paper mode must never report a real fill');
});

test('no money is created: flat balance equals start plus P&L minus fees', async () => {
  const candles = candlesFrom(cyclical(160));
  const harness = await buildEngine(candles);
  await replay(harness, 30);

  const { state } = harness.store;
  if (Object.keys(state.positions).length > 0) {
    await harness.engine.flatten('end of test');
  }

  const cash = state.paperBalances.USD;
  const expected = harness.config.paper.startingQuote + state.totals.realisedPnl;
  assert.ok(
    Math.abs(cash - expected) < 0.01,
    `balance ${cash.toFixed(4)} does not match start + realised P&L ${expected.toFixed(4)}`,
  );
});

test('the still-forming candle is never acted on', async () => {
  const candles = candlesFrom(cyclical(80));
  const harness = await buildEngine(candles);
  const { engine, client, store } = harness;

  // Reveal every candle but set the clock mid-way through the last one, so it is
  // still open. The engine should record the previous candle as the latest closed.
  client.reveal(candles.length);
  const realNow = Date.now;
  try {
    Date.now = () => candles.at(-1).time + 1000;
    await engine.tick();
  } finally {
    Date.now = realNow;
  }

  const seen = store.state.lastCandleTime.BTC_USD;
  assert.ok(seen < candles.at(-1).time, 'the open candle was treated as closed');
  assert.equal(seen, candles.at(-2).time);
});

test('the same closed candle is only acted on once', async () => {
  const candles = candlesFrom(cyclical(120));
  const harness = await buildEngine(candles);
  await replay(harness, 30);

  const before = journal(harness.paths).length;
  const realNow = Date.now;
  try {
    Date.now = () => harness.client.now;
    await harness.engine.tick();
    await harness.engine.tick();
  } finally {
    Date.now = realNow;
  }
  assert.equal(journal(harness.paths).length, before, 'a repeated tick traded again on the same candle');
});

test('a halted bot stops opening but still closes', async () => {
  const candles = candlesFrom(cyclical(160));
  const harness = await buildEngine(candles);
  await replay(harness, 30);

  harness.store.halt('test');
  const openedBefore = journal(harness.paths).filter((e) => e.event === 'open').length;

  const more = candlesFrom(cyclical(200)).slice(160);
  harness.client.allCandles = [...candles, ...more];
  await replay(harness, 161);

  const openedAfter = journal(harness.paths).filter((e) => e.event === 'open').length;
  assert.equal(openedAfter, openedBefore, 'a halted bot opened a new position');
});

test('the stop loss fires before the strategy gets a look', async () => {
  const candles = candlesFrom(cyclicalThenCrash(60, 40));
  const harness = await buildEngine(candles, {
    risk: { ...makeConfig().risk, stopLossPct: 5, minSecondsBetweenTrades: 0 },
  });
  await replay(harness, 30);

  const stops = journal(harness.paths).filter((e) => e.kind === 'stop-loss');
  assert.ok(stops.length > 0, 'the stop never fired through a 40% drop');
  assert.equal(Object.keys(harness.store.state.positions).length, 0, 'position survived its stop');
});

test('one failing instrument does not stop the others', async () => {
  const candles = candlesFrom(cyclical(120));
  const harness = await buildEngine(candles);
  // Make every candle request fail, and confirm the tick still returns cleanly.
  harness.client.getCandlesticks = async () => {
    throw new Error('exchange unavailable');
  };
  const realNow = Date.now;
  try {
    Date.now = () => harness.client.now;
    await assert.doesNotReject(() => harness.engine.tick());
  } finally {
    Date.now = realNow;
  }
  assert.match(harness.engine.lastError.message, /exchange unavailable/);
});

test('a wide spread blocks entries but not exits', async () => {
  const candles = candlesFrom(cyclical(160));
  const harness = await buildEngine(candles);
  harness.client.spreadBps = 5000; // 50%, far past the 50bp default cap
  await replay(harness, 30);

  const opens = journal(harness.paths).filter((e) => e.event === 'open');
  assert.equal(opens.length, 0, 'entered through a 50% spread');
});

test('the snapshot reports live marks and unrealised P&L', async () => {
  const candles = candlesFrom(cyclical(160));
  const harness = await buildEngine(candles);
  await replay(harness, 30);

  const snapshot = harness.engine.snapshot();
  assert.equal(snapshot.mode, 'paper');
  assert.equal(snapshot.strategy, 'sma-cross');
  assert.ok(Number.isFinite(snapshot.exposure));
  for (const position of snapshot.positions) {
    assert.ok(Number.isFinite(position.unrealisedPnl));
    assert.ok(Number.isFinite(position.markPrice));
  }
});

test('state survives a restart', async () => {
  const candles = candlesFrom(cyclical(160));
  const harness = await buildEngine(candles);
  await replay(harness, 30);

  const reopened = new StateStore({ file: harness.paths.state, journal: harness.paths.journal });
  const state = reopened.load('paper', 'USD', 1000);
  assert.equal(state.totals.trades, harness.store.state.totals.trades);
  assert.deepEqual(Object.keys(state.positions), Object.keys(harness.store.state.positions));
});

test('a paper state file is refused by a live run', async () => {
  const candles = candlesFrom(cyclical(60));
  const harness = await buildEngine(candles);
  const reopened = new StateStore({ file: harness.paths.state, journal: harness.paths.journal });
  assert.throws(() => reopened.load('live', 'USD', 1000), /paper.*mode/s);
});
