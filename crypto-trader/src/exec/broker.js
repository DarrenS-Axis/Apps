/**
 * What a broker has to be able to do.
 *
 * Paper and live implementations share this surface exactly, so the engine has no
 * idea which one it is driving. That is what makes paper mode a real rehearsal
 * rather than a separate, less-tested code path.
 *
 * @typedef {object} Fill
 * @property {number} quantity   base units actually filled
 * @property {number} price      average fill price
 * @property {number} fee        fee paid, in quote currency
 * @property {string} orderId
 * @property {boolean} simulated
 */

export class Broker {
  /** @returns {Promise<number>} spendable balance in the quote currency */
  async availableQuote() {
    throw new Error('not implemented');
  }

  /** @returns {Promise<number>} units of the base currency actually held */
  async availableBase(_instrument) {
    throw new Error('not implemented');
  }

  /** @returns {Promise<Fill>} */
  async buy(_order) {
    throw new Error('not implemented');
  }

  /** @returns {Promise<Fill>} */
  async sell(_order) {
    throw new Error('not implemented');
  }

  async cancelAll(_instrument) {}
}

/** Fee in quote currency for a trade of `notional`, given a rate in basis points. */
export function feeFor(notional, bps) {
  return (notional * bps) / 10_000;
}

/** Apply slippage to a price: buys get worse (higher), sells get worse (lower). */
export function withSlippage(price, side, bps) {
  const factor = bps / 10_000;
  return side === 'buy' ? price * (1 + factor) : price * (1 - factor);
}
