import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, LIVE_CONFIRMATION } from '../src/config.js';

const MISSING = '/nonexistent-config.json';

function withFile(contents) {
  const path = join(mkdtempSync(join(tmpdir(), 'cdc-cfg-')), 'config.json');
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

test('defaults are safe: paper mode with a stop in place', () => {
  const config = loadConfig(MISSING);
  assert.equal(config.mode, 'paper');
  assert.ok(config.risk.stopLossPct > 0 || config.risk.trailingStopPct > 0);
  assert.ok(config.risk.maxPositionQuote <= config.risk.maxTotalExposureQuote);
});

test('an unknown top-level key is rejected', () => {
  assert.throws(() => loadConfig(withFile({ maxPositionQuote: 100 })), /unknown key "maxPositionQuote"/);
});

test('an unknown risk key is rejected rather than ignored', () => {
  // Silently ignoring this would read as "no limit", which is the worst default.
  assert.throws(() => loadConfig(withFile({ risk: { maxPositionUSD: 50 } })), /unknown key "risk.maxPositionUSD"/);
});

test('running with no stop at all is refused', () => {
  assert.throws(
    () => loadConfig(MISSING, { risk: { ...loadConfig(MISSING).risk, stopLossPct: 0, trailingStopPct: 0 } }),
    /stopLossPct or risk.trailingStopPct/,
  );
});

test('a per-trade cap above the total exposure cap is refused', () => {
  assert.throws(
    () => loadConfig(MISSING, { risk: { ...loadConfig(MISSING).risk, maxPositionQuote: 500, maxTotalExposureQuote: 100 } }),
    /cannot exceed/,
  );
});

test('instrument symbols are checked for shape', () => {
  assert.throws(() => loadConfig(MISSING, { instruments: ['BTC/USD'] }), /does not look like an exchange symbol/);
  assert.throws(() => loadConfig(MISSING, { instruments: [] }), /non-empty array/);
  assert.throws(() => loadConfig(MISSING, { instruments: ['BTC_USD', 'BTC_USD'] }), /duplicates/);
});

test('an unsupported timeframe is refused', () => {
  assert.throws(() => loadConfig(MISSING, { timeframe: '3m' }), /timeframe/);
  assert.doesNotThrow(() => loadConfig(MISSING, { timeframe: '4h' }));
});

test('polling faster than the rate limits allow is refused', () => {
  assert.throws(() => loadConfig(MISSING, { pollSeconds: 1 }), /pollSeconds/);
});

test('live mode needs credentials and the written confirmation', () => {
  const saved = { ...process.env };
  try {
    delete process.env.CDC_API_KEY;
    delete process.env.CDC_API_SECRET;
    delete process.env.CDC_LIVE_CONFIRM;
    assert.throws(() => loadConfig(MISSING, { mode: 'live' }), /CDC_API_KEY/);

    process.env.CDC_API_KEY = 'key';
    process.env.CDC_API_SECRET = 'secret';
    assert.throws(() => loadConfig(MISSING, { mode: 'live' }), /CDC_LIVE_CONFIRM/);

    process.env.CDC_LIVE_CONFIRM = 'yes please';
    assert.throws(() => loadConfig(MISSING, { mode: 'live' }), /CDC_LIVE_CONFIRM/);

    process.env.CDC_LIVE_CONFIRM = LIVE_CONFIRMATION;
    assert.doesNotThrow(() => loadConfig(MISSING, { mode: 'live' }));
  } finally {
    process.env = saved;
  }
});

test('paper mode does not require credentials', () => {
  const saved = { ...process.env };
  try {
    delete process.env.CDC_API_KEY;
    delete process.env.CDC_API_SECRET;
    assert.doesNotThrow(() => loadConfig(MISSING, { mode: 'paper' }));
  } finally {
    process.env = saved;
  }
});
