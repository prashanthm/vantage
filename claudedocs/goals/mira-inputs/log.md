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

## E3 · placebo control — does ANY extra block hurt the chop day?
prediction (pre-registered BEFORE run): add an information-FREE block
("REMINDER: regular trading hours are 09:30–16:00 ET; this note carries no
market information.") — nothing else. If chop lands ≤ 0.50 (like E1/E2),
the harness/model is sensitive to prompt perturbation itself and all input
experiments must beat a PLACEBO baseline, not E0; if chop stays ≥ 0.52
(within noise of 0.538), then E1/E2's chop damage was CONTENT, and
H-selffeed deserves a v2 rerun with a chop-safe phrasing. Trend/rally
predicted flat ±0.04 either way.
experiment: mira_replay.py --extra-file placebo.txt on the fixed days.
result: PENDING

