/**
 * A small status page, bound to the loopback interface only.
 *
 * It is read-only and it never leaves the machine: it is for glancing at open
 * positions and today's P&L without tailing a log. There is deliberately no way to
 * place or cancel an order from here, so an open port cannot become a way to move
 * money.
 */
import { createServer } from 'node:http';
import { log } from './log.js';

export function startDashboard(engine, { port = 8787 } = {}) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end('method not allowed');
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (url.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(engine.snapshot(), null, 2));
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(PAGE);
      return;
    }
    res.writeHead(404).end('not found');
  });

  server.on('error', (err) => {
    log.error('dashboard could not start', { port, error: err.message });
  });

  // 127.0.0.1, not 0.0.0.0 -- this should not be reachable from the network.
  server.listen(port, '127.0.0.1', () => {
    log.info('dashboard listening', { url: `http://127.0.0.1:${port}` });
  });

  return server;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trading bot</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --card: #fff; --ink: #14171a; --muted: #6b7280;
    --line: #e5e7eb; --up: #0f7b4f; --down: #b3261e; --warn: #92400e; --warn-bg: #fef3c7;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --card:#181b21; --ink:#e7e9ee; --muted:#9aa3b2;
            --line:#272b33; --up:#3ddc97; --down:#ff6b6b; --warn:#fbbf24; --warn-bg:#3b2f0b; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--ink); }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size:1.25rem; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:.85rem; margin-bottom:20px; }
  .banner { background:var(--warn-bg); color:var(--warn); border-radius:8px;
            padding:10px 14px; margin-bottom:16px; font-size:.9rem; font-weight:600; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); margin-bottom:20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; }
  .label { color:var(--muted); font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; }
  .value { font-size:1.3rem; font-weight:650; margin-top:4px; font-variant-numeric:tabular-nums; }
  .up { color:var(--up); } .down { color:var(--down); }
  table { width:100%; border-collapse:collapse; background:var(--card);
          border:1px solid var(--line); border-radius:10px; overflow:hidden; font-size:.88rem; }
  th, td { padding:9px 12px; text-align:right; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  th:first-child, td:first-child { text-align:left; }
  th { color:var(--muted); font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; font-weight:600; }
  tr:last-child td { border-bottom:none; }
  .empty { color:var(--muted); padding:18px; text-align:center; background:var(--card);
           border:1px solid var(--line); border-radius:10px; font-size:.9rem; }
  h2 { font-size:.95rem; margin:22px 0 10px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Trading bot</h1>
  <div class="sub" id="sub">connecting…</div>
  <div id="banners"></div>
  <div class="grid" id="stats"></div>
  <h2>Open positions</h2>
  <div id="positions"></div>
</div>
<script>
const money = (n, dp = 2) =>
  (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const signClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

function stat(label, value, cls = '') {
  return '<div class="card"><div class="label">' + label + '</div>' +
         '<div class="value ' + cls + '">' + value + '</div></div>';
}

async function refresh() {
  let s;
  try {
    s = await (await fetch('/api/state')).json();
  } catch {
    document.getElementById('sub').textContent = 'bot not responding';
    return;
  }

  document.getElementById('sub').textContent =
    s.mode.toUpperCase() + ' · ' + s.strategy + ' · ' + s.timeframe + ' · ' +
    s.instruments.join(', ') + ' · ' + s.ticks + ' passes';

  const banners = [];
  if (s.mode === 'paper') banners.push('Paper mode — simulated money, no real orders.');
  if (s.halted) banners.push('HALTED: ' + s.haltReason);
  if (s.killSwitch) banners.push('Kill switch engaged — no new positions.');
  if (s.lastError) banners.push('Last error: ' + s.lastError.message);
  document.getElementById('banners').innerHTML =
    banners.map((b) => '<div class="banner">' + b + '</div>').join('');

  const day = s.day.realisedPnl, total = s.totals.realisedPnl;
  const winRate = s.totals.trades ? (s.totals.wins / s.totals.trades) * 100 : 0;
  document.getElementById('stats').innerHTML = [
    stat('Today', money(day), signClass(day)),
    stat('Realised total', money(total), signClass(total)),
    stat('Exposure', money(s.exposure)),
    stat('Trades today', s.day.trades),
    stat('Win rate', money(winRate, 1) + '%'),
    stat('Fees paid', money(s.totals.fees)),
  ].join('');

  const rows = s.positions.map((p) =>
    '<tr><td>' + p.instrument + '</td>' +
    '<td>' + p.quantity + '</td>' +
    '<td>' + money(p.entryPrice, 4) + '</td>' +
    '<td>' + money(p.markPrice, 4) + '</td>' +
    '<td>' + money(p.value) + '</td>' +
    '<td class="' + signClass(p.unrealisedPnl) + '">' + money(p.unrealisedPnl) +
    ' (' + money(p.unrealisedPct, 2) + '%)</td></tr>').join('');

  document.getElementById('positions').innerHTML = rows
    ? '<table><thead><tr><th>Instrument</th><th>Quantity</th><th>Entry</th>' +
      '<th>Mark</th><th>Value</th><th>Unrealised</th></tr></thead><tbody>' + rows + '</tbody></table>'
    : '<div class="empty">No open positions.</div>';
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
