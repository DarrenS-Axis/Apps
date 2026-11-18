/**
 * Instrument catalogue.
 *
 * Tick sizes and decimals come from the exchange rather than being hard-coded,
 * because they change and a stale value means every order is rejected. Cached for
 * an hour so the trading loop is not re-fetching a list of thousands of symbols
 * every thirty seconds.
 */
import { log } from '../log.js';

const CACHE_TTL_MS = 60 * 60 * 1000;

export class InstrumentCatalogue {
  constructor(client) {
    this.client = client;
    this.bySymbol = new Map();
    this.fetchedAt = 0;
  }

  async refresh(force = false) {
    if (!force && this.bySymbol.size > 0 && Date.now() - this.fetchedAt < CACHE_TTL_MS) return;
    const rows = await this.client.getInstruments();
    this.bySymbol.clear();
    for (const row of rows) {
      this.bySymbol.set(row.symbol, {
        symbol: row.symbol,
        baseCurrency: row.base_ccy,
        quoteCurrency: row.quote_ccy,
        priceTickSize: row.price_tick_size,
        qtyTickSize: row.qty_tick_size,
        quoteDecimals: row.quote_decimals,
        quantityDecimals: row.quantity_decimals,
        tradable: row.tradable !== false,
        type: row.inst_type,
      });
    }
    this.fetchedAt = Date.now();
    log.debug('instrument catalogue refreshed', { count: this.bySymbol.size });
  }

  get(symbol) {
    const instrument = this.bySymbol.get(symbol);
    if (!instrument) {
      throw new Error(`the exchange does not list "${symbol}"; check the symbol, e.g. BTC_USD`);
    }
    return instrument;
  }

  has(symbol) {
    return this.bySymbol.has(symbol);
  }

  /**
   * Check every configured instrument up front, so a typo fails at startup rather
   * than the first time the strategy wants to trade it.
   */
  validateAll(symbols, quoteCurrency) {
    const problems = [];
    for (const symbol of symbols) {
      const instrument = this.bySymbol.get(symbol);
      if (!instrument) {
        problems.push(`${symbol} is not listed on the exchange`);
        continue;
      }
      if (!instrument.tradable) problems.push(`${symbol} is listed but not currently tradable`);
      if (instrument.type !== 'CCY_PAIR') {
        problems.push(`${symbol} is a ${instrument.type}, not a spot pair; this bot only trades spot`);
      }
      if (instrument.quoteCurrency !== quoteCurrency) {
        problems.push(
          `${symbol} is quoted in ${instrument.quoteCurrency} but quoteCurrency is set to ${quoteCurrency}`,
        );
      }
    }
    if (problems.length) {
      throw new Error(`instrument configuration is wrong:\n  - ${problems.join('\n  - ')}`);
    }
  }
}
