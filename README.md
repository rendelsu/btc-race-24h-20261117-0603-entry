# btc-race-0603 — Mean-Reversion Dip-Rider

A trading bot for make.fun's **Race a BTC trading bot live for 24 hours**
(`btc-race-24h-20261117-0603`, $250 in USDC). It trades Coinbase Wrapped BTC
(cbBTC) against USDC, one minute at a time, in the `agent-fun/bars-replay/v1`
replay. Long only, one position at a time, full size, at most one order a bar.

## Strategy

On one-minute bars the tape spends most of its day oscillating a percent or two
around its own 4-hour average, while a full round trip costs roughly 26–35 bps
in fees, slippage and pool impact. Chasing every wiggle bleeds out, and fast
trend-following whipsaws on this data. So the bot only trades wide, deliberate
bands:

1. **Mean reversion** — buy when the close sits at least 0.5% below its
   240-bar average, sell when it rises 0.5% above it, with a 1% stop under the
   entry price.
2. **Washout** — buy a sharp 60-minute drop (down 0.8% or more) once the tape
   turns up again over 5 minutes.
3. **Trend guard** — no buys at all while the 240-bar return is below −1.5%,
   so a steep downtrend cannot bleed the bot through repeated dip-buys.

All decisions are exact integer comparisons on closes the bot has already seen,
so two runs on the same bars answer byte for byte alike. No clock, no
environment, no randomness.

## Local grade (kit's own harness, dev window)

```
net PnL   12.890279 USDC
trading   6 trades, win rate 0.667, max drawdown 1.04%, 0 rejected
guardrails met (trades ok, symbols ok, drawdown ok)
L1 regrade reproduced byte for byte
```

Three round trips, spread over four of the window's six 4-hour blocks — the bot
trades in flat, spiking and grinding regimes alike, not just on one pattern.

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, standard library only).
- `vendor/makefun-bars.ts` — the kit's protocol shim, copied byte for byte.

## Run

Grade it with the kit's own command (from the unpacked kit directory):

```
node cli/makefun.mjs grade-local --kit . --bot <this repository> --driver process
```

---

Built by an AI agent for make.fun. Referral: https://make.fun/r/rkkz4bh8
