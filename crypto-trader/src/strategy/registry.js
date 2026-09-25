import { smaCross } from './smaCross.js';
import { rsiReversion } from './rsiReversion.js';
import { breakout } from './breakout.js';

/** @type {Record<string, import('./types.js').Strategy>} */
const STRATEGIES = {
  [smaCross.name]: smaCross,
  [rsiReversion.name]: rsiReversion,
  [breakout.name]: breakout,
};

export function getStrategy(name) {
  const strategy = STRATEGIES[name];
  if (!strategy) {
    throw new Error(`unknown strategy "${name}"; available: ${Object.keys(STRATEGIES).join(', ')}`);
  }
  return strategy;
}

export function listStrategies() {
  return Object.values(STRATEGIES).map(({ name, description, defaults }) => ({
    name,
    description,
    defaults,
  }));
}

/** Strategy defaults, overridden by whatever the config supplies. */
export function resolveParams(strategy, overrides = {}) {
  const params = { ...strategy.defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in strategy.defaults)) {
      throw new Error(
        `strategy "${strategy.name}" has no parameter "${key}"; expected one of ${Object.keys(strategy.defaults).join(', ')}`,
      );
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`strategy parameter "${key}" must be a number, got ${JSON.stringify(value)}`);
    }
    params[key] = value;
  }
  return params;
}
