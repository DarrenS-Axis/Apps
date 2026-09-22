/**
 * Technical indicators.
 *
 * Every function takes an array of numbers (oldest first) and returns an array of
 * the same length, with `null` in the leading positions where there is not yet
 * enough history. Keeping the lengths aligned means a strategy can index candles
 * and indicators with the same `i` and never read a value that silently borrowed
 * from the future.
 */

/** Simple moving average. */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) throw new RangeError('period must be positive');
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the first SMA so it is deterministic. */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI, 0-100. */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Average true range, in price units. Takes candles, not closes. */
export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;

  const trueRanges = candles.map((candle, i) => {
    if (i === 0) return candle.high - candle.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose),
    );
  });

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRanges[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + trueRanges[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Rolling population standard deviation. */
export function stdev(values, period) {
  const out = new Array(values.length).fill(null);
  const means = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    const mean = means[i];
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

/** Bollinger bands as `{ upper, middle, lower }` arrays. */
export function bollinger(values, period = 20, multiplier = 2) {
  const middle = sma(values, period);
  const deviation = stdev(values, period);
  const upper = middle.map((m, i) => (m === null ? null : m + multiplier * deviation[i]));
  const lower = middle.map((m, i) => (m === null ? null : m - multiplier * deviation[i]));
  return { upper, middle, lower };
}

/** Highest high over the previous `period` bars, excluding the current one. */
export function priorHighest(candles, period) {
  const out = new Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    let best = -Infinity;
    for (let j = i - period; j < i; j++) best = Math.max(best, candles[j].high);
    out[i] = best;
  }
  return out;
}

/** Lowest low over the previous `period` bars, excluding the current one. */
export function priorLowest(candles, period) {
  const out = new Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    let worst = Infinity;
    for (let j = i - period; j < i; j++) worst = Math.min(worst, candles[j].low);
    out[i] = worst;
  }
  return out;
}

/** True when `fast` moved from at-or-below `slow` to above it on bar `i`. */
export function crossedAbove(fast, slow, i) {
  if (i < 1) return false;
  const [a0, a1, b0, b1] = [fast[i - 1], fast[i], slow[i - 1], slow[i]];
  if ([a0, a1, b0, b1].some((v) => v === null || v === undefined)) return false;
  return a0 <= b0 && a1 > b1;
}

/** True when `fast` moved from at-or-above `slow` to below it on bar `i`. */
export function crossedBelow(fast, slow, i) {
  if (i < 1) return false;
  const [a0, a1, b0, b1] = [fast[i - 1], fast[i], slow[i - 1], slow[i]];
  if ([a0, a1, b0, b1].some((v) => v === null || v === undefined)) return false;
  return a0 >= b0 && a1 < b1;
}
