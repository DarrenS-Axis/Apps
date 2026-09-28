/**
 * Request signing for the Crypto.com Exchange v1 API.
 *
 * The exchange authenticates every private call with an HMAC-SHA256 digest over a
 * string built from the request itself:
 *
 *     payload = method + id + api_key + paramsToString(params) + nonce
 *     sig     = hex(HMAC_SHA256(payload, api_secret))
 *
 * `paramsToString` walks the params object with keys sorted ascending, appending
 * `key` immediately followed by its stringified value, with no separators. The
 * exchange stops recursing at three levels deep, so we do the same -- past that
 * depth the value is stringified whole.
 *
 * The one real foot-gun is number formatting. The server rebuilds this string from
 * the JSON it received, so `8000.000` on our side and `8000` on theirs produce
 * different digests and the call is rejected as a bad signature. We avoid the whole
 * class of bug by requiring prices and quantities to be passed as pre-formatted
 * strings (see exec/sizing.js), which survive the round trip byte for byte.
 */
import { createHmac } from 'node:crypto';

const MAX_LEVEL = 3;

/**
 * Serialise a params object exactly the way the exchange does before hashing.
 * @param {unknown} value
 * @param {number} level
 * @returns {string}
 */
export function paramsToString(value, level = 0) {
  if (value === undefined || value === null) return 'null';
  if (level >= MAX_LEVEL) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);

  if (Array.isArray(value)) {
    let out = '';
    for (const item of value) out += paramsToString(item, level + 1);
    return out;
  }

  let out = '';
  for (const key of Object.keys(value).sort()) {
    out += key;
    const v = value[key];
    if (v === undefined || v === null) {
      out += 'null';
    } else if (Array.isArray(v)) {
      // Lists are flattened element by element, one level deeper.
      for (const item of v) out += paramsToString(item, level + 1);
    } else if (typeof v === 'object') {
      out += paramsToString(v, level + 1);
    } else {
      out += String(v);
    }
  }
  return out;
}

/**
 * Build the signed JSON envelope for a private request.
 * @param {object} opts
 * @param {string} opts.method   e.g. "private/create-order"
 * @param {number|string} opts.id
 * @param {string} opts.apiKey
 * @param {string} opts.apiSecret
 * @param {Record<string, unknown>} [opts.params]
 * @param {number} [opts.nonce]  milliseconds since epoch; must be close to server time
 */
export function signRequest({ method, id, apiKey, apiSecret, params = {}, nonce = Date.now() }) {
  const payload = `${method}${id}${apiKey}${paramsToString(params, 0)}${nonce}`;
  const sig = createHmac('sha256', apiSecret).update(payload, 'utf8').digest('hex');
  return { id, method, api_key: apiKey, params, nonce, sig };
}

/** Exposed so tests can assert on the exact pre-hash string. */
export function signaturePayload({ method, id, apiKey, params = {}, nonce }) {
  return `${method}${id}${apiKey}${paramsToString(params, 0)}${nonce}`;
}
