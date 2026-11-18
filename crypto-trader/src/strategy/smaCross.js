import { sma, crossedAbove, crossedBelow } from './indicators.js';
import { buy, sell, hold } from './types.js';

/**
 * Moving-average crossover, the classic trend follower.
 *
 * Buys when the fast average crosses up through the slow one and sells when it
 * crosses back down. An optional long-term filter keeps it from buying into a
 * downtrend, which is where a naive crossover does most of its damage.
 *
 * @type {import('./types.js').Strategy}
 */
export const smaCross = {
  name: 'sma-cross',
  description: 'Fast/slow moving-average crossover with an optional long-term trend filter',
  defaults: { fastPeriod: 12, slowPeriod: 26, trendPeriod: 100 },

  warmup({ slowPeriod, trendPeriod }) {
    return Math.max(slowPeriod, trendPeriod || 0) + 2;
  },

  evaluate({ candles, index, position }, { fastPeriod, slowPeriod, trendPeriod }) {
    const closes = candles.slice(0, index + 1).map((c) => c.close);
    const fast = sma(closes, fastPeriod);
    const slow = sma(closes, slowPeriod);
    const i = closes.length - 1;

    if (fast[i] === null || slow[i] === null) return hold('warming up');

    if (!position) {
      if (!crossedAbove(fast, slow, i)) return hold('no upward cross');
      if (trendPeriod > 0) {
        const trend = sma(closes, trendPeriod);
        if (trend[i] === null) return hold('warming up trend filter');
        if (closes[i] < trend[i]) return hold(`below the ${trendPeriod}-bar trend`);
      }
      return buy(`fast SMA(${fastPeriod}) crossed above slow SMA(${slowPeriod})`);
    }

    if (crossedBelow(fast, slow, i)) {
      return sell(`fast SMA(${fastPeriod}) crossed below slow SMA(${slowPeriod})`);
    }
    return hold('trend intact');
  },
};
