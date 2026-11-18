/**
 * The local control panel.
 *
 * This is the web page you operate the bot from. It is served by the bot itself,
 * on the loopback interface of the machine the bot runs on, which is the only
 * place a trading UI can safely live: the API secret stays in this process and is
 * never sent to the browser.
 *
 * A page that can flatten positions is worth attacking, and "it's only listening
 * on localhost" is not by itself a defence — any page open in your browser can
 * make requests to 127.0.0.1, and a hostile DNS record can point a domain there.
 * So three things guard it:
 *
 *   1. **A session token**, generated fresh each run and printed once in the
 *      terminal. Every /api call must carry it. A page that has not been handed
 *      the token cannot read state, let alone change it.
 *   2. **A Host header check.** DNS rebinding works by resolving an attacker's
 *      domain to 127.0.0.1; the browser then sends that domain as Host. Anything
 *      that is not literally localhost or 127.0.0.1 is refused.
 *   3. **A custom header on writes.** Requiring `X-CDC-Token` means a cross-origin
 *      write needs a CORS preflight, and we answer no preflight and send no CORS
 *      headers, so the browser refuses it before it reaches us.
 *
 * The server never exposes the API key, the secret, or anything derived from them.
 */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { engageKillSwitch, clearKillSwitch } from './risk/guard.js';
import { log } from './log.js';

const MAX_BODY_BYTES = 4096;

export function newSessionToken() {
  return randomBytes(24).toString('hex');
}

/** Compare in constant time, so the token cannot be guessed a character at a time. */
function tokenMatches(supplied, expected) {
  if (typeof supplied !== 'string' || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function hostAllowed(hostHeader, port) {
  if (!hostHeader) return false;
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
}

function originAllowed(origin, port) {
  if (!origin) return true; // same-origin fetches send no Origin header
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

/**
 * @param {import('./engine.js').Engine} engine
 * @param {{port?: number, token: string, onFlatten?: () => Promise<void>}} opts
 */
export function startDashboard(engine, { port = 8787, token, onFlatten } = {}) {
  if (!token) throw new Error('the dashboard needs a session token');

  let flattening = false;
  let boundPort = port;

  const server = createServer((req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (!hostAllowed(req.headers.host, boundPort)) {
      // Almost certainly DNS rebinding: a real local request never looks like this.
      log.warn('dashboard refused a request with an unexpected Host', { host: req.headers.host });
      return send(403, { error: 'bad host' });
    }

    const url = new URL(req.url, `http://127.0.0.1:${boundPort}`);

    if (url.pathname === '/') {
      if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
      // The page itself holds no secrets; the token in the query is what unlocks the API.
      return send(200, PAGE, 'text/html; charset=utf-8');
    }

    const supplied = req.headers['x-cdc-token'] ?? url.searchParams.get('t');
    if (!tokenMatches(supplied, token)) {
      return send(401, { error: 'bad or missing token — open the URL printed in the terminal' });
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      return send(200, engine.snapshot());
    }

    if (url.pathname === '/api/control' && req.method === 'POST') {
      if (!originAllowed(req.headers.origin, boundPort)) {
        log.warn('dashboard refused a cross-origin control request', { origin: req.headers.origin });
        return send(403, { error: 'bad origin' });
      }

      let raw = '';
      let tooBig = false;
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > MAX_BODY_BYTES) {
          tooBig = true;
          req.destroy();
        }
      });
      req.on('end', async () => {
        if (tooBig) return send(413, { error: 'body too large' });
        let body;
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          return send(400, { error: 'body is not JSON' });
        }
        try {
          const result = await handleControl(body);
          send(200, { ok: true, ...result, state: engine.snapshot() });
        } catch (err) {
          send(400, { ok: false, error: err.message });
        }
      });
      return undefined;
    }

    return send(404, { error: 'not found' });
  });

  async function handleControl({ action, confirm }) {
    switch (action) {
      case 'pause':
        engine.pause();
        return { message: 'paused — protective exits still run' };

      case 'resume':
        engine.resume();
        return { message: 'resumed' };

      case 'kill-on':
        engageKillSwitch('dashboard');
        log.warn('kill switch engaged from the dashboard');
        return { message: 'kill switch engaged — no new positions' };

      case 'kill-off':
        clearKillSwitch();
        log.info('kill switch cleared from the dashboard');
        return { message: 'kill switch cleared' };

      case 'flatten': {
        // Selling everything at market is the one irreversible thing this page can
        // do, so it takes an explicit confirmation and cannot be run twice at once.
        if (confirm !== true) throw new Error('flatten needs confirm: true');
        if (flattening) throw new Error('already flattening');
        const open = Object.keys(engine.state.positions).length;
        if (open === 0) return { message: 'nothing to flatten' };
        flattening = true;
        log.warn('flatten requested from the dashboard', { positions: open });
        try {
          await (onFlatten ? onFlatten() : engine.flatten('dashboard'));
        } finally {
          flattening = false;
        }
        return { message: `flattened ${open} position${open === 1 ? '' : 's'}` };
      }

      default:
        throw new Error(`unknown action ${JSON.stringify(action)}`);
    }
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error('dashboard port is already in use', { port, hint: 'change dashboard.port in config.json' });
    } else {
      log.error('dashboard could not start', { port, error: err.message });
    }
  });

  // 127.0.0.1, never 0.0.0.0 — this must not be reachable from the network.
  server.listen(port, '127.0.0.1', () => {
    boundPort = server.address().port;
    log.info('control panel ready', { url: `http://127.0.0.1:${boundPort}/?t=${token}` });
    process.stdout.write(
      `\n  Control panel:  http://127.0.0.1:${boundPort}/?t=${token}\n` +
        `  (the token is new each run and only works from this machine)\n\n`,
    );
  });

  return server;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>cdc-trader</title>
<style>
  :root {
    color-scheme: light dark;
    --plane:#f0f2f5; --card:#fff; --ink:#0f1319; --ink2:#464e58; --muted:#7c8592;
    --line:#dcdfe3; --up:#006300; --down:#b3261e; --accent:#2a78d6;
    --warn:#8a5a00; --warnbg:#fdf3dd; --crit:#b3261e; --critbg:#fae9e9;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --plane:#0a0d11; --card:#14181e; --ink:#eef1f5; --ink2:#b3bcc7; --muted:#7f8894;
      --line:#262d36; --up:#0ca30c; --down:#ff6b6b; --accent:#3987e5;
      --warn:#fab219; --warnbg:#33280a; --crit:#ff6b6b; --critbg:#331515;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:22px 16px 48px; background:var(--plane); color:var(--ink); font-size:14px; }
  .wrap { max-width:940px; margin:0 auto; display:flex; flex-direction:column; gap:14px; }
  h1 { font-size:1.1rem; margin:0; font-family:ui-monospace,Menlo,monospace; }
  .sub { color:var(--muted); font-size:.82rem; }
  .row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .banner { border-radius:6px; padding:9px 13px; font-size:.86rem; font-weight:600;
            border-left:3px solid; }
  .banner--warn { background:var(--warnbg); color:var(--warn); border-color:var(--warn); }
  .banner--crit { background:var(--critbg); color:var(--crit); border-color:var(--crit); }
  button { font:inherit; font-size:.84rem; font-weight:600; color:var(--ink);
           background:var(--card); border:1px solid var(--line); border-radius:5px;
           padding:7px 13px; cursor:pointer; }
  button:hover:not(:disabled) { border-color:var(--muted); }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.danger { color:var(--crit); border-color:var(--crit); }
  .grid { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(136px,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:6px; padding:12px 14px; }
  .label { color:var(--muted); font-size:.64rem; text-transform:uppercase; letter-spacing:.08em; font-weight:600; }
  .value { font-size:1.22rem; font-weight:650; margin-top:3px; font-variant-numeric:tabular-nums;
           font-family:ui-monospace,Menlo,monospace; }
  .up { color:var(--up); } .down { color:var(--down); }
  table { width:100%; border-collapse:collapse; background:var(--card);
          border:1px solid var(--line); border-radius:6px; overflow:hidden; font-size:.84rem; }
  th,td { padding:8px 12px; text-align:right; border-bottom:1px solid var(--line);
          font-variant-numeric:tabular-nums; white-space:nowrap; }
  th:first-child, td:first-child { text-align:left; }
  th { color:var(--muted); font-size:.64rem; text-transform:uppercase; letter-spacing:.08em; }
  td { font-family:ui-monospace,Menlo,monospace; color:var(--ink2); }
  tr:last-child td { border-bottom:none; }
  .empty { color:var(--muted); padding:18px; text-align:center; background:var(--card);
           border:1px solid var(--line); border-radius:6px; font-size:.86rem; }
  h2 { font-size:.68rem; margin:6px 0 0; color:var(--muted);
       text-transform:uppercase; letter-spacing:.08em; }
  .scroll { overflow-x:auto; }
  .toast { position:fixed; left:50%; bottom:20px; transform:translateX(-50%);
           background:var(--ink); color:var(--plane); padding:9px 15px; border-radius:6px;
           font-size:.84rem; box-shadow:0 6px 20px rgba(0,0,0,.25); }
</style>
</head>
<body>
<div class="wrap">
  <div>
    <h1>cdc-trader</h1>
    <div class="sub" id="sub">connecting…</div>
  </div>

  <div id="banners"></div>

  <div class="row">
    <button id="pauseBtn" type="button">Pause</button>
    <button id="killBtn" type="button">Engage kill switch</button>
    <button id="flatBtn" class="danger" type="button">Flatten all</button>
    <span class="sub" id="hint"></span>
  </div>

  <div class="grid" id="stats"></div>

  <h2>Open positions</h2>
  <div class="scroll" id="positions"></div>
</div>
<div class="toast" id="toast" style="display:none"></div>

<script>
const TOKEN = new URLSearchParams(location.search).get('t') || '';
let latest = null;
let busy = false;

const money = (n, dp = 2) =>
  (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const sign = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = '';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

async function control(action, extra) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CDC-Token': TOKEN },
      body: JSON.stringify(Object.assign({ action }, extra || {})),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || 'request failed');
    toast(data.message || 'done');
    if (data.state) paint(data.state);
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

document.getElementById('pauseBtn').onclick = () =>
  control(latest && latest.paused ? 'resume' : 'pause');

document.getElementById('killBtn').onclick = () =>
  control(latest && latest.killSwitch ? 'kill-off' : 'kill-on');

document.getElementById('flatBtn').onclick = () => {
  const open = latest ? latest.positions.length : 0;
  if (!open) return toast('nothing to flatten');
  const what = open === 1 ? 'the open position' : open + ' open positions';
  if (!confirm('Sell ' + what + ' at market, now?\\n\\nThis cannot be undone.')) return;
  control('flatten', { confirm: true });
};

function paint(s) {
  latest = s;

  document.getElementById('sub').textContent =
    s.mode.toUpperCase() + ' · ' + s.strategy + ' · ' + s.timeframe + ' · ' +
    s.instruments.join(', ') + ' · ' + s.ticks + ' passes';

  const banners = [];
  if (s.mode === 'paper') banners.push(['warn', 'Paper mode — simulated money, no real orders are sent.']);
  if (s.halted) banners.push(['crit', 'HALTED: ' + s.haltReason]);
  if (s.killSwitch) banners.push(['warn', 'Kill switch engaged — no new positions. Open ones are still managed.']);
  if (s.paused) banners.push(['warn', 'Paused — no new signals acted on. Stops and targets still run.']);
  if (s.lastError) banners.push(['crit', 'Last error: ' + s.lastError.message]);
  document.getElementById('banners').innerHTML =
    banners.map((b) => '<div class="banner banner--' + b[0] + '">' + b[1] + '</div>').join('');

  document.getElementById('pauseBtn').textContent = s.paused ? 'Resume' : 'Pause';
  document.getElementById('pauseBtn').className = s.paused ? 'primary' : '';
  document.getElementById('killBtn').textContent = s.killSwitch ? 'Clear kill switch' : 'Engage kill switch';
  document.getElementById('flatBtn').disabled = s.positions.length === 0;
  document.getElementById('hint').textContent =
    s.positions.length === 0 ? 'flat — nothing to flatten' : '';

  const day = s.day.realisedPnl, total = s.totals.realisedPnl;
  const winRate = s.totals.trades ? (s.totals.wins / s.totals.trades) * 100 : 0;
  const tile = (l, v, c) =>
    '<div class="card"><div class="label">' + l + '</div><div class="value ' + (c || '') + '">' + v + '</div></div>';
  document.getElementById('stats').innerHTML = [
    tile('Today', money(day), sign(day)),
    tile('Realised total', money(total), sign(total)),
    tile('Exposure', money(s.exposure)),
    tile('Trades today', s.day.trades),
    tile('Win rate', money(winRate, 1) + '%'),
    tile('Fees paid', money(s.totals.fees)),
  ].join('');

  const rows = s.positions.map((p) =>
    '<tr><td>' + p.instrument + '</td><td>' + p.quantity + '</td>' +
    '<td>' + money(p.entryPrice, 4) + '</td><td>' + money(p.markPrice, 4) + '</td>' +
    '<td>' + money(p.value) + '</td>' +
    '<td class="' + sign(p.unrealisedPnl) + '">' + money(p.unrealisedPnl) +
    ' (' + money(p.unrealisedPct, 2) + '%)</td></tr>').join('');
  document.getElementById('positions').innerHTML = rows
    ? '<table><thead><tr><th>Instrument</th><th>Quantity</th><th>Entry</th><th>Mark</th>' +
      '<th>Value</th><th>Unrealised</th></tr></thead><tbody>' + rows + '</tbody></table>'
    : '<div class="empty">No open positions.</div>';
}

async function refresh() {
  if (busy) return;
  try {
    const res = await fetch('/api/state', { headers: { 'X-CDC-Token': TOKEN } });
    if (res.status === 401) {
      document.getElementById('sub').textContent =
        'missing session token — open the URL printed in the terminal';
      return;
    }
    paint(await res.json());
  } catch {
    document.getElementById('sub').textContent = 'bot not responding';
  }
}

refresh();
setInterval(refresh, 4000);
</script>
</body>
</html>`;
