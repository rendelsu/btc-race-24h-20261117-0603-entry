// "Mean-reversion dip-rider" for btc-race-24h-20261117-0603 (bars-replay/v1).
//
// Idea, in one paragraph: on one-minute cbBTC/USDC bars the tape spends most of
// its day oscillating a percent or two around its own 4-hour average, while a
// full round trip costs roughly 26-35 bps in fees, slippage and pool impact.
// Chasing every wiggle therefore bleeds out, and fast trend-following whipsaws
// on this data. This bot does only two things, both with wide bands so a trade
// has to earn its costs: (1) it buys when the close sits at least 0.5% below
// its 240-bar average and sells when it rises 0.5% above it, with a 1% stop
// under its entry; (2) it buys sharp 60-minute washouts (down 0.8% or more)
// once the tape turns up again over 5 minutes. It never buys into a steep
// 4-hour downtrend (240-bar return below -1.5%). One position at a time, full
// size, at most one order per bar.
//
// All decisions are exact integer (bigint) comparisons on closes the bot has
// seen, so two runs on the same bars answer byte for byte alike. No clock, no
// environment, no randomness. Prices are raw units at the symbol's scale.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Mean-reversion leg, against the 240-bar (4-hour) average of closes.
const SMA_N = 240;
const MR_DOWN_BPS = 50n; // buy at least 0.5% below the average
const MR_UP_BPS = 50n; // sell at least 0.5% above the average
const STOP_BPS = 100n; // stop 1.0% under the entry price

// Trend guard: refuse any buy while the 240-bar return is this bad or worse.
const TREND_FLOOR_BPS = -150n;

// Washout leg: 60-bar return under -0.8% with a 5-bar bounce over +0.1%.
const DIP_N = 60;
const DIP_BPS = -80n;
const BOUNCE_N = 5;
const BOUNCE_BPS = 10n;

// Rejects a fill only if the next open moved absurdly far from the last close
// (the biggest 1-minute move in the dev window was ~45 bps; 300 leaves room).
const MAX_SLIPPAGE_BPS = 300;

// Smallest buy the market accepts: 1 USDC = 1_000_000 quote units.
const MIN_NOTIONAL = 1_000_000n;

const closes: bigint[] = [];
let smaSum = 0n; // running sum of the last SMA_N closes

function sma240(): bigint | null {
  if (closes.length < SMA_N) return null;
  return smaSum / BigInt(SMA_N);
}

// Return over `n` bars in bps, truncated toward zero, or null without history.
function retBps(n: number): bigint | null {
  const len = closes.length;
  if (len <= n) return null;
  const now = closes[len - 1]!;
  const then = closes[len - 1 - n]!;
  return ((now - then) * 10000n) / then;
}

function onBatch(state: BarsState, _batch: Batch): OrderInput[] {
  const c = state.close(SYMBOL);
  if (c === null) return [];

  // Record the close first: history grows through warm-up bars too, so the
  // averages are ready when the scored window starts.
  closes.push(c);
  smaSum += c;
  if (closes.length > SMA_N) smaSum -= closes[closes.length - 1 - SMA_N]!;

  if (state.warmingUp) return [];

  const holding = state.positions.get(SYMBOL);
  const sma = sma240();

  if (holding === undefined) {
    // Trend guard (only once a 240-bar return exists).
    const r240 = retBps(SMA_N);
    if (r240 !== null && r240 < TREND_FLOOR_BPS) return [];

    let buy = false;
    if (sma !== null && c * 10000n < sma * (10000n - MR_DOWN_BPS)) buy = true;
    if (!buy) {
      const r60 = retBps(DIP_N);
      const r5 = retBps(BOUNCE_N);
      if (r60 !== null && r60 < DIP_BPS && r5 !== null && r5 > BOUNCE_BPS) buy = true;
    }
    if (!buy) return [];

    const room = state.weightRoom(SYMBOL);
    const notional = state.cash < room ? state.cash : room;
    if (notional < MIN_NOTIONAL) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }

  // Holding: exit on the mean-reversion target, or on the stop under entry.
  const qty = holding.qty;
  const cost = holding.cost;
  if (sma !== null) {
    if (c * 10000n > sma * (10000n + MR_UP_BPS)) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
  } else if (c * qty * 10000n >= cost * (10000n + MR_UP_BPS)) {
    // Opened on the washout leg before the average existed: same target,
    // measured from the entry price instead.
    return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  // Stop: close at or below entry * (1 - 1.0%).
  if (c * qty * 10000n <= cost * (10000n - STOP_BPS)) {
    return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({ onBatch });
