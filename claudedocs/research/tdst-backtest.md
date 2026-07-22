# TDST levels on SPX dailies — do they act as support/resistance?

Prompted by the zAsti chart (2026-07-21) which anchors levels to DeMark TDST
lines. Per house rule: backtest on the frozen harness before anything ships.

## Pre-registration (written BEFORE running)

**Hypothesis (H-TDST):** an active DeMark TDST level acts as support/resistance —
when price touches it, it holds (closes back on the respected side) more often
than distance-matched placebo levels evaluated with identical rules.

**Definitions (fixed before the run):**
- Data: `server/backtest_data/bars_hourly_730d.json` `^GSPC`, aggregated to RTH
  daily bars (frozen 2026-07-11; ~480 sessions from 2023-08).
- TD Setup: 9 consecutive daily closes `< close[4]` (buy setup) or `> close[4]`
  (sell setup) — the canonical count, no perfection/intersection refinements.
- TDST level: **buy setup → TDST resistance = highest high of the 9 setup bars;
  sell setup → TDST support = lowest low of the 9 setup bars.** (TradingView-
  common variant; DeMark's "true high/low of bar 1" variant noted as a
  robustness check if the primary result is positive.)
- Active window: from setup completion until a daily close beyond the level or
  60 sessions, whichever first.
- Touch: the day's high/low reaches within 0.10% of an active level, having
  opened on the respected side.
- Hold: the touch day CLOSES back on the respected side (support: close above;
  resistance: close below). Secondary: still on the respected side at close of
  day+1.
- Control: for each touch day, 200 placebo levels drawn uniformly within ±1.5%
  of the prior close, evaluated with the exact same touch/hold rules across the
  same sessions; compare the real hold rate to the placebo distribution.

**Success predicate:** real hold rate exceeds the placebo mean by ≥ +2.0 SD
(z ≥ 2) on the primary (touch-day) metric, with ≥ 25 touch events. Anything
less = no edge; logged honestly either way.

**Pre-registered prediction:** DISPROVEN more likely than not. Prior: the IPDA
20/40/60d level study on this same harness found the "magnet" effect was purely
a distance artifact. Expect z < 1.

## Result — NO EDGE (2026-07-21, `server/scratch/tdst_backtest.py`, seed 20260721)

```
daily bars: 730  (2023-08-11 → 2026-07-10)
TD setups completed: 24  (buy→res 4 · sell→sup 20)
REAL:    touches 4   hold(day0) 1.000   hold(day+1) 0.500
PLACEBO: hold(day0) 0.869 ±0.066        hold(day+1) 0.580 ±0.096  (200 draws)
Z:       day0 +1.99  day+1 −0.83
VERDICT: NO EDGE (predicate required z ≥ 2 with ≥ 25 touches; got 4 touches)
```

**Verdict: DISPROVEN / not evaluable as an edge.** The deeper finding is
structural: TDST levels are barely ever *tested* — they sit at setup extremes,
and in three years of SPX dailies price came back to touch an active one only
4 times. 4/4 holds against an 87% placebo baseline is binomial noise
(p ≈ 0.57), and the day+1 metric is *below* placebo. The pre-registered
prediction (disproven, z < 1 expected) was right in substance.

Method notes for any future revisit: touch-and-close-through days count as
breaks, not failed touches — this inflates absolute hold rates for real AND
placebo identically, so the z-comparison stays fair; the placebo is
distance-matched around each setup's completion close with identical rules.
The DeMark bar-1 true-high/low variant was pre-registered as a robustness
check only on a positive primary — not run.

**Decision: TDST does not enter Vantage** — no chart layer, no coach wiring.
Consistent with the IPDA 20/40/60d result on the same harness: named-level
folklore keeps failing distance-matched controls.
