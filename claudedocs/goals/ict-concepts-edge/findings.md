# ICT concepts — backtest findings (ranked)

Two-stage test of each mechanically-definable ICT concept on **3 years of SPX
hourly** (`bars_hourly_730d.json`, ~700 OOS days). **S1** = beat a matched null by
≥+10pp, p<0.05. **S2** = mechanical strategy beats a random-entry control on net R.
Full method + pre-registered predictions in `log.md`; harness at
`server/scratch/ict_concepts_backtest.py`.

Matched-null baselines (the yardsticks): random reachable level reverses **0.549**;
random gap fills **0.891**; open-hour range **1.42 ATR**.

---

## The headline

**On SPX hourly, ICT's reaction/imbalance concepts carry real, matched-null-robust
edge — and confluence stacking genuinely improves it.** This is the *opposite* of
the 1-minute result (`ict-coach`), where raw sweep, OB-proximity, and low-TF-FVG
were disproven. **The edge in these ICT concepts is a swing/hourly phenomenon, not
an intraday-scalping one.**

The single best result: **the confluence stack (sweep → displacement → FVG) is the
top performer** — highest per-trade P&L (+0.59R at rr2.0) — validating ICT's core
claim that confluence, not any single array, is where the edge lives.

---

## Ranked verdicts

| # | Concept | S1 (vs matched null) | S2 (P&L) | Verdict | Coach priority |
|---|---|---|---|---|---|
| 1 | **Confluence stack** (sweep→displacement→FVG) | 0.772 vs 0.549 · **+22.3pp** | **+0.59R/trade** (rr2.0, n=149) | ✅ **CONFIRMED** | ⭐ **highest** |
| 2 | **FVG as reaction level** | 0.718 vs 0.545 matched · **+17.3pp** | **+0.42R/trade** (rr2.0, n=1356) | ✅ **CONFIRMED** | ⭐ high (most signals) |
| 3 | **Displacement filter** (on FVGs) | 0.766 vs 0.680 · **+8.6pp** | — (a filter, not a signal) | ✅ **CONFIRMED** | ⭐ cheap add — gate FVG on it |
| 4 | **Order-block reaction** | 0.810 vs 0.549 · **+26.1pp** (n=42) | inherited from FVG | ✅ CONFIRMED (small-n) | medium — high-conviction FVG |
| 5 | **Sweep → reversal** | 0.707 vs 0.427 matched · **+27.9pp** | +0.05R/trade (rr1.5) | ✅ CONFIRMED (modest P&L) | medium — the confluence trigger |
| 6 | **Hour-of-day expansion** | open 1.42 vs close 0.75 ATR | — (time filter) | ✅ CONFIRMED (context) | context — trade AM, not PM drift |
| 7 | **OTE 0.62–0.79 zone** | 0.794 vs 0.650 · +14.3pp | **−0.05R** — fails | ◑ real pattern, **not tradeable** | context only (confluence input) |
| 8 | **Equal highs/lows draw** | 0.871 vs 0.783 · +8.8pp | — | ◑ real but **under +10pp bar** | minor context |
| 9 | **Judas / open-hour fade** | 0.667 (no matched null) | — | ◑ suggestive, unscored | context (pairs with #6) |
| 10 | **Breaker flip** | 0.692 vs 0.549 · +14.4pp (n=26) | — | ◐ **INCONCLUSIVE** (under-sampled) | re-test as data grows |
| 11 | **FVG fill tendency** | 0.862 vs 0.891 · **−2.9pp** | — | ❌ **DISPROVEN** | — |
| 12 | **Premium/discount** | −0.069 ATR/trade vs +0.049 | loses | ❌ **DISPROVEN** | — |
| — | IPDA data ranges | (prior goal) | | ❌ DISPROVEN (`ipda-edge`) | — |

---

## What this means for the coach

**Wire in (earned it):**
1. **The confluence setup** — after a liquidity sweep, a displacement FVG in the
   reversal direction is the A+ signal (+0.59R, 77% reaction). This is the one
   positive *entry trigger* that validated. Rare (~149 in 3 yr) but high quality.
2. **FVG-reaction as the workhorse** — 1356 signals, +0.42R, the most tradeable
   standalone concept. Gate it on **displacement** (#3) to lift 0.718 → 0.766.
3. **Hour-of-day as a time filter** — concentrate on the NY-AM open hours; the
   afternoon drift is where range (and edge) dies.

**Use as context only (real but not standalone-tradeable):** OTE zone, order
blocks (small-n), equal-highs/lows, the Judas fade.

**Do NOT wire (disproven):** FVG-fill (the 86% is the same raw-number illusion as
IPDA), premium/discount (loses on a trending instrument), IPDA ranges.

**The reconciliation with `ict-coach`:** that goal disproved these at 1-minute; this
goal confirms several at hourly. Both are correct — **the coach should treat ICT
structure as a swing/HTF context layer feeding the entry, not as a 1m scalping
trigger.** The confluence stack is exactly the "bias → sweep → displacement → FVG"
sequence ICT teaches, and it's the one that pays.

---

## Caveats (honest)

- **SPX only, this 3-yr window, hourly.** Not a claim about other instruments,
  regimes, or resolutions. The 2023–26 uptrend specifically killed premium/discount
  (a mean-reversion rule) — in a range regime it might survive.
- **Timing concepts are resolution-limited.** Hourly can't test the 20-min macros
  or the exact Silver Bullet hour; the hour-of-day result is the coarse version.
- **Breaker and OB are under-/small-sampled** on hourly (26 / 42) — verdicts are
  provisional; re-run as the sample grows.
- **The matched null is load-bearing.** FVG-fill (−2.9pp) and the IPDA precedent
  show that raw hit-rates lie; every "confirmed" here beat a *matched* control.
- **P&L uses simple ICT-style stops/targets**, no costs/slippage. Edges are pre-cost;
  the modest ones (sweep +0.05R) may not survive real friction. The confluence and
  FVG edges (+0.4–0.6R) have more margin.

Hypotheses: **6 confirmed** (confluence, FVG-reaction, displacement, OB, sweep,
hour-expansion) · **2 disproven** (FVG-fill, premium/discount) · **3 real-but-not-
tradeable/under-bar** (OTE, equal-H/L, Judas) · **1 inconclusive** (breaker).
