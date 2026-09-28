/**
 * The trading loop.
 *
 * Each pass, for every configured instrument:
 *
 *   1. Protective exits are checked first, against the live price. A stop should
 *      not have to wait for a candle to close.
 *   2. If a new candle has closed since last time, the strategy gets a look at it.
 *   3. Anything the strategy wants to do goes through the risk layer, then the
 *      broker.
 *
 * Only closed candles ever reach a strategy. The still-forming candle changes under
 * you as price moves, so a rule like "closed above the 20-bar high" would fire and
 * unfire repeatedly within the same bar. Dropping it is what keeps live behaviour
 * and backtest behaviour the same.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { TIMEFRAME_MS } from './config.js';
import { getStrategy, resolveParams } from './strategy/registry.js';
import { checkEntry, checkExit, protectiveExit, enforceDailyLoss, killSwitchEngaged, currentExposure } from './risk/guard.js';
import { log } from './log.js';
import { round } from './state/store.js';

export class Engine {
  /**
   * @param {object} opts
   * @param {object} opts.config
   * @param {import('./exchange/client.js').CryptoComClient} opts.client
   * @param {import('./exchange/instruments.js').InstrumentCatalogue} opts.catalogue
   * @param {import('./exec/broker.js').Broker} opts.broker
   * @param {import('./state/store.js').StateStore} opts.store
   */
  constructor({ config, client, catalogue, broker, store }) {
    this.config = config;
    this.client = client;
    this.catalogue = catalogue;
    this.broker = broker;
    this.store = store;
    this.strategy = getStrategy(config.strategy.name);
    this.params = resolveParams(this.strategy, config.strategy.params);
    this.timeframeMs = TIMEFRAME_MS[config.timeframe];
    this.running = false;
    this.paused = false;
    this.lastPrices = {};
    this.lastError = null;
    this.tickCount = 0;
  }

  get state() {
    return this.store.state;
  }

  /** Candles that have finished forming, oldest first. */
  #closedCandles(candles, now = Date.now()) {
    return candles.filter((candle) => candle.time + this.timeframeMs <= now);
  }

  /** Mid price from the book, plus the spread in basis points. */
  async #quote(instrument) {
    try {
      const book = await this.client.getBook(instrument, 1);
      const bid = Number(book.bids?.[0]?.[0]);
      const ask = Number(book.asks?.[0]?.[0]);
      if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
        const mid = (bid + ask) / 2;
        return { mid, bid, ask, spreadBps: ((ask - bid) / mid) * 10_000 };
      }
    } catch (err) {
      log.debug('order book unavailable, falling back to the last close', {
        instrument,
        error: err.message,
      });
    }
    return null;
  }

  /**
   * Refuse to trade into a spread wider than configured. A blown-out spread is the
   * market telling you it does not want to trade right now, and crossing it is how
   * a strategy with a positive edge still loses money.
   */
  #spreadAcceptable(quote, instrument) {
    if (!quote) return true;
    const { maxSpreadBps } = this.config.execution;
    if (quote.spreadBps > maxSpreadBps) {
      log.warn('spread too wide, skipping', {
        instrument,
        spread_bps: round(quote.spreadBps),
        max_bps: maxSpreadBps,
      });
      return false;
    }
    return true;
  }

  async #openPosition(instrument, price, reason) {
    const decision = checkEntry({
      state: this.state,
      config: this.config,
      instrument,
      price,
      availableQuote: await this.broker.availableQuote(),
      prices: this.lastPrices,
    });

    if (!decision.allowed) {
      log.info('entry blocked', { instrument, reason: decision.reason });
      return;
    }

    const fill = await this.broker.buy({ instrument, quoteAmount: decision.quoteAmount, price });
    if (fill.quantity <= 0) {
      log.warn('buy returned no fill', { instrument });
      return;
    }

    const costBasis = fill.quantity * fill.price + fill.fee;
    this.state.positions[instrument] = {
      instrument,
      quantity: fill.quantity,
      entryPrice: fill.price,
      entryTime: Date.now(),
      highWaterMark: fill.price,
      costBasis,
      entryOrderId: fill.orderId,
      entryReason: reason,
    };
    this.state.lastTradeAt = Date.now();
    this.state.day.trades += 1;
    this.state.totals.trades += 1;
    this.state.totals.fees += fill.fee;
    this.store.save();

    log.info('opened position', {
      instrument,
      quantity: fill.quantity,
      price: round(fill.price),
      cost: round(costBasis),
      reason,
    });
    this.store.record({
      event: 'open',
      instrument,
      quantity: fill.quantity,
      price: fill.price,
      fee: fill.fee,
      costBasis,
      reason,
      simulated: fill.simulated,
    });
  }

  async #closePosition(instrument, price, reason, kind = 'signal') {
    const decision = checkExit({ state: this.state, instrument });
    if (!decision.allowed) {
      log.debug('exit skipped', { instrument, reason: decision.reason });
      return;
    }

    const position = this.state.positions[instrument];
    const fill = await this.broker.sell({ instrument, quantity: position.quantity, price });
    if (fill.quantity <= 0) {
      // The position stays on the books; we will try again next pass.
      log.warn('sell returned no fill, position still open', { instrument });
      return;
    }

    const proceeds = fill.quantity * fill.price - fill.fee;
    // If only part of it sold, only that part of the cost basis is realised.
    const soldFraction = Math.min(1, fill.quantity / position.quantity);
    const realised = proceeds - position.costBasis * soldFraction;

    this.state.day.realisedPnl += realised;
    this.state.totals.realisedPnl += realised;
    this.state.totals.fees += fill.fee;
    if (realised >= 0) this.state.totals.wins += 1;
    else this.state.totals.losses += 1;
    this.state.lastTradeAt = Date.now();

    const remaining = round(position.quantity - fill.quantity);
    if (remaining > 0) {
      position.quantity = remaining;
      position.costBasis *= 1 - soldFraction;
      log.warn('position partly closed', { instrument, remaining });
    } else {
      delete this.state.positions[instrument];
    }
    this.store.save();

    log.info('closed position', {
      instrument,
      quantity: fill.quantity,
      price: round(fill.price),
      pnl: round(realised),
      kind,
      reason,
    });
    this.store.record({
      event: 'close',
      instrument,
      quantity: fill.quantity,
      price: fill.price,
      fee: fill.fee,
      pnl: realised,
      kind,
      reason,
      simulated: fill.simulated,
    });

    enforceDailyLoss(this.store, this.config.risk);
  }

  /** One pass over one instrument. */
  async #stepInstrument(instrument) {
    const warmup = this.strategy.warmup(this.params);
    const candles = await this.client.getCandlesticks(instrument, this.config.timeframe, {
      count: Math.min(300, warmup + 50),
    });
    const closed = this.#closedCandles(candles);
    if (closed.length === 0) {
      log.debug('no closed candles yet', { instrument });
      return;
    }

    const quote = await this.#quote(instrument);
    const price = quote?.mid ?? closed.at(-1).close;
    this.lastPrices[instrument] = price;

    const position = this.state.positions[instrument] ?? null;

    // 1. Protective exits, against the live price, every pass.
    if (position) {
      if (price > (position.highWaterMark ?? position.entryPrice)) {
        position.highWaterMark = price;
        this.store.save();
      }
      const trigger = protectiveExit(position, price, this.config.risk);
      if (trigger.hit) {
        // A stop is worth crossing a wide spread for; skipping it is how a small
        // loss becomes a large one.
        await this.#closePosition(instrument, quote?.bid ?? price, trigger.reason, trigger.kind);
        return;
      }
    }

    // 2. Strategy, only on a newly closed candle.
    const latest = closed.at(-1);
    const seen = this.state.lastCandleTime[instrument] ?? 0;
    if (latest.time <= seen) return;

    if (closed.length < warmup) {
      log.debug('still warming up', { instrument, have: closed.length, need: warmup });
      this.state.lastCandleTime[instrument] = latest.time;
      this.store.save();
      return;
    }

    if (this.paused) {
      this.state.lastCandleTime[instrument] = latest.time;
      this.store.save();
      log.debug('paused; strategy not consulted', { instrument });
      return;
    }

    const signal = this.strategy.evaluate(
      { candles: closed, index: closed.length - 1, position },
      this.params,
    );
    this.state.lastCandleTime[instrument] = latest.time;
    this.store.save();

    log.debug('signal', { instrument, action: signal.action, reason: signal.reason });

    if (signal.action === 'buy' && !position) {
      if (!this.#spreadAcceptable(quote, instrument)) return;
      await this.#openPosition(instrument, quote?.ask ?? price, signal.reason);
    } else if (signal.action === 'sell' && position) {
      await this.#closePosition(instrument, quote?.bid ?? price, signal.reason, 'signal');
    }
  }

  /** One full pass over every instrument. */
  async tick() {
    this.store.rollDay();
    this.tickCount += 1;

    if (killSwitchEngaged() && !this.state.halted) {
      log.warn('kill switch file found; no new positions will be opened');
    }

    for (const instrument of this.config.instruments) {
      try {
        await this.#stepInstrument(instrument);
      } catch (err) {
        // One bad instrument must not stop the others, and must not stop a stop loss
        // on a different instrument from being checked.
        this.lastError = { instrument, message: err.message, at: Date.now() };
        log.error('instrument step failed', { instrument, error: err.message });
      }
    }
  }

  /** Close everything, at market. Used by the kill switch and by `flatten`. */
  async flatten(why = 'flatten requested') {
    const instruments = Object.keys(this.state.positions);
    if (instruments.length === 0) {
      log.info('nothing to flatten');
      return;
    }
    log.warn('flattening all positions', { count: instruments.length, why });
    for (const instrument of instruments) {
      try {
        const quote = await this.#quote(instrument);
        const price = quote?.bid ?? this.lastPrices[instrument];
        if (!price) {
          const candles = await this.client.getCandlesticks(instrument, this.config.timeframe, { count: 1 });
          if (!candles.length) throw new Error('no price available');
          await this.#closePosition(instrument, candles.at(-1).close, why, 'flatten');
        } else {
          await this.#closePosition(instrument, price, why, 'flatten');
        }
      } catch (err) {
        log.error('could not flatten', { instrument, error: err.message });
      }
    }
  }

  async run() {
    this.running = true;
    log.info('engine started', {
      mode: this.config.mode,
      strategy: this.strategy.name,
      timeframe: this.config.timeframe,
      instruments: this.config.instruments.join(','),
      poll_seconds: this.config.pollSeconds,
    });

    while (this.running) {
      const startedAt = Date.now();
      try {
        // Pausing stops the strategy being consulted; it does NOT stop the loop.
        // Stops and targets on an open position keep running, because a paused
        // bot that stopped watching its stops would be strictly worse than one
        // that was never started.
        if (this.paused && Object.keys(this.state.positions).length === 0) {
          log.debug('paused and flat, skipping tick');
        } else {
          await this.tick();
        }
      } catch (err) {
        this.lastError = { message: err.message, at: Date.now() };
        log.error('tick failed', { error: err.message });
      }
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(1000, this.config.pollSeconds * 1000 - elapsed);
      if (this.running) await sleep(wait);
    }
    log.info('engine stopped');
  }

  stop() {
    this.running = false;
  }

  /** Stop opening and closing on signals. Protective exits carry on. */
  pause() {
    if (this.paused) return;
    this.paused = true;
    log.warn('engine paused; protective exits still run on open positions');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    log.info('engine resumed');
  }

  /** A snapshot for the dashboard and the `status` command. */
  snapshot() {
    const positions = Object.values(this.state.positions).map((position) => {
      const price = this.lastPrices[position.instrument] ?? position.entryPrice;
      const value = position.quantity * price;
      return {
        ...position,
        markPrice: price,
        value: round(value),
        unrealisedPnl: round(value - position.costBasis),
        unrealisedPct: round(((value - position.costBasis) / position.costBasis) * 100),
      };
    });

    return {
      mode: this.config.mode,
      environment: this.config.environment,
      strategy: this.strategy.name,
      params: this.params,
      timeframe: this.config.timeframe,
      instruments: this.config.instruments,
      paused: this.paused,
      halted: this.state.halted,
      haltReason: this.state.haltReason,
      killSwitch: killSwitchEngaged(),
      startedAt: this.state.startedAt,
      ticks: this.tickCount,
      day: this.state.day,
      totals: this.state.totals,
      exposure: round(currentExposure(this.state, this.lastPrices)),
      positions,
      prices: this.lastPrices,
      lastError: this.lastError,
      paperBalances: this.config.mode === 'paper' ? this.state.paperBalances : undefined,
    };
  }
}
