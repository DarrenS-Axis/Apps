/**
 * Historical candle fetching.
 *
 * The exchange returns at most 300 candles per call, so anything longer is walked
 * backwards a window at a time and stitched together.
 */
import { TIMEFRAME_MS } from '../config.js';
import { log } from '../log.js';

const MAX_PER_CALL = 300;

/**
 * @param {import('../exchange/client.js').CryptoComClient} client
 * @param {string} instrument
 * @param {string} timeframe
 * @param {number} bars how many candles are wanted
 */
export async function fetchHistory(client, instrument, timeframe, bars) {
  const step = TIMEFRAME_MS[timeframe];
  if (!step) throw new Error(`unsupported timeframe "${timeframe}"`);

  const collected = new Map();
  let endTs = Date.now();

  while (collected.size < bars) {
    const want = Math.min(MAX_PER_CALL, bars - collected.size);
    const startTs = endTs - want * step;

    const batch = await client.getCandlesticks(instrument, timeframe, {
      count: want,
      startTs,
      endTs,
    });
    if (batch.length === 0) {
      log.warn('history ran out early', { instrument, have: collected.size, wanted: bars });
      break;
    }

    const before = collected.size;
    for (const candle of batch) collected.set(candle.time, candle);
    if (collected.size === before) break; // no progress; the exchange has no more

    endTs = batch[0].time - 1;
    log.debug('fetched history', { instrument, have: collected.size, wanted: bars });
  }

  const candles = [...collected.values()].sort((a, b) => a.time - b.time);
  // Drop the candle still forming, so a backtest never sees a partial bar.
  const now = Date.now();
  return candles.filter((candle) => candle.time + step <= now).slice(-bars);
}
