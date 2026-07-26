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
result: 07-15: 0.481 (flat) · 07-16: 0.556 (−1) · 07-17: 0.667 (flat) · 07-21: 0.741 (+2) · 07-23: 0.704 (+1 vs 0.667) · chop day left

## E4 · H-clock — VERDICT
paired vs 6-day baseline: +15/−13 = net +2 (bar was ≥ +8, disproven < +5);
afternoon-only +12/−10 = net +2; guard passed trivially (0.599→0.611).
verdict: **DISPROVEN**. Meta-pattern after E1/E2/E4: prompt-side nudges
(rules, context blocks, self-feedback) do not move scored outcomes beyond
noise — the model's behavior is dominated by the snapshot + core prompt.
Stop asking; start enforcing in code.

## E5 · H-clamp — deterministic invalidation clamp (OFFLINE counterfactual)
prediction (pre-registered BEFORE run): post-process each baseline
forecast: if bias is up/down and the invalidation sits TIGHTER than the
far edge of the nearest opposing zone (from the row's own stored
snapshot levels), clamp it to that edge. Re-score with the PRODUCTION
scorer. Zero Mira calls — exact, noise-free counterfactual.
Mechanism: 58/64 baseline misses are invalidations; afternoon wicks
through tight stops before targets print. Clamping is monotone (can only
convert misses), so the bars are on MAGNITUDE and HONESTY, not direction:
- CONFIRMED if ≥ +8 net conversions (invalidated → hit target) pooled,
- FALSIFIABILITY GUARDS: clamp bounded to the FIRST opposing zone only;
  report median stop-distance before/after — if median distance grows
  > 1.75×, the clamp is judged unfalsifiable-gaming and DISPROVEN
  regardless of conversions; conversions to "direction correct" count as
  neutral (still a miss).
- If confirmed: ships as a forecast POST-PROCESSOR (code, not prompt) +
  live A/B; forecast invalidation is a thesis boundary, not a trade stop —
  trade stops remain the coach's separate concern.
result: PENDING

## E5 · H-clamp — VERDICT
+16 invalidated→hit conversions (bar ≥ +8 ✓) BUT the falsifiability guard
FAILED: median clamped stop distance 14.5 → 58.0pt (4.01× vs ≤ 1.75×
allowed). The nearest fully-opposing zone is often 50-80pt away on this
tape — the clamp converted by being unfalsifiable, not smart.
verdict: **DISPROVEN per guard** (as pre-registered). Signal preserved:
the shakeout mechanism is real — un-stopped forecasts do print targets.

## E5b · H-clamp-bounded — widen at most 1.5×, never past the zone edge
prediction (pre-registered BEFORE run): new_invalidation = widen the
original stop TOWARD the nearest opposing zone's far edge, capped at
1.5× the original |invalidation − price| (guard satisfied by
construction). Predict net conversions ≥ +8 retained of E5's +16 (the
wick-throughs cluster just beyond tight stops, not 4× away). CONFIRMED
≥ +8 · INCONCLUSIVE +4..+7 · DISPROVEN < +4. Offline, production scorer.
result: clamped 71 rows at exactly 1.50× median width. Conversions:
invalidated→hit 4, invalidated→direction-wrong 1. NET +4.
verdict: **INCONCLUSIVE** per the pre-registered band (+4..+7). Being an
offline deterministic counterfactual there is NO sampling noise — the +4
(≈ +0.025 pooled) is real but small and in-sample. Most of E5's +16 lived
between 1.5× and 4× width: the wicks blow through honest stops too.
kept: candidate only — worth re-testing as part of a combined ship
package + live A/B, not alone.

## Interim scoreboard (6 of 12 experiments spent)
E1 H-fresh: no benefit · E2 H-selffeed: null · E3 placebo: instrument
calibrated (17% step noise, net 0) · E4 H-clock: disproven (net +2) ·
E5 clamp: disproven by falsifiability guard (+16 at 4× width = gaming) ·
E5b bounded clamp: inconclusive (+4 real, small).
THE PATTERN: prompt-side nudges don't move scored outcomes; structural/
code-side changes show small real effects; the afternoon-invalidation
miss mode (91% of misses, 2× rate after noon) remains the target.
REMAINING LEVERS (for E6+): H-chain (real new data; only 3 days covered
by chain_snaps), H-overnight (ES context, derivable all days), combined
E5b+stand-down package, and the in-sample caveats all point to needing a
LIVE A/B for anything that ships.

## Shakeout anatomy (free analyses, pre-E6)
39/58 invalidations are SHAKEOUTS (target printed after the stop); only
19/161 forecasts truly wrong-side (14:00 is the exception: 7/12 wrong).
Wick depth on shakeouts: median needed 3.43× the stated stop (p25 1.78×,
p75 6.26×); stated stops median 6.4pt vs median adverse journey 23.8pt
before target. Mira's direction+target are good; her invalidation widths
are systematically ~4× too tight for the path. E5's 1.75× guard was
intuition — the tape says falsifiability must be judged vs the TARGET,
not vs the (fantasy) original width. chain_snaps covers 4/6 days (H-chain
viable later).

## E6 · H-parity — stop distance clamped to min(zone edge, target distance)
prediction (pre-registered BEFORE run): issuance-time rule, enforced in
CODE: invalidation distance = min(distance to the nearest opposing zone's
far edge, 1.0× target distance) — never TIGHTER than stated, never wider
than the target claim (R:R ≥ 1 floor = symmetric falsifiability, the
same guard the reclaim executor uses). Predict: ≥ +10 net miss→hit
conversions (median MAE 23.8 ≈ plausible target distances). CONFIRMED
≥ +10 with median stop/target ratio ≤ 1.0 · INCONCLUSIVE +5..+9 ·
DISPROVEN < +5. Offline, production scorer, deterministic.
result: 37 rows clamped at median stop/target ratio exactly 1.00 (guard
passed by construction). Conversions: invalidated→hit 5. NET +5.
verdict: **INCONCLUSIVE** (bottom of the +5..+9 band). The geometry
lesson: nearest-reachable targets are 10-15pt, so R:R≥1 stops are still
far inside the 23.8pt median wick — near targets, falsifiable stops and
wick immunity cannot coexist on this tape at the 15-min scale. Honest
stop-side ceiling ≈ +0.03 pooled (E5b/E6 overlap, not additive).

## E7 · H-chain — dealer-flow read from OUR 0DTE chain archive (the one
## untested REAL data input; 4 covered days = 07-21/22*/23/24, *not in set)
prediction (pre-registered BEFORE run): per step, the latest at-or-before
chain snap yields gamma skew (call/put-heavy) + net delta drift since
open, framed as a BIAS TIEBREAKER only (never override structure — the
E1 lesson). Mechanism: attacks the 19 wrong-side misses (14:00-heavy);
flow lean should reduce fighting the crowd. Predict: paired net flips on
the 3 covered fixed days (07-21/23/24, ~81 steps) ≥ +5 with wrong-side
verdicts (invalidated-no-target + direction-wrong) shrinking; CONFIRMED
≥ +7 · INCONCLUSIVE +3..+6 · DISPROVEN < +3 or wrong-sides unchanged.
Mira-run experiment (~1h, 3 days).
result: 07-21: 0.741 (+2) · 07-23: 0.778 (+3) · 07-24: 0.385 (−4).
Paired: +7/−6 = net +1 (bar ≥ +7). Verdict mix: invalidated 25 vs 25 —
IDENTICAL; wrong-sides unchanged.
verdict: **DISPROVEN** — the flow read moved nothing mechanistically; the
day-level swings were redistribution within noise. The last untested real
data input is now tested.

## GOAL STATUS after 8 of 12 experiments — the evidence-backed answer
The user's question was "what additional inputs does Mira need?" The
loop's answer: NONE of the available ones move scored forecast quality.
Every lever class is now tested:
- prompt-side inputs/rules (E1 freshness, E2 self-feedback, E4 clock):
  null — behavior is set by the snapshot + core prompt;
- real market data (E7 dealer flow): null — bias quality untouched;
- code-side claim geometry (E5/E5b/E6): honest ceiling ≈ +0.03 pooled,
  capped by a structural theorem: near targets + falsifiable stops +
  23.8pt median wicks cannot coexist at the 15-min scale;
- instrument (E3): model sampling noise flips 17% of steps net-zero.
The REAL discoveries: 67% of "misses" are shakeouts (direction+target
were right); truly-wrong calls are 12% and cluster at 14:00; the
forecast's weak claim is the invalidation, stated ~4× tighter than the
path. The +0.05 predicate is very unlikely reachable with the remaining
4 experiments inside the current scope/metric.
DECISION PENDING (operator): (a) close the goal — findings stand, budget
partially unspent; (b) amend scope to test the 14:00 STAND-DOWN window —
requires a metric change (precision-of-directional-calls + coverage,
since stand-downs lower raw hit-rate by construction); (c) pivot the
remaining budget to a LIVE A/B of the small-but-real E5b/E6 stop-parity
post-processor. Amendments (b)/(c) change the confirmed contract → the
operator's call, not the loop's.

## E8 · stop-parity LIVE A/B (pre-registered BEFORE any live data; operator
## chose option (c) 2026-07-25 — remaining budget goes to the live test)
The E6 parity rule ships to the PRODUCTION save path as a post-processor
(code, not prompt), A/B-armed: invalidation distance floored at 1.0×
target distance (R:R ≥ 1 symmetric falsifiability), never tighter than
stated. Zone-edge term dropped — E6 measured it never binding (median
ratio exactly 1.00; nearest opposing zones sit 50-80pt out).
arms: deterministic by issuance time — as_of 15-min bucket even = TREATED
(parity applied), odd = CONTROL (stored as stated). Live forecasts only
(run_id NULL); replay runs untouched. plot carries parity_ab +
invalidation_stated so the split is exact and reversible.
measurement: after ≥10 RTH sessions (~135 scored per arm), compare arms
with the production scorer. CONFIRMED if treated hit-rate − control
≥ +0.05 (the goal's own bar) AND treated invalidated-rate lower;
DISPROVEN if ≤ 0; else INCONCLUSIVE and the flag comes out either way.
env gate: VANTAGE_STOP_PARITY_AB=1 (default off → no behavior change).

## E9 · deterministic-baseline vs Mira, same inputs, same scorer (pre-registered BEFORE the six-day run)
Question the goal has circled but never answered head-on: does the LLM
forecaster beat a DETERMINISTIC read of the SAME snapshot? If a rules-only
baseline matches Mira's hit-rate, the LLM isn't earning its cost/variance on
this task.
instrument: server/research/claude_vs_mira_forecast.py (built 2026-07-25).
Per step, take Mira's stored snapshot verbatim, emit a rules plot (direction
= RSI-stretch→revert else VWAP-side; target = nearest ICT liquidity pool
capped 3×ATR; invalidation = SYMMETRIC R:R=1, tightened only to a nearer real
level — never widened, so it's as falsifiable as Mira's). Grade BOTH with the
production score_forecast. Canonical 27-step RTH run per day:
  07-15 …02f395 · 07-16 …f51515 · 07-17 …7915f9 · 07-21 …64afaa ·
  07-23 …9d0595 · 07-24 …3da462  (all 09:30..15:59, scored).
Mira is a SAMPLED LLM (varies run-to-run on identical input: 07-24 showed
0.385/0.462/0.538 across three runs) — so Mira's number here is ONE run's
sample, a known-noisy comparator. The baseline is deterministic (one value).
prediction (pre-registered): pooled over the six canonical runs (~161
scored steps), deterministic baseline hit-rate lands within ±0.05 of Mira's
pooled — i.e. NO material edge either way; the LLM's value on 15-min
target/stop calls is not visible at this grain (consistent with the goal's
"prompt-side nudges don't move scored outcomes" meta-finding, now extended to
"the model itself barely beats rules here").
decision rule (frozen): compute pooled hit-rate for baseline vs the six
canonical Mira runs. Also report Mira's per-day run-to-run spread where >1
clean run exists (the variance finding).
  - baseline − Mira ≥ +0.05 pooled → deterministic baseline is AS-GOOD-OR-
    BETTER: recommend the baseline as the 15-min forecaster (cheaper,
    deterministic, no LLM variance) — a real product change, operator's call.
  - |baseline − Mira| < 0.05 → CONFIRMED no-material-edge: the LLM isn't
    earning its keep on THIS narrow task; document, keep Mira (it does more
    than target/stop — narrative, tool grounding), stop treating 15-min
    hit-rate as an LLM-quality signal.
  - Mira − baseline ≥ +0.05 → the LLM genuinely beats rules here; keep it and
    close this line.
Single day already seen (07-24, not the verdict): baseline 0.500 vs Mira
0.385–0.538. Six-day pooled run next.

## E9 VERDICT — CONFIRMED no material edge (deterministic baseline ≈ Mira)
pooled over the six canonical RTH runs (161 baseline / 160 Mira scored steps):
  Mira   89/160 = 0.556
  Claude 83/161 = 0.516
  delta (claude − mira) = −0.041  →  |delta| < 0.05 → **CONFIRMED no material edge**
per day (mira vs claude): 07-15 .500/.556 · 07-16 .556/.556 · 07-17 .407/.407
· 07-21 .667/.519 · 07-23 .667/.556 · 07-24 .538/.500. The baseline matches
or beats Mira on the CHOP/RANGE days (07-15/16/17) and trails on the two
strong TREND days (07-21/23) — the LLM's edge, such as it is, shows up only
when there's a clean directional draw the rules under-commit to.
Mira run-to-run variance (identical inputs): 07-24 = 0.385/0.462/0.538 across
three stored runs — a ~15pp swing, so any single Mira run's hit-rate is a
noisy sample. The deterministic baseline is, by construction, stable.
INTERPRETATION: on the narrow 15-min target/stop-hit task, an LLM barely
out-scores a rules-only read of the same snapshot (+0.041, inside noise),
and is less consistent. This EXTENDS the goal's meta-finding ("prompt-side
nudges don't move scored outcomes") to "the model itself barely moves them
either — the signal is in the snapshot, not the reasoning." KEEP Mira (it
does narrative + tool grounding + A2UI the baseline doesn't), but **stop
treating 15-min hit-rate as an LLM-quality signal** — it can't distinguish
the model from arithmetic. Best use of the baseline: a control arm in future
forecast experiments (the null a prompt/model change must beat), not a
shipped replacement. Harness: research/claude_vs_mira_forecast.py + the
six-day pooled driver.
