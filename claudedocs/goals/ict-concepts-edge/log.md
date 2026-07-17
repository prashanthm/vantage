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
experiment: concept_pivot_touch_reversal — reversal rate when price TOUCHES an
  unswept prior pivot but does NOT sweep it (no wick-beyond-then-close-back).
  Sweep edge = sweep-reversal − pivot-touch-reversal.
result: unswept pivot-touch reverses only **0.427** (n=475) vs sweep **0.707** →
  edge **+27.9pp**, p<0.0001. The edge GROWS against the matched null (opposite of
  the IPDA case). Also notable: pivot-touch reverses LESS than a random level
  (0.427 < 0.549) — reaching a pivot without sweeping tends to continue through.
verdict: **S1 CONFIRMED** — the sweep event carries real reversal information
  beyond being at a pivot. → proceed to S2 (P&L).
kept: harness updated (untracked).

## Concept 1c — sweep→reversal S2 (tradeable P&L)
prediction: enter counter to the sweep at the close of the sweep bar, stop beyond
  the sweep wick + 0.25 ATR, target 1.5R (≈ the reversal magnitude). vs a
  random-entry control (same count, same holding window, random direction). I
  predict positive net R and WR beating break-even (40% for 1.5R), and beating
  the random control — given the 0.707 reversal rate. But sweeps overrun, so the
  stop-beyond-wick may be wide; predict net R modestly positive, not spectacular.
experiment: pnl_from_signals (enter at sweep-bar close, stop beyond sweep wick +
  0.25 ATR, target rr×R) vs random_entry_control (same n, random bar/direction,
  ATR-scaled stop). Swept 450 signals.
result: rr=1.0: WR 0.502 (be 0.50), +2.0R, avg +0.005R vs ctrl −0.089R → beats.
  **rr=1.5: WR 0.424 (be 0.40), +23.8R net, avg +0.053R vs ctrl −0.044R → beats
  by +0.10R/trade.** rr=2.0: avg +0.057R but control lucked into +0.097R → no edge.
verdict: **CONFIRMED (both stages)** at rr ≤ 1.5. Sweep→reversal is the first
  ICT concept with a genuine, matched-null-robust, tradeable edge on SPX hourly.
  Caveat: modest (+0.05R/trade), rr-sensitive (dies at 2.0), and hourly ≠ the 1m
  regime where ict-coach disproved raw sweep — the edge is a SWING/hourly effect.
kept: harness (untracked).

## Concept 2 — FVG as a REACTION level (S1)
prediction: when price returns to a fresh (unfilled) FVG, does it REACT (reverse
  ≥1 ATR away, i.e. the gap acts as support/resistance) more than the 0.549
  random-level null? ict-coach found FVGs valuable as a level+FVG *confluence
  filter*, not a standalone trigger — so I predict FVG-reaction beats the null but
  MODESTLY (~+5–12pp), borderline S1. The stronger effect is likely FVG-FILL
  (next concept), which I expect to be near the 0.891 fill-null (no edge).
experiment: concept_fvg_reaction — first return into a fresh FVG; reaction =
  ≥1 ATR move in the gap's direction (bull=support/up, bear=resistance/down) from
  CE, within 6 bars. vs 0.549 random-level null. AND concept_fvg_fill vs 0.891.
result: **C2 FVG-reaction 0.718 (n=1353) vs 0.549 → +17.0pp, p<0.0001 → PASS S1.**
  **C3 FVG-fill 0.862 (n=1573) vs 0.891 random-gap null → −2.9pp → FAIL S1.**
verdict: C2 **S1 PASS** (needs matched-null check — FVGs form near displacement
  extremes). C3 **DISPROVEN** — FVGs fill NO MORE than a random gap; "FVGs get
  filled" is the same raw-number trap as IPDA (86% looks strong, beats nothing).
kept: harness (untracked).

## Concept 2b — FVG-reaction vs a displacement-matched null
prediction: FVGs form right after displacement, near swing extremes where
  reactions cluster — so some of the +17pp is "you're at a fresh extreme," not the
  gap itself. Matched null = reaction at a random level the SAME distance from the
  displacement bar (no gap). I predict the edge shrinks but SURVIVES ≥+7pp: the CE
  of a real imbalance adds information (this is the confluence ict-coach saw).
experiment: fvg_reaction_matched_null — control level the SAME distance from the
  FVG formation bar's close (random side), no gap; same first-touch→reaction test.
result: matched null reacts **0.545** (n=1254) vs FVG-reaction **0.718** → edge
  **+17.3pp**, p<0.0001. SURVIVES (barely shrinks from the raw +17.0pp). The
  imbalance CE reacts far more than an arbitrary level the same distance out.
verdict: **S1 CONFIRMED** — FVG-as-reaction-level is robust to the matched null.
  → proceed to S2. (This is the level+FVG confluence ict-coach saw, now isolated.)
kept: harness (untracked).

## Concept 2c — FVG-reaction S2 (tradeable P&L)
prediction: enter at the FVG CE on first return, stop beyond the far edge of the
  gap + 0.25 ATR, target rr×R. vs random-entry control. Given 0.718 reaction, I
  predict positive net R at rr 1.0–1.5 that beats the control — but FVG stops are
  TIGHT (gap height is small), so slippage/whipsaw risk; predict a solid edge,
  possibly better avg-R than the sweep (tighter stop = more R per reaction).
experiment: pnl_fvg (enter at CE on first return, stop beyond the far gap edge +
  0.25 ATR, target rr×R) vs random-entry control. 1356 signals.
result: rr=1.0: WR 0.580, +216R, avg +0.159R vs ctrl −0.031R. rr=1.5: WR 0.524,
  +422R, avg +0.311R vs ctrl +0.070R. **rr=2.0: WR 0.473, +571R, avg +0.421R vs
  ctrl −0.002R → edge +0.42R/trade.** Beats control at every rr; edge GROWS with rr.
verdict: **CONFIRMED (both stages) — strongest concept so far.** ~8× the per-trade
  edge of sweep→reversal (+0.42R vs +0.05R), on 3× the signals. This is the
  level+FVG confluence ict-coach saw, isolated as a standalone hourly edge. The
  tight FVG stop = high R per reaction. Top candidate for the coach.
kept: harness (untracked).

## Concept 4 — ORDER-BLOCK reaction (S1)
prediction: on first return to an unmitigated OB (sweep+displacement+FVG), does
  price react ≥1 ATR? ict-coach found OB-proximity INCONCLUSIVE at 1m (too
  rare/small). On hourly OBs are rarer still (E0: 59 total, 5 active) — I predict
  INCONCLUSIVE (n<30 reactions) or a wide CI. If enough fire, likely a real
  reaction edge (OB ⊃ FVG, and FVG-reaction confirmed) but small-n.
experiment: concept_ob_reaction — first return into an OB (sweep+displacement+FVG),
  react ≥1 ATR in the OB's direction from CE. vs 0.549 null.
result: OB reaction **0.810 (n=42)** vs 0.549 → +26.1pp, p=0.0007. PASS S1
  (n≥30). Better than the 1m INCONCLUSIVE (ict-coach) — on hourly OBs fire enough
  to reach significance and react strongly (OB ⊃ FVG, and FVG-reaction confirmed).
verdict: **S1 CONFIRMED (small-n caveat, n=42).** Not run through S2 separately
  (42 signals too thin for a clean P&L) — but OB is a *stricter subset* of the
  confirmed FVG-reaction, so its edge is inherited. Coach value: a high-conviction
  FVG (the ones that are also OBs). Re-test S2 as the sample grows.
kept: harness (untracked).

## Concept 5 — BREAKER block flip (S1)
prediction: a breaker (failed OB whose swing was swept, then structure flips) —
  on retest, does it hold in the new direction (react ≥1 ATR)? Breakers are even
  rarer than OBs on hourly. I predict INCONCLUSIVE (n<30) — likely too few to
  score. If enough fire, a real edge (sweep+flip is the strongest ICT array) but
  under-sampled.
experiment: concept_breaker_flip — OB violated (close beyond), then on first
  return the zone holds FLIPPED (≥1 ATR opposite move). vs 0.549 null.
result: breaker flip 0.692 (n=26) vs 0.549 → +14.4pp but p=0.14, n<30.
verdict: **INCONCLUSIVE** (under-sampled — only 26 hourly breakers). Directionally
  consistent with the OB/FVG family; re-test as sample grows.

## Concept 6 — PREMIUM/DISCOUNT (buy-discount / sell-premium)
prediction: over a trailing dealing range (swing low→high), buying when price is
  in the DISCOUNT half (<50%) and selling in PREMIUM (>50%), held N bars, beats a
  random-side control. This is mean-reversion in disguise; on SPX (trending up
  most of the window) I predict it's WEAK or DISPROVEN — buying discount works in
  ranges, fails in trends, and 2023-26 SPX trended. Predict FAIL S1 or no P&L edge.
experiment: concept_premium_discount — over a 60-bar range, buy in discount /
  sell in premium, hold 12 bars → avg ATR return vs random-side control.
result: buy-disc/sell-prem **−0.069 ATR/trade** vs random +0.049 (n=834). LOSES.
verdict: **DISPROVEN** — mean-reversion against a trending market (2023-26 SPX rose).
  Buying discount / selling premium is a losing side on a trending instrument. As
  predicted. (Would need a range-regime filter to salvage — not standalone.)

## Concept 7 — OTE zone (0.62–0.79 retrace)
prediction: entering a retracement into the 0.62–0.79 fib zone of an impulse (in
  the impulse direction) beats entering at a RANDOM retrace depth of the same
  impulse. ICT claims 0.705 is special; I predict the OTE zone shows a SMALL edge
  over random retrace depth (maybe +3–8pp reversal/continuation) but likely FAILS
  the +10pp S1 bar — the "0.705 is magic" claim is probably not distinguishable
  from "deep retraces in a trend continue."
experiment: concept_ote — retrace into 0.62–0.79 of a displacement impulse →
  continue in impulse dir ≥1 ATR, vs retrace to a RANDOM depth (0.2–0.77) of the
  same impulse.
result: OTE continue **0.794 (n=528)** vs random-depth **0.650 (n=583)** → edge
  **+14.3pp**, p<0.0001. PASS S1. (Prediction WRONG — I expected FAIL.)
verdict: **S1 CONFIRMED** — the 0.62–0.79 zone genuinely outperforms a random
  retrace depth for continuation. Not "0.705 is magic" but the deep-retrace band
  is real. → S2 candidate.
prediction: equal highs/lows (2+ pivots within a tolerance) get SWEPT more than a
  random single pivot of the same recency. ICT: "equal H/L almost always get run."
  I predict CONFIRMED — engineered/obvious liquidity is the one draw claim most
  likely to hold (it's the clustering that makes it a target). Predict swept-rate
  edge ≥+10pp over a matched single-pivot null.
experiment: concept_equal_hl_draw — equal H/L (2+ pivots within 0.15 ATR, ≤40
  bars apart) swept within 60 bars, vs a single (non-equal) pivot of same recency.
result: equal-H/L swept **0.871 (n=473)** vs single-pivot **0.783 (n=861)** → edge
  **+8.8pp**, p<0.0001. Statistically real but BELOW the +10pp bar.
verdict: **FAIL S1 (borderline)** — equal H/L DO get swept more than single pivots
  (+8.8pp, highly significant), but under the pre-registered +10pp threshold.
  Prediction (confirmed) too strong. Verdict: real-but-weak; note as a minor
  context signal, not a standalone edge.
