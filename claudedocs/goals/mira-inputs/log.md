# Hypothesis log — mira-inputs

## E0 baseline
method: mira_replay.py on fixed days {07-21, 07-23, 07-24}, current prompt,
pooled hit-rate (hit target / scored).
value: **POOLED 0.625 (50/80)** — 07-21 trend: 0.667 (18/27) · 07-23
rally: 0.667 (18/27) · 07-24 chop: 0.538 (14/26). Chop is the weak day,
as expected. Predicate target: pooled ≥ 0.675 via confirmed changes.
Instrument sanity: matches the live pipeline's historical ~0.66 on
directional days — the headless harness reproduces production.

## Instrument caveat (logged before E1, applies to all runs incl. E0)
Replay snapshots for a day with a stored `{sym}:intraday` slot can see that
slot even at morning as_of times (the slot row has no write-time; the
lookup is day-keyed). Anachronism is CONSTANT across experiments — deltas
vs E0 remain valid; absolute rates on 07-23 are slightly flattered.

## E1 · H-fresh — levels-map freshness fact + staleness rule
prediction (pre-registered BEFORE run): the snapshot gains a param-gated
`freshness` block (levels_slot: intraday/overnight/prior-day) and the
prompt gains the rule "stale map ⇒ GEX anchors are reference-only; derive
targets from live structure". Mechanism: Wednesday's failure was targets
pinned to pre-open anchors price had migrated away from. Predict: chop day
07-24 (all-overnight maps) improves ≥ +0.07 (0.538 → ≥ 0.61); trend days
±0.04 (their anchors mostly held); pooled ≥ +0.03 (≥ 0.655). DISPROVEN if
pooled lift < +0.01 or any day regresses > 0.10.
experiment: mira_replay.py --experiment h_fresh on the three fixed days.
result: 07-21: 0.630 (−0.037) · 07-23: 0.630 (−0.037) · 07-24: 0.462
(−0.076!) — pooled 0.575 vs E0 0.625 = **−0.050**.
verdict: **DISPROVEN** — decisively. The predicted mechanism inverted: the
day that was supposed to benefit most regressed most. Read: told to treat
GEX anchors as reference-only and derive targets from "live structure",
Mira picked MORE ambitious / less magnetic targets — the anchors were
doing real work even stale (rhymes with the forecast-accuracy goal, where
nearest-reachable-target discipline was the big win; loosening target
anchoring is anti-discipline). Freshness INFO may still help; a blanket
distrust-the-map RULE does not.
kept: NOTHING ships. Backlog variant H-fresh-v2 (conditional: rule fires
only when price sits > 25pt from the nearest GEX anchor) — lower priority.


## E2 · H-selffeed — Mira sees her own scored track for the day
prediction (pre-registered BEFORE run): per step, feed the last 3 code-
graded verdicts of forecasts made ≥60 sim-minutes earlier (look-ahead
safe) + a self-correction rule (two same-direction invalidations ⇒ don't
repeat the bias without citing what changed; hits ⇒ keep target
discipline, don't get ambitious). Mechanism: repeated wrong-side calls
after regime shifts are the known leak; E1 taught us NOT to loosen target
anchoring, so the rule explicitly preserves it. Predict: pooled ≥ +0.03
(≥ 0.655); chop day +0.05 or better (repeats hurt most there); trend days
flat ±0.04. DISPROVEN if pooled lift < +0.01 or any day regresses > 0.10.
experiment: mira_replay.py --experiment h_selffeed on the fixed days.
result: 07-21: 0.704 (+0.037) · 07-23: 0.667 (flat) · 07-24: 0.462
(−0.076) — pooled 0.6125 vs E0 0.625 = −0.0125.
verdict: **DISPROVEN** per the pooled floor. But the headline is the
COINCIDENCE: E1 and E2 — entirely different content — both landed the chop
day on exactly 12/26 (0.462), same denominator. Suspect: ANY extra prompt
block destabilizes target selection on ambiguous days (prompt-perturbation
sensitivity), and content is secondary. Trend-day +0.037 suggests selffeed
has real value that chop noise is masking.
kept: nothing ships yet — E3 placebo control decides what E1/E2 actually
measured.

## E3 · placebo control — VERDICT + the goal's most valuable finding so far
per-day: 07-21 0.778 (+0.111!) · 07-23 0.593 (−0.074) · 07-24 0.500
(−0.038). POOLED 0.625 — exactly E0. Paired per-step vs E0 (after fixing a
pairing contamination: an old 5-min-grid 07-21 run polluted launch-order
labels; runs now filtered by launch timestamp):
  E1 vs E0: +6/−10 (net −4, discordance 0.20)
  E2 vs E0: +5/−6  (net −1, discordance 0.14)
  E3 vs E0: +7/−7  (net  0, discordance 0.17)  ← the null signature
verdict: **NULL CONFIRMED as designed** — and it recalibrates everything:
a null change flips ~17% of steps (±7 each way, net 0). sd(net) ≈ √14 ≈
3.7 hits ≈ 0.046 pooled. Therefore:
- E1 "decisive harm" SOFTENS to "no benefit, harm not established"
  (net −4 ≈ 1σ). E2 is a clean null. The chop 12/26 twins were noise.
- The pre-registered +0.05 pooled threshold ≈ 1σ of single-run noise —
  the protocol as designed was UNDERPOWERED. Detecting +0.05 at ~2σ needs
  ~160+ steps or replicates.

## PROTOCOL AMENDMENT 1 (logged before use; predicate unchanged)
- Day set expands to SIX fixed days: original {07-21, 07-23, 07-24} +
  {07-15, 07-16, 07-17} (E0b baselines the new days once). ~162 steps;
  null sd(net) ≈ 5.2 → +0.05 pooled ≈ 8 net hits ≈ 1.6σ, and paired-flip
  judgment at |net| ≥ 11 (~2σ) becomes the confirm bar.
- Experiments are judged on PAIRED NET FLIPS vs baseline (primary) and
  pooled rate (secondary); per-day numbers are descriptive only.
- E1-E3 remain as logged (3-day era); E4+ use the 6-day protocol.

## E0b · baseline extension on the three new days
prediction: none needed (baseline). result: 07-15: 0.481 (13/27) · 07-16: 0.593 (16/27) · 07-17: running

## Six-day baseline (E0+E0b) + miss anatomy
pooled 0.602 (97/161). Verdicts: hit 97 · invalidated 58 · direction-
correct 5 · inconclusive 1 — **91% of misses are invalidations** (wrong
side or shaken out), NOT unreached targets. Miss rate by hour: 09-11h
0.29-0.33 → 12h 0.46 → 14h 0.54 → 15h 0.41. The afternoon invalidates 2×
the morning — the forecast twin of the validated midday-entry trap.

## E4 · H-clock — own failure base rates by hour + afternoon stop rule
prediction (pre-registered BEFORE run): time-context block gives the hour,
the coarse base rates (morning ~3/10 invalidated, 12:00-15:00 ~5/10), and
the rule: KEEP target discipline; place afternoon invalidation beyond the
far edge of the nearest opposing zone; prefer stand-down over a tight
stop. Predict: paired net flips vs the 6-day baseline ≥ +8, concentrated
in 12:00-15:45 steps; pooled ≥ +0.04. ANTI-GAMING GUARD: hits per TOTAL
step (not per scored) must also rise — stand-downs that merely shrink the
denominator do NOT count. DISPROVEN if |net| < 5 or the guard fails.
DISCLOSURE: the base rates are measured on these same six days (partially
in-sample); a confirm here ships only to a live A/B, not straight to prod.
result: PENDING
