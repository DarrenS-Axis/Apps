/**
 * Backtester.
 *
 * Replays a strategy over historical candles using the same risk limits, fees and
 * slippage as live trading, so the two do not quietly diverge.
 *
 * Three rules keep the results honest:
 *
 *   - A signal generated on the close of bar `i` fills at the OPEN of bar `i + 1`.
 *     Filling at the close of the bar that produced the signal is look-ahead bias,
 *     and it is the single most common reason a backtest looks wonderful and the
 *     live bot does not.
 *   - Stops and targets are checked against each bar's high and low. When a bar
 *     spans both, the stop is assumed to have been hit first. Without that
 *     assumption a backtest awards itself the better of two outcomes on every
 *     volatile bar.
 *   - Fees and slippage are charged on both sides at the configured rates.
 *
 * It still cannot model order book depth, outages, or the market's reaction to
 * your own orders. Treat a good backtest as "not obviously broken", not as a
 * forecast.
 */
import { getStrategy, resolveParams } from './strategy/registry.js';
import { protectiveExit } from './risk/guard.js';
import { feeFor, withSlippage } from './exec/broker.js';
import { formatQuantity } from './exec/sizing.js';

/**
 * @param {object} opts
 * @param {import('./strategy/types.js').Candle[]} opts.candles
 * @param {object} opts.config
 * @param {{qtyTickSize: string}} opts.instrument
 * @param {string} opts.symbol
 */
export function backtest({ candles, config, instrument, symbol }) {
  const strategy = getStrategy(config.strategy.name);
  const params = resolveParams(strategy, config.strategy.params);
  const warmup = strategy.warmup(params);
  const { slippageBps, takerFeeBps } = config.execution;
  const risk = config.risk;

  if (candles.length <= warmup + 2) {
    throw new Error(
      `need more than ${warmup + 2} candles to test "${strategy.name}", got ${candles.length}`,
    );
  }

  let cash = config.paper.startingQuote;
  const startingCash = cash;
  /** @type {import('./strategy/types.js').Position|null} */
  let position = null;
  let pendingEntry = null;
  let pendingExit = null;

  const trades = [];
  const equityCurve = [];
  let peakEquity = cash;
  let maxDrawdown = 0;
  let feesPaid = 0;
  let tradesToday = 0;
  let currentDay = null;
  let dayPnl = 0;
  let halted = false;

  for (let i = warmup; i < candles.length; i++) {
    const bar = candles[i];
    const day = new Date(bar.time).toISOString().slice(0, 10);
    if (day !== currentDay) {
      currentDay = day;
      tradesToday = 0;
      dayPnl = 0;
      halted = false;
    }

    // --- fills queued by the previous bar, at this bar's open ------------------
    if (pendingExit && position) {
      const price = withSlippage(bar.open, 'sell', slippageBps);
      ({ cash, dayPnl } = closeAt({ price, reason: pendingExit, kind: 'signal' }));
      pendingExit = null;
    }
    if (pendingEntry && !position && !halted) {
      const price = withSlippage(bar.open, 'buy', slippageBps);
      openAt(price, pendingEntry, bar.time);
      pendingEntry = null;
    }

    // --- protective exits, intrabar -------------------------------------------
    if (position) {
      position.highWaterMark = Math.max(position.highWaterMark, bar.high);

      const atLow = protectiveExit(position, bar.low, risk);
      const atHigh = protectiveExit(position, bar.high, risk);

      // Stop first when a bar could have hit both, and note that a trailing stop
      // must be judged at the low even though the high set the peak.
      if (atLow.hit && (atLow.kind === 'stop-loss' || atLow.kind === 'trailing-stop')) {
        const stopPrice = stopPriceFor(position, atLow.kind, risk);
        ({ cash, dayPnl } = closeAt({
          price: withSlippage(Math.min(stopPrice, bar.open), 'sell', slippageBps),
          reason: atLow.reason,
          kind: atLow.kind,
        }));
      } else if (atHigh.hit && atHigh.kind === 'take-profit') {
        const target = position.entryPrice * (1 + risk.takeProfitPct / 100);
        ({ cash, dayPnl } = closeAt({
          price: withSlippage(Math.max(target, bar.open), 'sell', slippageBps),
          reason: atHigh.reason,
          kind: 'take-profit',
        }));
      }
    }

    // --- the strategy sees the closed bar and queues the next fill -------------
    if (-dayPnl >= risk.dailyLossLimitQuote) halted = true;

    const signal = strategy.evaluate({ candles, index: i, position }, params);
    if (signal.action === 'buy' && !position && !halted && tradesToday < risk.maxTradesPerDay) {
      pendingEntry = signal.reason;
    } else if (signal.action === 'sell' && position) {
      pendingExit = signal.reason;
    }

    const equity = cash + (position ? position.quantity * bar.close : 0);
    equityCurve.push({ time: bar.time, equity });
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, (peakEquity - equity) / peakEquity);
  }

  // Close anything still open at the last price, so the numbers are comparable.
  if (position) {
    const last = candles.at(-1);
    ({ cash } = closeAt({
      price: withSlippage(last.close, 'sell', slippageBps),
      reason: 'end of test data',
      kind: 'forced',
    }));
  }

  function openAt(price, reason, time) {
    const budget = Math.min(risk.maxPositionQuote, risk.maxTotalExposureQuote, cash);
    const spendable = budget / (1 + takerFeeBps / 10_000);
    const quantity = Number(formatQuantity(spendable / price, instrument.qtyTickSize));
    if (quantity <= 0) return;

    const notional = quantity * price;
    const fee = feeFor(notional, takerFeeBps);
    if (notional + fee > cash) return;

    cash -= notional + fee;
    feesPaid += fee;
    tradesToday += 1;
    position = {
      instrument: symbol,
      quantity,
      entryPrice: price,
      entryTime: time,
      highWaterMark: price,
      costBasis: notional + fee,
      entryReason: reason,
    };
  }

  function closeAt({ price, reason, kind }) {
    const notional = position.quantity * price;
    const fee = feeFor(notional, takerFeeBps);
    const proceeds = notional - fee;
    const pnl = proceeds - position.costBasis;

    cash += proceeds;
    feesPaid += fee;
    dayPnl += pnl;
    trades.push({
      instrument: symbol,
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      exitPrice: price,
      quantity: position.quantity,
      pnl,
      returnPct: (pnl / position.costBasis) * 100,
      entryReason: position.entryReason,
      exitReason: reason,
      kind,
    });
    position = null;
    return { cash, dayPnl };
  }

  return summarise({ trades, equityCurve, startingCash, endingCash: cash, maxDrawdown, feesPaid, candles, strategy, params });
}

function stopPriceFor(position, kind, risk) {
  if (kind === 'trailing-stop') {
    return position.highWaterMark * (1 - risk.trailingStopPct / 100);
  }
  return position.entryPrice * (1 - risk.stopLossPct / 100);
}

function summarise({ trades, equityCurve, startingCash, endingCash, maxDrawdown, feesPaid, candles, strategy, params }) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

  // Per-bar returns, annualised against the number of bars in a year.
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) returns.push((equityCurve[i].equity - prev) / prev);
  }
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length
    ? returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
    : 0;
  const barsPerYear = estimateBarsPerYear(candles);
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(barsPerYear) : 0;

  const buyHoldReturn = ((candles.at(-1).close - candles[0].close) / candles[0].close) * 100;

  return {
    strategy: strategy.name,
    params,
    bars: candles.length,
    from: new Date(candles[0].time).toISOString(),
    to: new Date(candles.at(-1).time).toISOString(),
    startingCash,
    endingCash,
    totalReturnPct: ((endingCash - startingCash) / startingCash) * 100,
    buyHoldReturnPct: buyHoldReturn,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    averageWin: wins.length ? grossWin / wins.length : 0,
    averageLoss: losses.length ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDrawdown * 100,
    sharpe,
    feesPaid,
    tradeLog: trades,
    equityCurve,
  };
}

function estimateBarsPerYear(candles) {
  if (candles.length < 2) return 365;
  const step = candles[1].time - candles[0].time;
  if (step <= 0) return 365;
  return (365 * 24 * 60 * 60 * 1000) / step;
}
