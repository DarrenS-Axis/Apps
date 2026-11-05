import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatQuantity, formatPrice, decimalsOf, isDust } from '../src/exec/sizing.js';

test('decimals are read from the tick size', () => {
  assert.equal(decimalsOf('0.00001'), 5);
  assert.equal(decimalsOf('0.01'), 2);
  assert.equal(decimalsOf('10'), 0);
  assert.equal(decimalsOf('1'), 0);
  assert.equal(decimalsOf('1e-7'), 7);
});

test('quantities round down, never up', () => {
  assert.equal(formatQuantity(0.000129999, '0.00001'), '0.00012');
  assert.equal(formatQuantity(0.9999, '0.1'), '0.9');
  assert.equal(formatQuantity(123.7, '10'), '120');
});

test('prices round to the nearest tick', () => {
  assert.equal(formatPrice(26949.897, '0.01'), '26949.90');
  assert.equal(formatPrice(26949.891, '0.01'), '26949.89');
  assert.equal(formatPrice(1.23456, '0.001'), '1.235');
});

test('results are strings padded to the tick precision', () => {
  // "0.1" and "0.10" hash differently, so the padding has to be stable.
  assert.equal(formatQuantity(0.1, '0.00001'), '0.10000');
  assert.equal(formatPrice(100, '0.01'), '100.00');
  assert.equal(typeof formatQuantity(1, '0.001'), 'string');
});

test('float noise does not cost a whole tick', () => {
  assert.equal(formatQuantity(0.1 + 0.2, '0.00001'), '0.30000');
  assert.equal(formatQuantity(2.9999999999999996, '0.0001'), '3.0000');
});

test('anything under one tick comes back as dust', () => {
  const tiny = formatQuantity(0.0000001, '0.00001');
  assert.equal(tiny, '0.00000');
  assert.ok(isDust(tiny));
  assert.ok(!isDust(formatQuantity(0.5, '0.00001')));
});

test('bad input is rejected rather than silently coerced', () => {
  assert.throws(() => formatQuantity(Number.NaN, '0.001'), TypeError);
  assert.throws(() => formatQuantity(1, '0'), RangeError);
});
