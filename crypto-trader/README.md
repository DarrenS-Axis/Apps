# cdc-trader

An automated spot trading bot for the **Crypto.com Exchange**. It runs a strategy
against live candles, places orders through the Exchange API, and enforces hard risk
limits that the strategy cannot talk its way around.

It defaults to **paper mode**: real prices, simulated money, no orders. Live trading
is an explicit, deliberate opt-in and takes three separate steps to enable.

---

## Read this part first

**1. You need a Crypto.com *Exchange* account, not the Crypto.com App.**

These are two different products and only one of them has a trading API:

| | Trading API? | What this bot needs |
|---|---|---|
| **Crypto.com Exchange** (`crypto.com/exchange`) | Yes | ✅ This one |
| **Crypto.com App** (the retail buy/sell app) | No | ❌ Cannot be automated |
| **Crypto.com Onchain** (self-custody wallet) | No | ❌ Different thing entirely |

If you only have the App, you will need to open an Exchange account and move funds
across before any of this works. There is no API that automates the App, so no
program can trade it — not this one, and not anything else claiming otherwise.

**2. This is a Node service, not a web page.**

The API secret signs withdrawal-capable requests. Anything in a browser bundle is
public — this repository even publishes its front end to GitHub Pages, which would
put your key on the open internet. So the bot runs on your machine or a server you
control, and the key never touches a browser.

**3. It can lose money.**

Automated trading loses money by default; fees and spread guarantee it unless the
strategy has a real edge. The strategies here are standard textbook ones, included
so the machinery has something to drive. They are **not** a recommendation and they
are not tuned to any market. Nothing here is financial advice.

Two limits are worth being clear about before you start:

- **The stops live in this process, not on the exchange.** If the bot is not
  running — crashed, rebooted, lost its network — nothing is watching your stop
  loss. It is not a resting order on the exchange's book.
- **A backtest is not a forecast.** It cannot model order book depth, outages, or
  the market reacting to your own orders. Treat a good backtest as "this is not
  obviously broken", nothing more.

---

## Setup

Needs Node 20.11 or newer. There are no dependencies to install — the whole thing
runs on the Node standard library, which is deliberate: a program holding API keys
should not also be pulling in a few hundred transitive packages.

```bash
cd crypto-trader
node --version          # expect v20.11 or later
npm test                # 82 tests, no network needed
```

### Create an API key

On the Exchange: **Settings → API Keys → Create**.

- Enable **Trading**. Leave **Withdrawals disabled** — nothing in this program
  withdraws, so a key that cannot withdraw cannot drain the account if it leaks.
- Restrict it to your IP address if you have a stable one.

```bash
cp .env.example .env
$EDITOR .env            # paste the key and secret
node src/index.js verify
```

`verify` does a signed round trip and reports the latency. If it fails, the error
says which of the three usual causes it is: wrong credentials, a clock more than a
few seconds out, or an IP that is not on the key's allowlist.

---

## Using it

### 1. Backtest

```bash
node src/index.js backtest --bars 2000
node src/index.js backtest --strategy donchian-breakout --timeframe 4h --bars 2000
```

The report it prints has this shape (numbers here are made up, to show the layout —
your own run will differ):

```
sma-cross on BTC_USD  1h
<from> to <to>  (2000 bars)

  Starting balance     1000.00 USD
  Ending balance          ...
  Strategy return         ...
  Buy and hold            ...
  Edge over holding       ...

  Trades / win rate / profit factor / max drawdown / Sharpe / fees paid
```

**Edge over holding** is the line that matters. A strategy that makes money but
less than simply holding the asset has cost you money to run. The report also
warns you when a test produced too few trades to conclude anything.

### 2. Paper trade

```bash
node src/index.js run                    # paper is the default
```

Real prices, real signals, simulated fills with fees and slippage charged. Leave it
running for a few weeks. Open <http://127.0.0.1:8787> for open positions and P&L.

### 3. Go live, if you still want to

Three separate things have to line up, so it cannot happen by accident:

```bash
# 1. the confirmation phrase in .env
echo 'CDC_LIVE_CONFIRM=I_ACCEPT_THE_RISK' >> .env

# 2. the flag
node src/index.js run --mode live

# 3. type LIVE at the prompt
```

Start with `maxPositionQuote` set to an amount you would be relaxed about losing
entirely. The shipped config uses 50 USD per trade and a 25 USD daily loss limit.

---

## Commands

| Command | What it does |
|---|---|
| `run` | Start the trading loop |
| `backtest` | Replay the strategy over historical candles |
| `balance` | Print balances as the exchange reports them |
| `instruments` | List tradable spot pairs for your quote currency |
| `strategies` | List the built-in strategies and their parameters |
| `status` | Print saved state without starting anything |
| `flatten` | Close every open position, then exit |
| `verify` | Check credentials and clock |
| `kill on` / `kill off` | Engage or clear the kill switch |

Options: `--mode`, `--config`, `--strategy`, `--timeframe`, `--instrument` (repeatable),
`--bars`, `--environment`, `--log-level`, `--json`, `--yes`.

### Stopping it

- **Ctrl-C** stops the loop and leaves positions open. Restarting picks them up
  again — a restart is not a reason to pay a round trip of fees.
- **`kill on`** stops it opening anything new while it keeps managing what is
  already open. Stops and targets still work. This is the one to reach for first.
- **`flatten`** sells everything at market, now.

---

## Risk controls

Every order goes through `src/risk/guard.js`. Strategies cannot reach the broker,
so there is exactly one place an order can be created and one set of limits to
reason about.

| Setting | Effect |
|---|---|
| `maxPositionQuote` | Most that can go into one position |
| `maxTotalExposureQuote` | Most that can be in the market at once |
| `maxOpenPositions` | How many instruments can be held at once |
| `maxTradesPerDay` | Caps churn when a strategy misbehaves |
| `dailyLossLimitQuote` | Halts trading for the rest of the UTC day |
| `minSecondsBetweenTrades` | Cooldown between entries |
| `stopLossPct` | Exit at this loss from entry |
| `takeProfitPct` | Exit at this gain from entry |
| `trailingStopPct` | Exit this far off the peak since entry |
| `reserveQuote` | Balance the bot may never touch |
| `maxSpreadBps` | Refuses to enter through a spread wider than this |

The bias is asymmetric on purpose: entries are blocked on the slightest doubt,
exits are allowed through almost anything — including a halt and the kill switch.
A blocked entry costs an opportunity; a blocked exit costs money.

The daily loss halt clears itself at the next UTC day. A halt from anything else
needs you to look at it.

---

## Strategies

| Name | Idea |
|---|---|
| `sma-cross` | Fast/slow moving-average crossover, with a long-term trend filter |
| `rsi-reversion` | Buys the recovery out of oversold RSI, sells into overbought |
| `donchian-breakout` | Buys closes above an N-bar high, exits below an M-bar low |

A strategy only says buy, sell or hold, and why. Sizing, stops and limits are not
its business. To add one, implement the shape in `src/strategy/types.js` and register
it in `src/strategy/registry.js` — about thirty lines.

Two rules the engine enforces so live and backtest behave the same way:

- **Only closed candles reach a strategy.** The forming candle changes as price
  moves, so a rule like "closed above the 20-bar high" would fire and unfire within
  the same bar.
- **A signal on bar `i` fills at the open of bar `i+1`.** Filling at the close of
  the bar that produced the signal is look-ahead bias, and it is the single most
  common reason a backtest looks wonderful and the live bot does not.

---

## How it fits together

```
 index.js ───── CLI, live-trading interlock
     │
 engine.js ──── the loop: protective exits, then strategy on new closed candles
     │
     ├── strategy/   buy / sell / hold, and why
     ├── risk/       the only place an order can be created
     ├── exec/       paperBroker | liveBroker behind one interface
     ├── exchange/   signing, REST client, instrument catalogue
     └── state/      atomic JSON state, NDJSON trade journal
```

Paper and live brokers implement the same interface, so the engine cannot tell
which one it is driving. That is what makes paper mode a real rehearsal rather
than a separate, less-tested path.

**Execution.** Live orders default to a marketable **limit IOC**: priced through
the touch by `limitOffsetBps` so it fills like a market order, but with a hard
ceiling on what it can pay. A market order has no such ceiling, and on a thin book
that difference is the whole ball game.

**Signing.** The Exchange signs an HMAC-SHA256 digest over a string built from the
request itself. The classic way to get it wrong is number formatting — the server
rebuilds that string from the JSON it received, so `8000.000` on your side and
`8000` on theirs are different orders as far as the digest is concerned. Prices and
quantities are formatted to the instrument's tick size once, as strings, in
`src/exec/sizing.js`, and never round-trip through a float afterwards.

**State.** Written atomically via a temp file and a rename, so a kill mid-write
leaves the previous good state. It has to survive restarts — otherwise restarting
is a way to wipe the daily loss limit and start losing again.

---

## Files

```
config.json           strategy, instruments, risk limits   (safe to commit)
.env                  API key and secret                   (never commit)
data/state.json       positions, P&L, halt flag
data/trades.ndjson    one line per fill
data/trader.log
data/KILL             present = kill switch engaged
```

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `AUTHENTICATION_FAILURE` | Wrong key/secret, or the key lacks Trading permission |
| `code 40102` nonce error | System clock is more than a few seconds out — enable NTP |
| `code 40103` | Your IP is not on the key's allowlist |
| `BELOW_MIN_ORDER_SIZE` | `maxPositionQuote` is below the exchange's minimum |
| "not listed on the exchange" | Check the symbol with `instruments`; it is `BTC_USD`, not `BTC/USD` |
| No trades for days | Normal. Run `--log-level debug` to see what each signal decided |
| `state file was written in "paper" mode` | Move `data/state.json` aside when switching modes |

---

## Tests

```bash
npm test
```

82 tests, no network required. They cover the signature construction against
hand-computed digests, tick-size rounding, every risk limit, and a full engine
replay against a fake exchange — including that the bot never acts on an unclosed
candle, never trades the same candle twice, keeps a stop working while halted, and
that paper P&L reconciles to the starting balance exactly.
