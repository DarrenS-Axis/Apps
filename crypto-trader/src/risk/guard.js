/**
 * The risk layer.
 *
 * Every order in this program goes through `checkEntry` or `checkExit` first.
 * Strategies cannot place orders themselves and cannot reach the broker, so this
 * is the only place a position can be opened, and there is exactly one set of
 * limits to reason about.
 *
 * The bias throughout is asymmetric on purpose: entries are blocked on the
 * slightest doubt, exits are allowed through almost anything. Being unable to
 * enter costs an opportunity; being unable to exit costs money.
 */
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../config.js';

/** Drop a file here to stop the bot opening anything new, without killing the process. */
export const KILL_SWITCH_FILE = resolve(PROJECT_ROOT, 'data/KILL');

export function killSwitchEngaged() {
  return existsSync(KILL_SWITCH_FILE);
}

/** Engage the kill switch. Entries stop; open positions are still managed. */
export function engageKillSwitch(why = 'engaged') {
  writeFileSync(KILL_SWITCH_FILE, `${why} ${new Date().toISOString()}\n`);
}

/** Clear it again. */
export function clearKillSwitch() {
  if (existsSync(KILL_SWITCH_FILE)) unlinkSync(KILL_SWITCH_FILE);
}

/** @returns {{allowed: false, reason: string}} */
function deny(reason) {
  return { allowed: false, reason };
}

/** @returns {{allowed: true, quoteAmount: number}} */
function allow(quoteAmount) {
  return { allowed: true, quoteAmount };
}

/** Total quote value currently at risk across all open positions. */
export function currentExposure(state, prices = {}) {
  let total = 0;
  for (const position of Object.values(state.positions)) {
    const price = prices[position.instrument] ?? position.entryPrice;
    total += position.quantity * price;
  }
  return total;
}

/**
 * Decide whether a new position may be opened, and how large it may be.
 *
 * @param {object} args
 * @param {object} args.state         the persisted bot state
 * @param {object} args.config
 * @param {string} args.instrument
 * @param {number} args.price         current price in quote currency
 * @param {number} args.availableQuote spendable quote balance
 * @param {Record<string, number>} [args.prices] marks for open positions
 * @param {number} [args.now]
 */
export function checkEntry({ state, config, instrument, price, availableQuote, prices = {}, now = Date.now() }) {
  const risk = config.risk;

  if (state.halted) return deny(`trading is halted: ${state.haltReason}`);
  if (killSwitchEngaged()) return deny('kill switch file is present');
  if (!config.instruments.includes(instrument)) return deny(`${instrument} is not in the configured instruments`);
  if (!Number.isFinite(price) || price <= 0) return deny('no usable price');

  if (state.positions[instrument]) return deny(`already holding ${instrument}`);

  const openCount = Object.keys(state.positions).length;
  if (openCount >= risk.maxOpenPositions) {
    return deny(`already at the limit of ${risk.maxOpenPositions} open positions`);
  }

  if (state.day.trades >= risk.maxTradesPerDay) {
    return deny(`already at the limit of ${risk.maxTradesPerDay} trades today`);
  }

  if (-state.day.realisedPnl >= risk.dailyLossLimitQuote) {
    return deny(
      `down ${Math.abs(state.day.realisedPnl).toFixed(2)} today, at or past the ${risk.dailyLossLimitQuote} limit`,
    );
  }

  const sinceLast = (now - (state.lastTradeAt || 0)) / 1000;
  if (sinceLast < risk.minSecondsBetweenTrades) {
    return deny(
      `only ${sinceLast.toFixed(0)}s since the last trade, waiting for ${risk.minSecondsBetweenTrades}s`,
    );
  }

  const exposure = currentExposure(state, prices);
  const exposureHeadroom = risk.maxTotalExposureQuote - exposure;
  if (exposureHeadroom <= 0) {
    return deny(`total exposure ${exposure.toFixed(2)} is at the ${risk.maxTotalExposureQuote} cap`);
  }

  const spendable = availableQuote - risk.reserveQuote;
  if (spendable <= 0) {
    return deny(`no spendable balance (${availableQuote.toFixed(2)} available, ${risk.reserveQuote} reserved)`);
  }

  const quoteAmount = Math.min(risk.maxPositionQuote, exposureHeadroom, spendable);
  if (quoteAmount <= 0) return deny('position size works out to zero');

  return allow(quoteAmount);
}

/**
 * Exits are permitted whenever a position exists. The kill switch and the halt
 * flag deliberately do not block them -- both mean "stop taking on risk", and
 * refusing to close an open position would do the opposite.
 */
export function checkExit({ state, instrument }) {
  if (!state.positions[instrument]) return deny(`no open position in ${instrument}`);
  return { allowed: true };
}

/**
 * Protective exits, checked on every tick against the live price.
 *
 * Note these are evaluated by the bot rather than resting on the exchange, so they
 * only fire while the bot is running. That is called out in the README because it
 * genuinely matters: if the process is down, nothing is watching the stop.
 *
 * @param {import('../strategy/types.js').Position} position
 * @param {number} price
 * @param {object} risk
 * @returns {{hit: true, kind: string, reason: string}|{hit: false}}
 */
export function protectiveExit(position, price, risk) {
  const changePct = ((price - position.entryPrice) / position.entryPrice) * 100;

  if (risk.stopLossPct > 0 && changePct <= -risk.stopLossPct) {
    return {
      hit: true,
      kind: 'stop-loss',
      reason: `down ${Math.abs(changePct).toFixed(2)}%, stop is ${risk.stopLossPct}%`,
    };
  }

  if (risk.takeProfitPct > 0 && changePct >= risk.takeProfitPct) {
    return {
      hit: true,
      kind: 'take-profit',
      reason: `up ${changePct.toFixed(2)}%, target is ${risk.takeProfitPct}%`,
    };
  }

  if (risk.trailingStopPct > 0) {
    const peak = Math.max(position.highWaterMark ?? position.entryPrice, price);
    const fromPeak = ((price - peak) / peak) * 100;
    if (fromPeak <= -risk.trailingStopPct) {
      return {
        hit: true,
        kind: 'trailing-stop',
        reason: `${Math.abs(fromPeak).toFixed(2)}% off the peak of ${peak.toFixed(2)}, trail is ${risk.trailingStopPct}%`,
      };
    }
  }

  return { hit: false };
}

/**
 * Called after every closed trade. Halts the bot once the day's realised losses
 * reach the configured limit.
 */
export function enforceDailyLoss(store, risk) {
  const state = store.state;
  if (state.halted) return;
  if (-state.day.realisedPnl >= risk.dailyLossLimitQuote) {
    store.halt('daily-loss-limit');
  }
}
