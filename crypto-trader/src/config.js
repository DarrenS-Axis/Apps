/**
 * Configuration loading and validation.
 *
 * Secrets come from the environment (.env), everything else from config.json.
 * They are kept apart on purpose: config.json is safe to commit and diff, the
 * .env file never leaves the machine.
 *
 * Validation is strict and refuses unknown keys. A typo in a risk limit would
 * otherwise sit there silently reading as "unlimited", which is the worst possible
 * failure mode for this program.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The phrase that must be in the environment before a real order can be sent. */
export const LIVE_CONFIRMATION = 'I_ACCEPT_THE_RISK';

const VALID_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1D', '7D', '14D', '1M'];

export const TIMEFRAME_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '1D': 86_400_000,
  '7D': 604_800_000,
  '14D': 1_209_600_000,
  '1M': 2_592_000_000,
};

const DEFAULTS = {
  environment: 'production',
  mode: 'paper',
  quoteCurrency: 'USD',
  instruments: ['BTC_USD'],
  timeframe: '15m',
  pollSeconds: 30,
  strategy: { name: 'sma-cross', params: {} },
  risk: {
    maxPositionQuote: 100,
    maxTotalExposureQuote: 300,
    maxOpenPositions: 2,
    maxTradesPerDay: 10,
    dailyLossLimitQuote: 50,
    minSecondsBetweenTrades: 60,
    stopLossPct: 3,
    takeProfitPct: 6,
    trailingStopPct: 0,
    reserveQuote: 0,
  },
  execution: {
    orderType: 'LIMIT',
    limitOffsetBps: 5,
    slippageBps: 10,
    takerFeeBps: 7.5,
    makerFeeBps: 7.5,
    maxSpreadBps: 50,
  },
  paper: { startingQuote: 1000 },
  dashboard: { enabled: true, port: 8787 },
  logging: { level: 'info', file: 'data/trader.log' },
};

class ConfigError extends Error {
  constructor(message) {
    super(`config: ${message}`);
    this.name = 'ConfigError';
  }
}

/** Load .env into process.env without overwriting anything already set. */
export function loadEnv(path = resolve(PROJECT_ROOT, '.env')) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function mergeSection(name, defaults, supplied) {
  if (supplied === undefined) return { ...defaults };
  if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) {
    throw new ConfigError(`"${name}" must be an object`);
  }
  for (const key of Object.keys(supplied)) {
    if (!(key in defaults)) {
      throw new ConfigError(
        `unknown key "${name}.${key}"; expected one of ${Object.keys(defaults).join(', ')}`,
      );
    }
  }
  return { ...defaults, ...supplied };
}

function requireNumber(value, path, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`"${path}" must be a finite number, got ${JSON.stringify(value)}`);
  }
  if (integer && !Number.isInteger(value)) throw new ConfigError(`"${path}" must be a whole number`);
  if (value < min) throw new ConfigError(`"${path}" must be at least ${min}, got ${value}`);
  if (value > max) throw new ConfigError(`"${path}" must be at most ${max}, got ${value}`);
  return value;
}

function requireOneOf(value, path, allowed) {
  if (!allowed.includes(value)) {
    throw new ConfigError(`"${path}" must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Read, merge and validate the configuration.
 * @param {string} [configPath]
 * @param {Record<string, unknown>} [overrides] values from CLI flags
 */
export function loadConfig(configPath = resolve(PROJECT_ROOT, 'config.json'), overrides = {}) {
  let fileConfig = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new ConfigError(`${configPath} is not valid JSON: ${err.message}`);
    }
  }

  for (const key of Object.keys(fileConfig)) {
    if (!(key in DEFAULTS)) {
      throw new ConfigError(`unknown key "${key}"; expected one of ${Object.keys(DEFAULTS).join(', ')}`);
    }
  }

  const merged = {
    ...DEFAULTS,
    ...fileConfig,
    strategy: mergeSection('strategy', DEFAULTS.strategy, fileConfig.strategy),
    risk: mergeSection('risk', DEFAULTS.risk, fileConfig.risk),
    execution: mergeSection('execution', DEFAULTS.execution, fileConfig.execution),
    paper: mergeSection('paper', DEFAULTS.paper, fileConfig.paper),
    dashboard: mergeSection('dashboard', DEFAULTS.dashboard, fileConfig.dashboard),
    logging: mergeSection('logging', DEFAULTS.logging, fileConfig.logging),
    ...overrides,
  };

  requireOneOf(merged.environment, 'environment', ['production', 'sandbox']);
  requireOneOf(merged.mode, 'mode', ['paper', 'live']);
  requireOneOf(merged.timeframe, 'timeframe', VALID_TIMEFRAMES);
  requireNumber(merged.pollSeconds, 'pollSeconds', { min: 5, max: 3600, integer: true });

  if (typeof merged.quoteCurrency !== 'string' || !merged.quoteCurrency) {
    throw new ConfigError('"quoteCurrency" must be a non-empty string');
  }
  if (!Array.isArray(merged.instruments) || merged.instruments.length === 0) {
    throw new ConfigError('"instruments" must be a non-empty array, e.g. ["BTC_USD"]');
  }
  for (const instrument of merged.instruments) {
    if (typeof instrument !== 'string' || !/^[A-Z0-9]+_[A-Z0-9]+$/.test(instrument)) {
      throw new ConfigError(
        `instrument ${JSON.stringify(instrument)} does not look like an exchange symbol, e.g. "BTC_USD"`,
      );
    }
  }
  if (new Set(merged.instruments).size !== merged.instruments.length) {
    throw new ConfigError('"instruments" contains duplicates');
  }

  const r = merged.risk;
  requireNumber(r.maxPositionQuote, 'risk.maxPositionQuote', { min: 0.01 });
  requireNumber(r.maxTotalExposureQuote, 'risk.maxTotalExposureQuote', { min: 0.01 });
  requireNumber(r.maxOpenPositions, 'risk.maxOpenPositions', { min: 1, max: 50, integer: true });
  requireNumber(r.maxTradesPerDay, 'risk.maxTradesPerDay', { min: 1, max: 1000, integer: true });
  requireNumber(r.dailyLossLimitQuote, 'risk.dailyLossLimitQuote', { min: 0.01 });
  requireNumber(r.minSecondsBetweenTrades, 'risk.minSecondsBetweenTrades', { min: 0, max: 86400 });
  requireNumber(r.stopLossPct, 'risk.stopLossPct', { min: 0, max: 100 });
  requireNumber(r.takeProfitPct, 'risk.takeProfitPct', { min: 0, max: 1000 });
  requireNumber(r.trailingStopPct, 'risk.trailingStopPct', { min: 0, max: 100 });
  requireNumber(r.reserveQuote, 'risk.reserveQuote', { min: 0 });

  if (r.maxPositionQuote > r.maxTotalExposureQuote) {
    throw new ConfigError(
      `risk.maxPositionQuote (${r.maxPositionQuote}) cannot exceed risk.maxTotalExposureQuote (${r.maxTotalExposureQuote})`,
    );
  }
  if (r.stopLossPct === 0 && r.trailingStopPct === 0) {
    throw new ConfigError(
      'set risk.stopLossPct or risk.trailingStopPct above 0; running with no stop at all is not supported',
    );
  }

  const e = merged.execution;
  requireOneOf(e.orderType, 'execution.orderType', ['MARKET', 'LIMIT']);
  requireNumber(e.limitOffsetBps, 'execution.limitOffsetBps', { min: 0, max: 1000 });
  requireNumber(e.slippageBps, 'execution.slippageBps', { min: 0, max: 1000 });
  requireNumber(e.takerFeeBps, 'execution.takerFeeBps', { min: 0, max: 500 });
  requireNumber(e.makerFeeBps, 'execution.makerFeeBps', { min: 0, max: 500 });
  requireNumber(e.maxSpreadBps, 'execution.maxSpreadBps', { min: 1, max: 10000 });

  requireNumber(merged.paper.startingQuote, 'paper.startingQuote', { min: 1 });
  requireNumber(merged.dashboard.port, 'dashboard.port', { min: 1024, max: 65535, integer: true });
  requireOneOf(merged.logging.level, 'logging.level', ['debug', 'info', 'warn', 'error']);

  merged.credentials = {
    apiKey: process.env.CDC_API_KEY ?? null,
    apiSecret: process.env.CDC_API_SECRET ?? null,
  };
  merged.liveConfirmed = process.env.CDC_LIVE_CONFIRM === LIVE_CONFIRMATION;

  if (merged.mode === 'live') {
    if (!merged.credentials.apiKey || !merged.credentials.apiSecret) {
      throw new ConfigError('live mode needs CDC_API_KEY and CDC_API_SECRET in the environment');
    }
    if (!merged.liveConfirmed) {
      throw new ConfigError(
        `live mode is an explicit opt-in. Set CDC_LIVE_CONFIRM=${LIVE_CONFIRMATION} in your environment ` +
          'once you have read the README and run the strategy in paper mode first.',
      );
    }
  }

  return merged;
}

export { DEFAULTS, ConfigError, VALID_TIMEFRAMES };
