import { priorHighest, priorLowest, atr, sma } from './indicators.js';
import { buy, sell, hold } from './types.js';

/**
 * Donchian channel breakout.
 *
 * Buys when price closes above the highest high of the lookback window, exits when
 * it closes below the lowest low of a shorter window. Entries are gated on the bar
 * having real range behind it (measured with ATR), which filters out the drifting,
 * illiquid breakouts that look identical on a chart and behave nothing alike.
 *
 * @type {import('./types.js').Strategy}
 */
export const breakout = {
  name: 'donchian-breakout',
  description: 'Buys closes above an N-bar high, exits below an M-bar low',
  defaults: { entryPeriod: 20, exitPeriod: 10, atrPeriod: 14, minAtrPct: 0.15, trendPeriod: 0 },

  warmup({ entryPeriod, atrPeriod, trendPeriod }) {
    return Math.max(entryPeriod, atrPeriod, trendPeriod || 0) + 2;
  },

  evaluate({ candles, index, position }, { entryPeriod, exitPeriod, atrPeriod, minAtrPct, trendPeriod }) {
    const window = candles.slice(0, index + 1);
    const i = window.length - 1;
    const close = window[i].close;

    if (!position) {
      const highs = priorHighest(window, entryPeriod);
      if (highs[i] === null) return hold('warming up');
      if (close <= highs[i]) return hold(`below the ${entryPeriod}-bar high`);

      // Require the instrument to actually be moving, not just grinding sideways.
      if (minAtrPct > 0) {
        const ranges = atr(window, atrPeriod);
        if (ranges[i] === null) return hold('warming up ATR');
        const atrPct = (ranges[i] / close) * 100;
        if (atrPct < minAtrPct) return hold(`range too thin (ATR ${atrPct.toFixed(2)}%)`);
      }
      if (trendPeriod > 0) {
        const closes = window.map((c) => c.close);
        const trend = sma(closes, trendPeriod);
        if (trend[i] === null) return hold('warming up trend filter');
        if (close < trend[i]) return hold(`below the ${trendPeriod}-bar trend`);
      }
      return buy(`closed above the ${entryPeriod}-bar high`);
    }

    const lows = priorLowest(window, exitPeriod);
    if (lows[i] !== null && close < lows[i]) {
      return sell(`closed below the ${exitPeriod}-bar low`);
    }
    return hold('breakout intact');
  },
};
