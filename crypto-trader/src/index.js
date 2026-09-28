#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * Commands:
 *   run          start the trading loop
 *   backtest     replay a strategy over historical candles
 *   balance      print the balances the exchange reports
 *   instruments  list tradable spot pairs
 *   strategies   list the built-in strategies and their parameters
 *   status       print the persisted state without starting anything
 *   flatten      close every open position and stop
 *   verify       check that the API credentials work
 */
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, loadEnv, PROJECT_ROOT, LIVE_CONFIRMATION } from './config.js';
import { configureLogging, log } from './log.js';
import { CryptoComClient } from './exchange/client.js';
import { InstrumentCatalogue } from './exchange/instruments.js';
import { PaperBroker } from './exec/paperBroker.js';
import { LiveBroker } from './exec/liveBroker.js';
import { StateStore } from './state/store.js';
import { Engine } from './engine.js';
import { startDashboard, newSessionToken } from './dashboard.js';
import { listStrategies } from './strategy/registry.js';
import { fetchHistory } from './market/history.js';
import { backtest } from './backtest.js';
import { KILL_SWITCH_FILE, killSwitchEngaged, engageKillSwitch, clearKillSwitch } from './risk/guard.js';

const OPTIONS = {
  mode: { type: 'string' },
  config: { type: 'string' },
  strategy: { type: 'string' },
  timeframe: { type: 'string' },
  instrument: { type: 'string', multiple: true },
  bars: { type: 'string' },
  environment: { type: 'string' },
  'log-level': { type: 'string' },
  json: { type: 'boolean' },
  yes: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const USAGE = `
cdc-trader -- automated spot trading on the Crypto.com Exchange

  node src/index.js <command> [options]

Commands
  run                  start the trading loop
  backtest             replay the strategy over historical candles
  balance              print balances as the exchange reports them
  instruments          list tradable spot pairs for the quote currency
  strategies           list the built-in strategies
  status               print the saved state and exit
  flatten              close every open position, then exit
  verify               check the API credentials and clock
  kill on|off          engage or clear the kill switch

Options
  --mode paper|live    override the configured mode (default: paper)
  --config <path>      config file (default: ./config.json)
  --strategy <name>    override the configured strategy
  --timeframe <tf>     1m 5m 15m 30m 1h 4h 6h 12h 1D 7D 14D 1M
  --instrument <SYM>   override instruments; repeatable, e.g. --instrument BTC_USD
  --bars <n>           candles of history for backtest (default 1000)
  --environment <env>  production or sandbox
  --log-level <level>  debug, info, warn, error
  --json               machine-readable output where it makes sense
  --yes                skip the live-trading confirmation prompt
  -h, --help           this message

Live trading also needs CDC_LIVE_CONFIRM=${LIVE_CONFIRMATION} in the environment.
`;

async function main() {
  loadEnv();

  let parsed;
  try {
    parsed = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true });
  } catch (err) {
    fail(err.message);
  }
  const { values, positionals } = parsed;
  const command = positionals[0] ?? 'help';

  if (values.help || command === 'help') {
    process.stdout.write(USAGE);
    return;
  }

  const overrides = {};
  if (values.mode) overrides.mode = values.mode;
  if (values.timeframe) overrides.timeframe = values.timeframe;
  if (values.environment) overrides.environment = values.environment;
  if (values.instrument?.length) overrides.instruments = values.instrument;

  const configPath = values.config ? resolve(values.config) : resolve(PROJECT_ROOT, 'config.json');
  let config;
  try {
    config = loadConfig(configPath, overrides);
    if (values.strategy) {
      // Overriding the strategy from the flag means the configured params no longer
      // apply, so fall back to that strategy's defaults rather than mixing them.
      config.strategy = { name: values.strategy, params: {} };
      config = loadConfig(configPath, { ...overrides, strategy: config.strategy });
    }
  } catch (err) {
    fail(err.message);
  }

  configureLogging({
    level: values['log-level'] ?? config.logging.level,
    file: config.logging.file ? resolve(PROJECT_ROOT, config.logging.file) : null,
  });

  switch (command) {
    case 'run': return run(config, values);
    case 'backtest': return runBacktest(config, values);
    case 'balance': return showBalance(config, values);
    case 'instruments': return showInstruments(config, values);
    case 'strategies': return showStrategies(values);
    case 'status': return showStatus(config, values);
    case 'flatten': return runFlatten(config);
    case 'verify': return verify(config);
    case 'kill': return toggleKill(positionals[1]);
    default: fail(`unknown command "${command}". Run with --help for usage.`);
  }
}

// ---- wiring ---------------------------------------------------------------

function makeClient(config) {
  return new CryptoComClient({
    apiKey: config.credentials.apiKey,
    apiSecret: config.credentials.apiSecret,
    environment: config.environment,
  });
}

async function build(config) {
  const client = makeClient(config);
  const catalogue = new InstrumentCatalogue(client);
  await catalogue.refresh();
  catalogue.validateAll(config.instruments, config.quoteCurrency);

  const store = new StateStore();
  store.load(config.mode, config.quoteCurrency, config.paper.startingQuote);

  const broker =
    config.mode === 'live'
      ? new LiveBroker({ client, catalogue, config })
      : new PaperBroker({ store, catalogue, config });

  return { client, catalogue, store, broker, engine: new Engine({ config, client, catalogue, broker, store }) };
}

// ---- commands -------------------------------------------------------------

async function run(config, values) {
  if (config.mode === 'live') {
    await confirmLive(config, values);
  } else {
    log.info('paper mode: simulated balances, real prices, no orders sent');
  }

  const { engine, client } = await build(config);
  if (config.mode === 'live') await client.verifyCredentials();

  if (killSwitchEngaged()) {
    log.warn('kill switch is engaged; the bot will manage open positions but open nothing new', {
      file: KILL_SWITCH_FILE,
    });
  }

  const server = config.dashboard.enabled
    ? startDashboard(engine, {
        port: config.dashboard.port,
        // New every run, so a link left open in a browser tab from last time
        // cannot drive this one.
        token: newSessionToken(),
        onFlatten: () => engine.flatten('dashboard'),
      })
    : null;

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      log.warn('second signal, exiting now');
      process.exit(1);
    }
    shuttingDown = true;
    log.info('shutting down', { signal });
    engine.stop();
    server?.close();
    // Positions are deliberately left open. Closing them on every restart would
    // turn a routine deploy into a guaranteed round trip of fees and slippage.
    // Use `flatten` when you actually want to be out of the market.
    const open = Object.keys(engine.state.positions);
    if (open.length) log.warn('positions left open', { instruments: open.join(','), hint: 'run `flatten` to close them' });
    setTimeout(() => process.exit(0), 250);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await engine.run();
}

async function runBacktest(config, values) {
  const bars = Number(values.bars ?? 1000);
  if (!Number.isInteger(bars) || bars < 50) fail('--bars must be a whole number of at least 50');

  const client = makeClient(config);
  const catalogue = new InstrumentCatalogue(client);
  await catalogue.refresh();
  catalogue.validateAll(config.instruments, config.quoteCurrency);

  const results = [];
  for (const symbol of config.instruments) {
    log.info('fetching history', { instrument: symbol, bars, timeframe: config.timeframe });
    const candles = await fetchHistory(client, symbol, config.timeframe, bars);
    const result = backtest({ candles, config, instrument: catalogue.get(symbol), symbol });
    results.push(result);
  }

  if (values.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }
  for (const result of results) printBacktest(result, config);
}

function printBacktest(r, config) {
  const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const money = (n) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}`;
  process.stdout.write(`
${r.strategy} on ${r.tradeLog[0]?.instrument ?? config.instruments.join(', ')}  ${config.timeframe}
${r.from.slice(0, 16)} to ${r.to.slice(0, 16)}  (${r.bars} bars)
Parameters: ${JSON.stringify(r.params)}

  Starting balance     ${r.startingCash.toFixed(2)} ${config.quoteCurrency}
  Ending balance       ${r.endingCash.toFixed(2)} ${config.quoteCurrency}
  Strategy return      ${pct(r.totalReturnPct)}
  Buy and hold         ${pct(r.buyHoldReturnPct)}
  Edge over holding    ${pct(r.totalReturnPct - r.buyHoldReturnPct)}

  Trades               ${r.trades}  (${r.wins} won, ${r.losses} lost)
  Win rate             ${r.winRatePct.toFixed(1)}%
  Average win          ${money(r.averageWin)}
  Average loss         ${money(-r.averageLoss)}
  Profit factor        ${r.profitFactor === Infinity ? 'no losses' : r.profitFactor.toFixed(2)}
  Max drawdown         ${r.maxDrawdownPct.toFixed(2)}%
  Sharpe (annualised)  ${r.sharpe.toFixed(2)}
  Fees paid            ${r.feesPaid.toFixed(2)} ${config.quoteCurrency}

`);
  if (r.trades < 20) {
    process.stdout.write(
      `  Note: ${r.trades} trades is too few to conclude anything. Test a longer period\n` +
        `  before trusting these numbers.\n\n`,
    );
  }
}

async function showBalance(config, values) {
  const client = makeClient(config);
  const accounts = await client.getUserBalance();
  if (values.json) {
    process.stdout.write(JSON.stringify(accounts, null, 2) + '\n');
    return;
  }
  for (const account of accounts) {
    process.stdout.write(
      `\nAccount ${account.instrument_name}\n` +
        `  Total cash balance    ${account.total_cash_balance}\n` +
        `  Available balance     ${account.total_available_balance}\n\n` +
        `  Holdings\n`,
    );
    const holdings = (account.position_balances ?? []).filter((p) => Number(p.quantity) > 0);
    if (!holdings.length) process.stdout.write('    (none)\n');
    for (const position of holdings) {
      process.stdout.write(
        `    ${position.instrument_name.padEnd(8)} ${String(position.quantity).padStart(18)}` +
          `   value ${Number(position.market_value ?? 0).toFixed(2)}\n`,
      );
    }
    process.stdout.write('\n');
  }
}

async function showInstruments(config, values) {
  const client = makeClient(config);
  const catalogue = new InstrumentCatalogue(client);
  await catalogue.refresh();

  const matches = [...catalogue.bySymbol.values()]
    .filter((i) => i.type === 'CCY_PAIR' && i.tradable && i.quoteCurrency === config.quoteCurrency)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  if (values.json) {
    process.stdout.write(JSON.stringify(matches, null, 2) + '\n');
    return;
  }
  process.stdout.write(`\n${matches.length} tradable spot pairs quoted in ${config.quoteCurrency}\n\n`);
  process.stdout.write(`  ${'SYMBOL'.padEnd(16)}${'PRICE TICK'.padStart(14)}${'QTY TICK'.padStart(16)}\n`);
  for (const i of matches) {
    process.stdout.write(`  ${i.symbol.padEnd(16)}${i.priceTickSize.padStart(14)}${i.qtyTickSize.padStart(16)}\n`);
  }
  process.stdout.write('\n');
}

function showStrategies(values) {
  const strategies = listStrategies();
  if (values.json) {
    process.stdout.write(JSON.stringify(strategies, null, 2) + '\n');
    return;
  }
  process.stdout.write('\n');
  for (const s of strategies) {
    process.stdout.write(`  ${s.name}\n    ${s.description}\n    defaults: ${JSON.stringify(s.defaults)}\n\n`);
  }
}

function showStatus(config, values) {
  const store = new StateStore();
  if (!existsSync(store.file)) {
    process.stdout.write('No saved state yet -- the bot has not run.\n');
    return;
  }
  const state = JSON.parse(readFileSync(store.file, 'utf8'));
  if (values.json) {
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    return;
  }
  const positions = Object.values(state.positions);
  process.stdout.write(`
  Mode                 ${state.mode}
  Halted               ${state.halted ? `yes (${state.haltReason})` : 'no'}
  Kill switch          ${killSwitchEngaged() ? 'ENGAGED' : 'clear'}
  Today (${state.day.date})   ${state.day.realisedPnl.toFixed(2)} over ${state.day.trades} trades
  Realised total       ${state.totals.realisedPnl.toFixed(2)} over ${state.totals.trades} trades
  Won / lost           ${state.totals.wins} / ${state.totals.losses}
  Fees paid            ${state.totals.fees.toFixed(2)}
  Open positions       ${positions.length}
`);
  for (const p of positions) {
    process.stdout.write(
      `    ${p.instrument.padEnd(10)} ${String(p.quantity).padStart(14)} @ ${p.entryPrice.toFixed(4)}` +
        `  cost ${p.costBasis.toFixed(2)}\n`,
    );
  }
  process.stdout.write('\n');
}

async function runFlatten(config) {
  const { engine } = await build(config);
  await engine.flatten('flatten command');
}

async function verify(config) {
  const client = makeClient(config);
  if (!client.authenticated) fail('no credentials found. Copy .env.example to .env and fill it in.');
  await client.verifyCredentials();
  process.stdout.write('Credentials are valid.\n');
}

function toggleKill(argument) {
  if (argument === 'on') {
    engageKillSwitch('cli');
    process.stdout.write(`Kill switch engaged. No new positions will be opened.\n${KILL_SWITCH_FILE}\n`);
  } else if (argument === 'off') {
    clearKillSwitch();
    process.stdout.write('Kill switch cleared.\n');
  } else {
    fail('usage: kill on|off');
  }
}

/** Make the operator type the mode out before any real money moves. */
async function confirmLive(config, values) {
  const banner = `
  ============================================================
   LIVE TRADING
   Environment   ${config.environment}
   Strategy      ${config.strategy.name}
   Instruments   ${config.instruments.join(', ')}
   Max per trade ${config.risk.maxPositionQuote} ${config.quoteCurrency}
   Max exposure  ${config.risk.maxTotalExposureQuote} ${config.quoteCurrency}
   Daily loss    stops trading at -${config.risk.dailyLossLimitQuote} ${config.quoteCurrency}

   This places real orders and spends real money.
  ============================================================
`;
  process.stdout.write(banner);
  if (values.yes) return;
  if (!process.stdin.isTTY) {
    fail('live mode needs a terminal to confirm, or pass --yes if you are running it unattended');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('  Type LIVE to continue: ');
  rl.close();
  if (answer.trim() !== 'LIVE') fail('not confirmed; nothing was started');
}

function fail(message) {
  process.stderr.write(`\nError: ${message}\n\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`\nError: ${err.message}\n`);
  if (process.env.CDC_DEBUG) process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
