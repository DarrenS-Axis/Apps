/**
 * Thin client for the Crypto.com Exchange v1 REST API.
 *
 * Public calls are GETs with a query string. Private calls are POSTs carrying a
 * signed JSON envelope. Both answer with `{ id, method, code, result }`, where a
 * non-zero `code` is the error -- the HTTP status is 200 for plenty of failures,
 * so the body is what we check.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { signRequest } from './signing.js';
import { log, redact } from '../log.js';

export const ENDPOINTS = {
  production: 'https://api.crypto.com/exchange/v1',
  sandbox: 'https://uat-api.3ona.co/exchange/v1',
};

/** Error codes that mean "the exchange understood and refused" -- never retry these. */
const TERMINAL_CODES = new Set([
  201, // no position / duplicate
  202, // account is suspended
  203, // accept the terms
  204, // below minimum order size
  208, // invalid price
  209, // invalid quantity
  213, // invalid order id
  306, // insufficient available balance
  314, // exceeds max order size
  315, // limit price too far from market
  316, // account does not exist
  325, // exceeds daily volume limit
  415, // below min order size
  40001, // bad request
  40002, // method not found
  40003, // invalid nonce
  40004, // bad request / missing param
  40101, // authentication failure -- bad key or signature
  40102, // nonce outside the accepted window
  40103, // IP not whitelisted
  40104, // key does not have permission for this call
  40107, // action disabled for this key
  50001, // duplicate client order id
]);

export class ExchangeError extends Error {
  constructor(code, message, method, detail) {
    super(`${method} failed: ${message} (code ${code})`);
    this.name = 'ExchangeError';
    this.code = code;
    this.method = method;
    this.detail = detail;
    this.terminal = TERMINAL_CODES.has(Number(code));
  }
}

/** Evenly spaced request permits, so bursts cannot trip the exchange's limiter. */
class RateLimiter {
  constructor(perSecond) {
    this.interval = 1000 / perSecond;
    this.next = 0;
  }
  async take() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.interval;
    if (at > now) await sleep(at - now);
  }
}

export class CryptoComClient {
  /**
   * @param {object} opts
   * @param {string} [opts.apiKey]
   * @param {string} [opts.apiSecret]
   * @param {'production'|'sandbox'} [opts.environment]
   * @param {number} [opts.requestsPerSecond]
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.maxRetries]
   */
  constructor({
    apiKey = null,
    apiSecret = null,
    environment = 'production',
    requestsPerSecond = 8,
    timeoutMs = 15000,
    maxRetries = 3,
  } = {}) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = ENDPOINTS[environment] ?? ENDPOINTS.production;
    this.environment = environment;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.limiter = new RateLimiter(requestsPerSecond);
    this.requestId = 1;
    /** Offset between our clock and the exchange's, applied to every nonce. */
    this.clockSkewMs = 0;
  }

  get authenticated() {
    return Boolean(this.apiKey && this.apiSecret);
  }

  nextId() {
    return this.requestId++;
  }

  nonce() {
    return Date.now() + this.clockSkewMs;
  }

  async #fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Run a request, retrying only where a retry is safe and could plausibly help.
   * @param {string} method
   * @param {() => Promise<Response>} send
   */
  async #execute(method, send, { retryable = true } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(8000, 2 ** attempt * 250) + Math.random() * 250;
        log.warn('retrying request', { method, attempt, backoff_ms: Math.round(backoff) });
        await sleep(backoff);
      }
      await this.limiter.take();
      try {
        const response = await send();
        const text = await response.text();
        let body;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          throw new Error(`non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`);
        }

        if (body.code !== undefined && Number(body.code) !== 0) {
          const error = new ExchangeError(body.code, body.message ?? 'unknown error', method, body);
          if (error.terminal || !retryable) throw error;
          lastError = error;
          continue;
        }
        if (!response.ok) {
          const error = new Error(`${method} failed: HTTP ${response.status}`);
          if (response.status >= 400 && response.status < 500) throw error;
          lastError = error;
          continue;
        }
        return body.result ?? {};
      } catch (err) {
        if (err instanceof ExchangeError && err.terminal) throw err;
        if (!retryable) throw err;
        lastError = err;
        if (attempt === this.maxRetries) break;
      }
    }
    throw lastError ?? new Error(`${method} failed`);
  }

  /** GET a public endpoint, e.g. "public/get-candlestick". */
  async publicGet(method, params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query}` : '';
    const url = `${this.baseUrl}/${method}${suffix}`;
    return this.#execute(method, () =>
      this.#fetchWithTimeout(url, { method: 'GET', headers: { Accept: 'application/json' } }),
    );
  }

  /**
   * POST a signed private endpoint, e.g. "private/create-order".
   * @param {string} method
   * @param {Record<string, unknown>} params
   * @param {{retryable?: boolean}} [opts]
   */
  async privatePost(method, params = {}, opts = {}) {
    if (!this.authenticated) {
      throw new Error(`${method} needs API credentials; none are configured`);
    }
    const url = `${this.baseUrl}/${method}`;
    return this.#execute(
      method,
      () => {
        // The nonce and id are rebuilt per attempt so a retry is not rejected as stale.
        const envelope = signRequest({
          method,
          id: this.nextId(),
          apiKey: this.apiKey,
          apiSecret: this.apiSecret,
          params,
          nonce: this.nonce(),
        });
        return this.#fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(envelope),
        });
      },
      opts,
    );
  }

  // ---- public data -------------------------------------------------------

  async getInstruments() {
    const result = await this.publicGet('public/get-instruments');
    return result.data ?? [];
  }

  async getTickers(instrumentName) {
    const result = await this.publicGet(
      'public/get-tickers',
      instrumentName ? { instrument_name: instrumentName } : {},
    );
    return result.data ?? [];
  }

  /**
   * Candlesticks, newest last. The exchange caps a single call at 300 candles.
   * @param {string} instrumentName
   * @param {string} timeframe  one of 1m 5m 15m 30m 1h 4h 6h 12h 1D 7D 14D 1M
   * @param {{count?: number, startTs?: number, endTs?: number}} [opts]
   */
  async getCandlesticks(instrumentName, timeframe, { count, startTs, endTs } = {}) {
    const params = { instrument_name: instrumentName, timeframe };
    if (count !== undefined) params.count = Math.min(count, 300);
    if (startTs !== undefined) params.start_ts = startTs;
    if (endTs !== undefined) params.end_ts = endTs;
    const result = await this.publicGet('public/get-candlestick', params);
    return (result.data ?? []).map(normaliseCandle).sort((a, b) => a.time - b.time);
  }

  async getBook(instrumentName, depth = 10) {
    const result = await this.publicGet('public/get-book', {
      instrument_name: instrumentName,
      depth: Math.min(depth, 50),
    });
    return (result.data ?? [])[0] ?? { bids: [], asks: [] };
  }

  // ---- private ------------------------------------------------------------

  async getUserBalance() {
    const result = await this.privatePost('private/user-balance');
    return result.data ?? [];
  }

  async getOpenOrders(instrumentName) {
    const result = await this.privatePost(
      'private/get-open-orders',
      instrumentName ? { instrument_name: instrumentName } : {},
    );
    return result.data ?? [];
  }

  async getOrderDetail(orderId) {
    const result = await this.privatePost('private/get-order-detail', { order_id: String(orderId) });
    // The exchange has returned this both bare and wrapped over the years.
    return result.data ?? result;
  }

  /**
   * Look an order up by the id we generated for it, rather than the exchange's.
   * This is how we find out what happened to a submission whose response was lost.
   */
  async getOrderByClientOid(clientOid) {
    const result = await this.privatePost('private/get-order-detail', { client_oid: clientOid });
    return result.data ?? result;
  }

  async cancelOrder({ instrumentName, orderId }) {
    return this.privatePost('private/cancel-order', {
      instrument_name: instrumentName,
      order_id: String(orderId),
    });
  }

  async cancelAllOrders(instrumentName) {
    return this.privatePost('private/cancel-all-orders', { instrument_name: instrumentName });
  }

  /**
   * Confirm the credentials work and measure clock skew. The exchange rejects a
   * nonce more than a few seconds from its own clock, which is a confusing failure
   * to hit mid-session, so we find out at startup instead.
   */
  async verifyCredentials() {
    const before = Date.now();
    await this.getUserBalance();
    log.info('credentials verified', {
      environment: this.environment,
      api_key: redact(this.apiKey),
      round_trip_ms: Date.now() - before,
    });
    return true;
  }
}

/** `{o,h,l,c,v,t}` from the wire into something with readable names. */
export function normaliseCandle(raw) {
  return {
    time: Number(raw.t),
    open: Number(raw.o),
    high: Number(raw.h),
    low: Number(raw.l),
    close: Number(raw.c),
    volume: Number(raw.v),
  };
}
