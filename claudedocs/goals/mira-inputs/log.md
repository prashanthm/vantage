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

