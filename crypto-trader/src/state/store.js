/**
 * Durable bot state.
 *
 * The bot is expected to be stopped, restarted and crashed. Whatever it knew about
 * open positions, the day's losses and the halt flag has to survive that, or a
 * restart becomes a way to wipe the daily loss limit and start losing again.
 *
 * Writes go to a temp file and are renamed into place, so a kill in the middle of
 * a write leaves the previous good state rather than a half-written file.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { PROJECT_ROOT } from '../config.js';
import { log } from '../log.js';

const STATE_VERSION = 1;

export function emptyState(mode, quoteCurrency, startingQuote) {
  return {
    version: STATE_VERSION,
    mode,
    startedAt: Date.now(),
    /** Simulated balances; only meaningful in paper mode. */
    paperBalances: { [quoteCurrency]: startingQuote },
    /** instrument -> open position */
    positions: {},
    /** Rolling per-day counters, reset when the UTC date changes. */
    day: { date: utcDate(), realisedPnl: 0, trades: 0 },
    lastTradeAt: 0,
    totals: { realisedPnl: 0, trades: 0, wins: 0, losses: 0, fees: 0 },
    halted: false,
    haltReason: null,
    /** instrument -> time of the last candle we have already acted on */
    lastCandleTime: {},
  };
}

export function utcDate(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 10);
}

export class StateStore {
  /**
   * @param {object} opts
   * @param {string} [opts.file]
   * @param {string} [opts.journal]
   */
  constructor({ file = resolve(PROJECT_ROOT, 'data/state.json'), journal = resolve(PROJECT_ROOT, 'data/trades.ndjson') } = {}) {
    this.file = file;
    this.journal = journal;
    mkdirSync(dirname(file), { recursive: true });
    this.state = null;
  }

  /** Load existing state, or start fresh if there is none. */
  load(mode, quoteCurrency, startingQuote) {
    if (!existsSync(this.file)) {
      this.state = emptyState(mode, quoteCurrency, startingQuote);
      this.save();
      return this.state;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      if (parsed.version !== STATE_VERSION) {
        throw new Error(`state file version ${parsed.version}, expected ${STATE_VERSION}`);
      }
      if (parsed.mode !== mode) {
        // Paper and live balances are not interchangeable; mixing them would report
        // fictional money as real. Refuse rather than guess.
        throw new Error(
          `state file was written in "${parsed.mode}" mode but the bot is starting in "${mode}" mode. ` +
            `Move ${this.file} aside to start fresh.`,
        );
      }
      this.state = parsed;
      this.rollDay();
      return this.state;
    } catch (err) {
      throw new Error(`could not load ${this.file}: ${err.message}`);
    }
  }

  /** Reset the per-day counters when the UTC date turns over. */
  rollDay() {
    const today = utcDate();
    if (this.state.day.date !== today) {
      log.info('new trading day', {
        previous: this.state.day.date,
        realised_pnl: round(this.state.day.realisedPnl),
        trades: this.state.day.trades,
      });
      this.state.day = { date: today, realisedPnl: 0, trades: 0 };
      // A halt caused by the daily loss limit expires with the day. A halt from the
      // kill switch or an unexpected error does not -- that needs a human.
      if (this.state.halted && this.state.haltReason === 'daily-loss-limit') {
        this.state.halted = false;
        this.state.haltReason = null;
        log.info('daily loss halt lifted for the new day');
      }
      this.save();
    }
  }

  save() {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2));
    renameSync(temp, this.file);
  }

  halt(reason) {
    this.state.halted = true;
    this.state.haltReason = reason;
    this.save();
    log.error('trading halted', { reason });
  }

  resume() {
    this.state.halted = false;
    this.state.haltReason = null;
    this.save();
  }

  /** Append one line to the trade journal. Never throws into the trading loop. */
  record(entry) {
    try {
      appendFileSync(this.journal, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    } catch (err) {
      log.warn('could not write the trade journal', { error: err.message });
    }
  }
}

function round(value) {
  return Math.round(value * 1e8) / 1e8;
}

export { round, STATE_VERSION };
