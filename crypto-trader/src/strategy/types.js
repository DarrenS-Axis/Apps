/**
 * Shared strategy shapes.
 *
 * A strategy is deliberately small: given closed candles and whether a position is
 * already open, say `buy`, `sell` or `hold`, and say why. It decides direction and
 * timing only. Position size, stop losses, take profits and every hard limit belong
 * to the risk layer, so there is exactly one place where an order can be vetoed and
 * no strategy can talk its way around it.
 *
 * @typedef {{ time: number, open: number, high: number, low: number, close: number, volume: number }} Candle
 *
 * @typedef {object} Position
 * @property {string} instrument
 * @property {number} quantity      base units held
 * @property {number} entryPrice
 * @property {number} entryTime
 * @property {number} highWaterMark best price seen since entry, for trailing stops
 *
 * @typedef {object} StrategyContext
 * @property {Candle[]} candles  closed candles, oldest first
 * @property {number} index      the bar being evaluated; never read beyond it
 * @property {Position|null} position
 *
 * @typedef {object} Signal
 * @property {'buy'|'sell'|'hold'} action
 * @property {string} reason
 *
 * @typedef {object} Strategy
 * @property {string} name
 * @property {string} description
 * @property {Record<string, number>} defaults
 * @property {(params: Record<string, number>) => number} warmup  bars needed before the first signal
 * @property {(ctx: StrategyContext, params: Record<string, number>) => Signal} evaluate
 */

export const HOLD = Object.freeze({ action: 'hold', reason: 'no setup' });

/** @returns {Signal} */
export function buy(reason) {
  return { action: 'buy', reason };
}

/** @returns {Signal} */
export function sell(reason) {
  return { action: 'sell', reason };
}

/** @returns {Signal} */
export function hold(reason = 'no setup') {
  return { action: 'hold', reason };
}
