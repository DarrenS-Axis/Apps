import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { paramsToString, signRequest, signaturePayload } from '../src/exchange/signing.js';

test('params are serialised with keys in ascending order', () => {
  assert.equal(
    paramsToString({ side: 'BUY', instrument_name: 'BTC_USD', quantity: '0.001' }),
    'instrument_nameBTC_USDquantity0.001sideBUY',
  );
});

test('key order in the source object does not change the result', () => {
  const a = paramsToString({ b: '2', a: '1', c: '3' });
  const b = paramsToString({ c: '3', a: '1', b: '2' });
  assert.equal(a, b);
  assert.equal(a, 'a1b2c3');
});

test('null and undefined values serialise as the literal null', () => {
  assert.equal(paramsToString({ a: null, b: undefined, c: '1' }), 'anullbnullc1');
});

test('lists are flattened element by element', () => {
  assert.equal(paramsToString({ exec_inst: ['POST_ONLY'], side: 'BUY' }), 'exec_instPOST_ONLYsideBUY');
});

test('a list of objects recurses one level deeper', () => {
  const result = paramsToString({
    order_list: [
      { instrument_name: 'BTC_USD', side: 'BUY' },
      { instrument_name: 'ETH_USD', side: 'SELL' },
    ],
  });
  assert.equal(result, 'order_listinstrument_nameBTC_USDsideBUYinstrument_nameETH_USDsideSELL');
});

test('recursion stops at three levels', () => {
  // At level 3 the value is stringified whole rather than walked, matching the
  // exchange. A plain object there becomes "[object Object]" on both sides.
  const deep = { a: [{ b: [{ c: [{ d: 'x' }] }] }] };
  assert.doesNotThrow(() => paramsToString(deep));
});

test('the payload is method + id + api_key + params + nonce, in that order', () => {
  const payload = signaturePayload({
    method: 'private/create-order',
    id: 42,
    apiKey: 'KEY',
    params: { instrument_name: 'BTC_USD' },
    nonce: 1700000000000,
  });
  assert.equal(payload, 'private/create-order42KEYinstrument_nameBTC_USD1700000000000');
});

test('the signature is an HMAC-SHA256 hex digest over that payload', () => {
  const args = {
    method: 'private/user-balance',
    id: 7,
    apiKey: 'KEY',
    apiSecret: 'SECRET',
    params: {},
    nonce: 1700000000000,
  };
  const envelope = signRequest(args);
  const expected = createHmac('sha256', 'SECRET')
    .update(signaturePayload(args), 'utf8')
    .digest('hex');

  assert.equal(envelope.sig, expected);
  assert.match(envelope.sig, /^[0-9a-f]{64}$/);
});

test('the envelope carries every field the exchange expects', () => {
  const envelope = signRequest({
    method: 'private/create-order',
    id: 1,
    apiKey: 'KEY',
    apiSecret: 'SECRET',
    params: { a: '1' },
    nonce: 123,
  });
  assert.deepEqual(Object.keys(envelope).sort(), ['api_key', 'id', 'method', 'nonce', 'params', 'sig']);
});

test('the secret never appears in the signed payload', () => {
  const payload = signaturePayload({
    method: 'private/user-balance',
    id: 1,
    apiKey: 'KEY',
    params: {},
    nonce: 1,
  });
  assert.ok(!payload.includes('SECRET'));
});

test('an empty params object contributes nothing', () => {
  assert.equal(paramsToString({}), '');
});
