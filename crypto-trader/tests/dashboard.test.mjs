import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { startDashboard, newSessionToken } from '../src/dashboard.js';
import { KILL_SWITCH_FILE, killSwitchEngaged } from '../src/risk/guard.js';
import { configureLogging } from '../src/log.js';
import { request } from 'node:http';

configureLogging({ level: 'error' });

const TOKEN = newSessionToken();

/** Just enough engine for the panel to drive. */
const engine = {
  paused: false,
  flattenCalls: 0,
  state: { positions: {} },
  pause() { this.paused = true; },
  resume() { this.paused = false; },
  async flatten() { this.flattenCalls += 1; },
  snapshot() {
    return {
      mode: 'paper', strategy: 'sma-cross', timeframe: '15m', instruments: ['BTC_USD'],
      paused: this.paused, halted: false, haltReason: null, killSwitch: killSwitchEngaged(),
      ticks: 1, day: { date: '2026-09-22', realisedPnl: 0, trades: 0 },
      totals: { realisedPnl: 0, trades: 0, wins: 0, losses: 0, fees: 0 },
      exposure: 0, positions: Object.values(this.state.positions), prices: {}, lastError: null,
    };
  },
};

let server;
let base;
let killExistedBefore;

before(async () => {
  killExistedBefore = existsSync(KILL_SWITCH_FILE);
  server = startDashboard(engine, { port: 0, token: TOKEN, onFlatten: () => engine.flatten() });
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  if (!killExistedBefore && existsSync(KILL_SWITCH_FILE)) unlinkSync(KILL_SWITCH_FILE);
});

const get = (path, headers = {}) => fetch(base + path, { headers });

/** Raw request, so headers fetch() treats as forbidden can still be set. */
function rawGet(path, headers) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: server.address().port, path, method: 'GET', headers, setHost: false },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
}
const post = (body, headers = {}) =>
  fetch(base + '/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('it listens on loopback only', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('state needs the session token', async () => {
  assert.equal((await get('/api/state')).status, 401);
  assert.equal((await get('/api/state', { 'X-CDC-Token': 'wrong' })).status, 401);
  // Same length as a real token, so this is not just a length check passing.
  assert.equal((await get('/api/state', { 'X-CDC-Token': 'a'.repeat(TOKEN.length) })).status, 401);
});

test('state is served with the token', async () => {
  const res = await get('/api/state', { 'X-CDC-Token': TOKEN });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, 'paper');
  assert.equal(body.strategy, 'sma-cross');
});

test('the token also works as a query parameter, for the first page load', async () => {
  assert.equal((await get(`/api/state?t=${TOKEN}`)).status, 200);
});

test('a rebinding Host header is refused', async () => {
  // DNS rebinding resolves an attacker domain to 127.0.0.1; the browser still
  // sends that domain as Host, which is what gives it away. fetch() will not let
  // us forge a Host header, so this one goes out over raw http.
  const status = await rawGet('/api/state', { 'X-CDC-Token': TOKEN, Host: 'evil.example.com' });
  assert.equal(status, 403);
});

test('a correct Host header still passes', async () => {
  const status = await rawGet('/api/state', {
    'X-CDC-Token': TOKEN,
    Host: `localhost:${server.address().port}`,
  });
  assert.equal(status, 200);
});

test('no secret is exposed anywhere in the served state', async () => {
  const text = await (await get('/api/state', { 'X-CDC-Token': TOKEN })).text();
  assert.ok(!/api[_-]?key/i.test(text));
  assert.ok(!/secret/i.test(text));
});

test('the page itself loads without a token and carries no secrets', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('cdc-trader'));
  assert.ok(!html.includes(TOKEN), 'the page must not have the token baked into it');
});

test('control needs the token', async () => {
  assert.equal((await post({ action: 'pause' })).status, 401);
  assert.equal(engine.paused, false);
});

test('a cross-origin control request is refused', async () => {
  const res = await post({ action: 'pause' }, { 'X-CDC-Token': TOKEN, Origin: 'https://evil.example.com' });
  assert.equal(res.status, 403);
  assert.equal(engine.paused, false);
});

test('pause and resume work', async () => {
  let res = await post({ action: 'pause' }, { 'X-CDC-Token': TOKEN });
  assert.equal(res.status, 200);
  assert.equal(engine.paused, true);
  assert.equal((await res.json()).state.paused, true);

  res = await post({ action: 'resume' }, { 'X-CDC-Token': TOKEN });
  assert.equal(res.status, 200);
  assert.equal(engine.paused, false);
});

test('the kill switch can be engaged and cleared', async () => {
  await post({ action: 'kill-on' }, { 'X-CDC-Token': TOKEN });
  assert.equal(killSwitchEngaged(), true);
  await post({ action: 'kill-off' }, { 'X-CDC-Token': TOKEN });
  assert.equal(killSwitchEngaged(), false);
});

test('flatten refuses without an explicit confirmation', async () => {
  engine.state.positions = { BTC_USD: { instrument: 'BTC_USD', quantity: 1 } };
  const res = await post({ action: 'flatten' }, { 'X-CDC-Token': TOKEN });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /confirm/);
  assert.equal(engine.flattenCalls, 0);
});

test('flatten runs when confirmed, and is a no-op when flat', async () => {
  const res = await post({ action: 'flatten', confirm: true }, { 'X-CDC-Token': TOKEN });
  assert.equal(res.status, 200);
  assert.equal(engine.flattenCalls, 1);

  engine.state.positions = {};
  await post({ action: 'flatten', confirm: true }, { 'X-CDC-Token': TOKEN });
  assert.equal(engine.flattenCalls, 1, 'flatten ran with nothing open');
});

test('an unknown action is rejected', async () => {
  const res = await post({ action: 'withdraw' }, { 'X-CDC-Token': TOKEN });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /unknown action/);
});

test('there is no route that could place an order', async () => {
  for (const path of ['/api/order', '/api/buy', '/api/create-order', '/api/keys']) {
    assert.equal((await get(path, { 'X-CDC-Token': TOKEN })).status, 404);
  }
});

test('an oversized body is cut off rather than buffered', async () => {
  const res = await fetch(base + '/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CDC-Token': TOKEN },
    body: JSON.stringify({ action: 'pause', padding: 'x'.repeat(20_000) }),
  }).catch((err) => ({ status: 0, err }));
  assert.ok(res.status === 413 || res.status === 0, `expected a refusal, got ${res.status}`);
});
