/**
 * Price and quantity formatting.
 *
 * Every instrument has a `price_tick_size` and a `qty_tick_size`; an order whose
 * numbers are not exact multiples of those is rejected. Two rules matter here:
 *
 *  1. Round quantities DOWN. Rounding up can ask for more than the balance covers.
 *  2. Return strings, never numbers. The signature is computed over the literal
 *     text of the request, so "0.10" and "0.1" are different orders as far as the
 *     digest is concerned. Formatting once, here, keeps the two sides in step.
 */

/** Number of decimal places implied by a tick size such as "0.00001". */
export function decimalsOf(tick) {
  const s = String(tick);
  if (s.includes('e') || s.includes('E')) {
    // e.g. 1e-7 -> 7 decimals
    const [mantissa, exp] = s.toLowerCase().split('e');
    const mantissaDecimals = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
    return Math.max(0, mantissaDecimals - Number(exp));
  }
  const dot = s.indexOf('.');
  if (dot === -1) return 0;
  return s.length - dot - 1;
}

function stepRound(value, tick, mode) {
  const decimals = decimalsOf(tick);
  const scale = 10 ** decimals;
  const tickUnits = Math.round(Number(tick) * scale);
  if (!Number.isFinite(Number(value))) throw new TypeError(`not a number: ${value}`);
  if (tickUnits <= 0) throw new RangeError(`bad tick size: ${tick}`);

  // The epsilon absorbs float noise so 0.29999999996 still lands on 0.3.
  const units = Number(value) * scale;
  const rounded = mode === 'floor'
    ? Math.floor(units / tickUnits + 1e-9)
    : Math.round(units / tickUnits);
  return ((rounded * tickUnits) / scale).toFixed(decimals);
}

/** Round a quantity DOWN to the instrument's quantity tick. Returns a string. */
export function formatQuantity(quantity, qtyTickSize) {
  return stepRound(quantity, qtyTickSize, 'floor');
}

/** Round a price to the nearest price tick. Returns a string. */
export function formatPrice(price, priceTickSize) {
  return stepRound(price, priceTickSize, 'nearest');
}

/** True when the formatted quantity still has something in it. */
export function isDust(quantityString) {
  return Number(quantityString) <= 0;
}
