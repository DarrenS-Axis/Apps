import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, atr, stdev, bollinger, priorHighest, priorLowest, crossedAbove, crossedBelow } from '../src/strategy/indicators.js';
import { candlesFrom } from './helpers.mjs';

const RAMP = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('every indicator returns an array the same length as its input', () => {
  const candles = candlesFrom(RAMP);
  assert.equal(sma(RAMP, 3).length, RAMP.length);
  assert.equal(ema(RAMP, 3).length, RAMP.length);
  assert.equal(rsi(RAMP, 4).length, RAMP.length);
  assert.equal(atr(candles, 3).length, RAMP.length);
  assert.equal(stdev(RAMP, 3).length, RAMP.length);
});

test('the warmup window is null, not zero', () => {
  // A zero here would look like a real reading and quietly trigger a crossover.
  const values = sma(RAMP, 3);
  assert.deepEqual(values.slice(0, 2), [null, null]);
  assert.equal(values[2], 2);
});

test('SMA averages the trailing window', () => {
  assert.equal(sma(RAMP, 3).at(-1), 9);
  assert.equal(sma(RAMP, 5).at(-1), 8);
});

test('EMA is seeded from the first SMA and tracks the series', () => {
  const values = ema(RAMP, 3);
  assert.equal(values[2], 2);
  assert.ok(values.at(-1) > 8 && values.at(-1) <= 10);
});

test('RSI saturates at the extremes and sits mid-range when flat', () => {
  const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
  const falling = Array.from({ length: 40 }, (_, i) => 140 - i);
  const flat = Array.from({ length: 40 }, () => 100);
  assert.equal(rsi(rising, 14).at(-1), 100);
  assert.equal(rsi(falling, 14).at(-1), 0);
  assert.equal(rsi(flat, 14).at(-1), 50);
});

test('RSI stays within 0 and 100 on a noisy series', () => {
  const noisy = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 2) * 10 + Math.cos(i / 7) * 4);
  for (const value of rsi(noisy, 14)) {
    if (value === null) continue;
    assert.ok(value >= 0 && value <= 100, `RSI out of range: ${value}`);
  }
});

test('ATR measures the true range', () => {
  const candles = candlesFrom(Array.from({ length: 30 }, (_, i) => 100 + i), { spread: 0 });
  // Each bar closes one above the last and has no intrabar range, so TR is 1.
  assert.ok(Math.abs(atr(candles, 14).at(-1) - 1) < 1e-9);
});

test('Bollinger bands straddle the mean', () => {
  const values = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5);
  const { upper, middle, lower } = bollinger(values, 20, 2);
  const i = values.length - 1;
  assert.ok(upper[i] > middle[i] && middle[i] > lower[i]);
});

test('prior high and low exclude the current bar', () => {
  const candles = candlesFrom([1, 5, 3, 9, 2], { spread: 0 });
  // At index 4 the previous two bars closed at 3 and 9.
  assert.equal(priorHighest(candles, 2)[4], 9);
  assert.equal(priorLowest(candles, 2)[4], 3);
});

test('a cross needs an actual change of side', () => {
  assert.ok(crossedAbove([1, 3], [2, 2], 1));
  assert.ok(!crossedAbove([3, 4], [2, 2], 1), 'already above is not a cross');
  assert.ok(crossedBelow([3, 1], [2, 2], 1));
  assert.ok(!crossedBelow([1, 0], [2, 2], 1), 'already below is not a cross');
});

test('a cross against a null reading is never reported', () => {
  assert.ok(!crossedAbove([null, 3], [2, 2], 1));
  assert.ok(!crossedBelow([3, 1], [null, 2], 1));
});
