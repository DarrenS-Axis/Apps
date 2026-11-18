import { rsi, sma } from './indicators.js';
import { buy, sell, hold } from './types.js';

/**
 * Mean reversion on RSI.
 *
 * Buys when RSI climbs back out of oversold -- waiting for the turn rather than
 * buying the instant it goes oversold, because in a real downtrend "oversold" can
 * keep going for a long time. Sells when RSI reaches overbought.
 *
 * @type {import('./types.js').Strategy}
 */
export const rsiReversion = {
  name: 'rsi-reversion',
  description: 'Buys the recovery out of oversold RSI, sells into overbought',
  defaults: { rsiPeriod: 14, oversold: 30, overbought: 70, trendPeriod: 200 },

  warmup({ rsiPeriod, trendPeriod }) {
    return Math.max(rsiPeriod * 3, trendPeriod || 0) + 2;
  },

  evaluate({ candles, index, position }, { rsiPeriod, oversold, overbought, trendPeriod }) {
    const closes = candles.slice(0, index + 1).map((c) => c.close);
    const values = rsi(closes, rsiPeriod);
    const i = closes.length - 1;
    const now = values[i];
    const before = values[i - 1];

    if (now === null || before === null || before === undefined) return hold('warming up');

    if (!position) {
      const turningUp = before <= oversold && now > oversold;
      if (!turningUp) return hold(`RSI ${now.toFixed(1)}, waiting for a turn out of ${oversold}`);
      if (trendPeriod > 0) {
        const trend = sma(closes, trendPeriod);
        if (trend[i] === null) return hold('warming up trend filter');
        if (closes[i] < trend[i]) return hold(`below the ${trendPeriod}-bar trend`);
      }
      return buy(`RSI recovered through ${oversold} to ${now.toFixed(1)}`);
    }

    if (now >= overbought) return sell(`RSI reached ${now.toFixed(1)}, at or above ${overbought}`);
    return hold(`RSI ${now.toFixed(1)}, holding`);
  },
};
