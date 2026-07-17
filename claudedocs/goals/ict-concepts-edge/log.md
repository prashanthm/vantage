# Hypothesis log — ict-concepts-edge

Dataset: `server/backtest_data/bars_hourly_730d.json` (^GSPC hourly, ~700 OOS days),
plus `bars_frozen.json` (15-min, 60 days) for timing concepts.
Engine: `vantage_server/ict.py` detectors. Harness extends `server/scratch/ipda_backtest.py`.

**Predicate reminder (two-stage):**
- S1: concept behavior beats a MATCHED (distance/time/context-matched) null by
  ≥ +10pp AND p < 0.05. Uniform-range nulls are insufficient (the IPDA lesson).
- S2 (if S1 passes): mechanical strategy beats a matched random-entry control on
  net R, WR ≥ break-even for its R:R.

One concept-variable per experiment. Predictions pre-registered BEFORE each run.

---

## E0 baseline — the matched nulls (pending)
method: port ict.py detectors into the hourly harness; measure the null
distributions each concept is judged against — random-level reversal rate,
random-gap fill rate, random-window expansion, random-entry P&L. Also verify each
detector fires on the frozen set (sanity: does it find the structures).
prediction (pre-registered): the random-level reversal null will sit ~0.45–0.50
and the random-gap fill null high (~0.6–0.8) — SPX gaps fill often regardless — so
FVG "fill tendency" will look strong until matched; I expect most concepts to
show a real-but-small raw effect that shrinks toward the null once matched, with
the confluence stack the most likely to retain a modest edge.
result: detectors fire on the frozen hourly set (5073 bars, 730 days):
  671 pivot highs / 675 lows, 63 SSL + 3 BSL unswept pools, 59 order blocks
  (5 active/unmitigated), 100 fresh FVGs. Matched nulls measured:
  - **random-level reversal null = 0.549** (n=4000): a random reachable level
    reverses ≥1 ATR within 6 bars >half the time. High bar; any reaction-level
    concept must beat 0.549.
  - **random-gap fill null = 0.891** (n=3000): a random gap fills within 40 bars
    89% of the time. SPX fills gaps almost always → "FVGs fill" will look strong
    until matched. (Prediction confirmed.)
  - **random 1-bar expansion null = 0.94 ATR mean / 0.82 median** (n=3000): the
    null for killzone/macro expansion concepts.
verdict: confirmed (baseline + nulls established). Prediction held: gap-fill null
  is very high (0.89) as expected; reversal null (0.549) is higher than the
  ipda-edge reversal null (0.46) because this null only samples levels price
  actually reaches. Nulls are now the yardsticks for S1.
kept: harness at server/scratch/ict_concepts_backtest.py (untracked).

## Concept 1 — Liquidity SWEEP → reversal
prediction: after price sweeps an unswept pivot pool (BSL/SSL) — trades beyond it
  then closes back inside — it reverses ≥1 ATR within 6 bars MORE than the 0.549
  random-level null. But per ict-coach (raw sweep disproven at 1m) I expect the
  edge to be small on hourly too: predict sweep-reversal ~0.55–0.62, edge over
  null < +10pp, likely FAILS S1. (Testing whether hourly is different from 1m.)
experiment: concept_sweep_reversal — a sweep = high>pivot & close<pivot (bearish)
  or low<pivot & close>pivot (bullish), on unswept pivot pools confirmed before
  the bar; reversal = price moves ≥1 ATR away from the swept side within 6 bars.
  vs the E0 random-level reversal null (0.549).
result: sweep-reversal **0.707** (n=450) vs null 0.549 → edge **+15.8pp**,
  p<0.0001. PASS S1. NOTE: this DIFFERS from ict-coach (raw sweep disproven at
  1m) — at hourly, a sweep of a real pivot pool DOES beat a random level. But the
  0.549 null is any reachable level; a swept pivot sits at a structural extreme,
  so a STRUCTURE-matched null (random pivot-distance level) is needed before
  confirming (the ipda lesson). Provisional S1 pass; matched-null check = next H.
verdict: S1-PASS (provisional — needs matched-null robustness before S2)
kept: harness updated (untracked).

## Concept 1b — sweep-reversal vs a STRUCTURE-matched null
prediction: the +15.8pp edge partly reflects that swept pivots are at extremes
  (where reversals cluster) rather than the sweep event itself. Against a null of
  "price reaching a random PRIOR PIVOT level (not swept)" I predict the edge
  shrinks but SURVIVES ≥+7pp — the sweep (wick-beyond-then-close-back) adds real
  information over just being at a pivot. If it collapses <+5pp, the "edge" is
  just "pivots reverse," not "sweeps reverse."
experiment: (pending)
result: (pending)
verdict: (pending)
