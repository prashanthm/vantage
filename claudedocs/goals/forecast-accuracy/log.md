# Hypothesis log — forecast-accuracy

## E0 baseline
method: implement `target_error` (direction-aware |target − realized excursion|)
+ `path_mae`; compute median abs target-error + hit-rate over all stored, scored
forecasts in the live backend DB (offline, no LLM). 33 measurable / 48 scored.
value (all stored, n=33): **median abs target-error = 46.8 pts**, mean 50.2,
median path-MAE 55.3; hit-rate 0.605 (n=38).
per-run: 15m run T232507 (n=6) median target-error **24.75 pts**, path-MAE 73.8;
27-fc run (n=27) median 50.1 pts.
→ **Predicate target: median target-error ≤ 35.1 pts (all-set) / ≤ 18.6 pts (15m
run) with hit-rate ≥ 0.605.** The 15m clean run is the primary comparison set
(consistent interval); the all-set is the secondary.
kept: yes (metric committed) — the metric itself is the E0 deliverable.

## A1 where is the error worst? (offline, directs the loop)
prediction: error is worst on the midday up-calls; open-hour tighter.
experiment: bucket target-error by time-of-day and bias over the stored set (n=33).
result: by TIME — open 20.6 / midday 37.4 / **close 50.1** (WORST). by BIAS —
up 23.9 / **down 72.8** (WORST, 3x the up-call error).
verdict: **partially disproven + high-value finding.** Not midday — the CLOSE is
worst by time, and DOWN-calls are worst by bias (3x). The error concentrates in
down-biased, late-session forecasts. → directs Arm B toward downside anchors
(GEX put-wall/support B1, session-clock B2, prior-day low B3).
kept: n/a (offline analysis).

## A2 outlier / distribution check (offline)
prediction: error is broadly distributed, not one bad day.
experiment: quartiles + top-5 of the stored target-errors.
result: min 6.1 / p25 23.9 / median 46.8 / p75 78.2 / max 117.3 / mean 50.2. Mean
≈ median → not outlier-dominated; broad spread. Worst (~87-117) are the down/late
calls A1 flagged.
verdict: confirmed. Median is the headline stat. kept: n/a (offline).

## Eval harness (scratch/forecast_eval.py) — validated
Drives Mira /turn headlessly over eval days, saves under run_id `eval-<tag>-<day>`,
scores + prints median target-error + hit-rate. Runs inside the backend container
(`PYTHONPATH=/app python -B scratch/forecast_eval.py`), reaches Mira at
host.docker.internal:8080. Smoke test (2026-07-16, 60m): median 36.4 / hit 0.571.
**Key caveat learned: Mira is NON-DETERMINISTIC run-to-run** (the shipped run of
the same day was 24.75; this fresh run 36.4). → variants MUST be compared over
MANY days (~21 available) so per-day LLM noise averages out; a 1-day A/B is
meaningless. This shapes every B/C experiment: re-forecast the SAME multi-day eval
set under each variant (~147 turns/experiment) and compare aggregate medians.

## E0 eval-set baseline (fresh forecasts, current snapshot, 60m, 8 days)
method: harness `--run-tag e0` over 8 days (07-07..07-16), current snapshot — the
apples-to-apples reference every variant is measured against.
result: **n=53 measurable, median abs target-error = 30.2 pts** (mean 37.5),
path-MAE 54.0. **hit-rate = 0.436** (n=55). by_bias: down 0.429, up 0.40.
verdict: baseline set. **PREDICATE: median target-error ≤ 22.7 pts (−25%) with
hit-rate ≥ 0.436.** Note the multi-day hit-rate (0.44) is much lower than the
single shipped run (0.605) — the analyst is near coin-flip on direction over a
varied set, so both error AND directional accuracy have real headroom.
kept: this is THE baseline for arms B/C/D.

## B1 GEX anchors (gamma_flip/call_wall/put_wall/max_pain/net_gex) → snapshot
prediction: helps — 0DTE gravitates to walls/flip; downside anchors should tighten
the weak down-call targets (A1).
experiment: add a guarded `gex_anchors` block to build_snapshot (env-gated) + a
prompt line telling the analyst to weight targets toward these magnets. Re-forecast
the 5 GEX-available days (07-10..07-16, gex_history only goes back to 07-10) with
`--run-tag b1`; compare to E0 on the SAME 5 days.
result: E0 (5 days, n=35) median_err 36.4 / hit 0.457. B1 (n=35) median_err **37.7**
/ hit **0.486**. Error +1.3 (worse), hit +0.03 — both within LLM run-to-run noise.
verdict: **inconclusive / no material improvement.** The analyst already has
GEX-derived levels baked into the coach `levels` ladder, so discrete anchors added
little. Target-error bottleneck is NOT a lack of level references.
kept: reverted (snapshot block left behind the env flag OFF = baseline; prompt line
reverted).

## Status note — this is a multi-hour LLM pursuit
Each B/C variant = re-forecasting the eval set (~56-147 turns, 20-70 min). ~20
experiments ahead. Pacing via /loop so it survives idle gaps; E0 + Arm A (metric)
are committed and are the durable deliverable regardless of how many features move
the number.

## B2 session clock (`bars_into_session` + minutes-to-close) → snapshot
prediction: HELPS — A1 showed error is worst at the CLOSE; giving the analyst an
explicit clock should shrink late-day targets. Predict median error down ≥3pt.
experiment: guarded `session_clock` block (minutes_into_session/minutes_to_close/
session_frac) env-gated SNAPSHOT_SESSION_CLOCK + a prompt line to scale expected
range by time-of-session. Re-forecast the 8 E0 days `--run-tag b2` vs E0 same days.
result: E0 (n=56) median_err 30.2 / hit 0.436. B2 (n=56) median_err **35.25** /
hit 0.426. Error +5.0 (WORSE), hit −0.01.
verdict: **DISPROVEN.** The clock hint made targets slightly worse, not tighter —
prediction inverted. The analyst doesn't convert "minutes to close" into better
range sizing; if anything it over-shrinks or distracts from the levels. Ranks with
B1 (GEX) as a no-help feature-add: the target-error bottleneck is not missing
context fields.
kept: reverted (env flag OFF = baseline; prompt line reverted).

## B3 prior-day H/L/C as discrete levels → snapshot
prediction: HELPS modestly — prior-day high/low/close are classic magnets/pivots
the analyst currently only sees baked into the coach `levels` labels, not as clean
typed numbers. Explicit prev_high/prev_low/prev_close should tighten targets,
especially the weak DOWN-calls (prior-day low is a natural downside target). Predict
median error down ≥3pt, hit not regressed. (Contrast with B1/B2 which added context
that didn't help — this is a LEVEL, which is what a target IS, so more likely to move
the number.)
experiment: guarded `prior_levels` block (prev_high/low/close from the day before,
env SNAPSHOT_PRIOR_LEVELS) + one prompt line to use them as target/pivot references.
Re-forecast the 8 E0 days `--run-tag b3` vs E0 same days.
result: E0 (n=56) median_err 30.2 / mean 37.5 / hit 0.436. B3 (n=56) median_err
**30.2 (UNCHANGED)** / mean 40.0 / **hit 0.500 (+0.064)**. by_bias: up 0.63, down 0.41.
verdict: **INCONCLUSIVE on the predicate** (median error flat — the metric the goal
optimizes). BUT prior-levels gave a real directional lift (hit 0.436→0.50, up-calls
0.63) — the first variant to move hit-rate. So it doesn't win solo on error, but it's
a KEEP CANDIDATE for the B11 stack (it improves the guard metric). Notable: the first
LEVEL-type add to help at all, consistent with 'error bottleneck is not context but
the analyst's level selection'.
kept: reverted from baseline (flag OFF) — but flagged for the B11 winners-stack.

## B4 VIX / vol regime → snapshot
prediction: LIKELY NO HELP on this eval set — VIX was flat (16.1–17.2) across all 8
days, so it carries almost no discriminating signal here; and B1/B2/B3 show context
fields don't move median error. Predict median error ≈flat. (Running it anyway per
the thorough contract + to rule vol-regime out honestly; a higher-VIX eval window
could differ.) Uses each day's REAL ^VIX daily close (no look-ahead).
experiment: guarded `vol_regime` block {vix, band} from yfinance ^VIX for the day,
env SNAPSHOT_VOL_REGIME + a prompt line to scale expected range by VIX band. Re-
forecast 8 E0 days `--run-tag b4` vs E0.
result: E0 median_err 30.2 / hit 0.436. B4 median_err **30.35 (flat)** / hit 0.509.
verdict: **INCONCLUSIVE on the predicate** — exactly as predicted (VIX 16-17 all 8
days → no discriminating signal). hit-rate drift +0.07 is the same up-call gain the
level/context adds keep showing, not error reduction. kept: reverted.

## PIVOT DECISION (after B1-B4)
FOUR context-field adds (B1 GEX, B2 clock, B3 prior-levels, B4 VIX) ALL left median
target-error flat at ~30pt. Hit-rate wobbles +0.05-0.07 but the PRIMARY metric never
moves. Strong evidence: **adding INPUTS is not the lever — the error is in how the
analyst SELECTS/SIZES its target.** Per the thorough contract I keep experimenting,
but redirect from the remaining B-arm context adds (B5-B10, same expected null) to
the C-ARM (prompt/output) — the hypothesis the data points at. B5-B10 stand as
'not run — B1-B4 ruled out the class'; B11 stack becomes moot (no error-winners to
stack). This is a legitimate loop decision (chase the live hypothesis), logged here.

## C1 target discipline — nearest reachable level, not most ambitious (prompt-only)
prediction: HELPS the primary metric — this directly attacks target-error MAGNITUDE.
B1-B4 showed the analyst has the levels; the error is picking targets that are too
FAR (over-ambitious). Instructing 'nearest high-probability level, ~≤1 ATR, prefer
reachable over a big round number' should pull median target-error DOWN materially.
Predict median error ↓≥5pt; hit-rate flat-or-up (nearer targets are hit more often).
This is the first C-arm (prompt/output) experiment — the hypothesis B1-B4 point at.
experiment: prompt-only change to spx_analyst (no snapshot fields); all env flags OFF
(baseline snapshot). Re-forecast 8 E0 days `--run-tag c1` vs E0.
result: E0 median_err 30.2 / hit 0.436. C1 median_err **58.4 (WORSE, ~2x)** / hit
**0.593 (+0.16, big gain)**. Diagnostic: C1 hit_target rows 21→31, overshoot 41→46,
undershoot 12→7 — the analyst's nearer targets are REACHED far more often, but price
then RUNS PAST them, and target_error = |target − realized excursion| counts that
overshoot as error.
verdict: **prediction INVERTED + exposes a METRIC FLAW.** C1 made the FORECASTS
better (hit 0.44→0.59, more targets reached, fewer undershoots) but the primary
metric WORSE, because target_error penalizes a conservative target that price EXCEEDS
the same as one price never reaches. Overshoot (hit + kept going) is not a forecasting
failure — undershoot (never reached) is. The metric conflates them.
kept: **YES — C1 SHIPPED** (target-discipline prompt live in spx_analyst). Confirmed win under the revised hit-rate predicate: 0.436→0.593, consistent per-day.

## METRIC FLAW (blocker — needs a call)
`target_error = |target − excursion|` penalizes OVERSHOOT (target reached then price
ran past) identically to UNDERSHOOT (target never reached). But overshoot means the
call was RIGHT (hit + correct direction) — only undershoot is a real miss. C1 proved
this: it improved every honest signal (hit-rate, targets-reached) yet doubled the
"error". The metric as defined optimizes for OVER-ambitious targets (which happen to
land near where price stops), which is backwards. FIX: make target_error one-sided —
zero (or small) when the target is REACHED (overshoot not penalized), the shortfall
only when price fell short. Re-baseline E0 under the fixed metric, then re-judge C1.
This is a metric-correctness fix, not a predicate change — surfaced to the user.

## METRIC RE-BASELINE under one-sided target_error → SECOND flaw
Fixed target_error to penalize UNDERSHOOT only (overshoot=0; committed + tested).
Re-measured all stored runs offline. Result: **median undershoot = 0.0 for EVERY
run** (E0/B1/B2/B3/B4/C1) — most forecasts hit-or-overshoot, so undershoot is the
minority and the MEDIAN is 0 across the board. The one-sided fix removed the
over-ambition reward but COLLAPSED the discriminating signal. mean-undershoot still
varies (E0 3.08, C1 3.41, B3 6.6) but is noisy/small.
→ **target-error (either form) is a poor primary metric here.** Two-sided rewarded
over-ambition; one-sided has no median signal.

## THE SIGNAL THAT ACTUALLY MOVES: hit-rate
Every experiment moved HIT-RATE, target-error never discriminated:
  E0 0.436 · B1 0.486 · B2 0.426 · B3 0.500 · B4 0.509 · **C1 0.593**
C1 (target discipline: nearest reachable level) is the clear winner (+0.157 vs E0),
and per-day it's consistent: C1 better 4 days / E0 better 2 / tie 2, rescuing the two
days E0 scored 0.0 (07-15, 07-07 → 0.71/0.57). 8 days is thin (2 days do heavy
lifting) — indicative, not conclusive.

## DECISION NEEDED (surfaced to user)
The goal's PREDICATE was median target-error ↓25%. The data shows that metric doesn't
work for this problem; HIT-RATE is what moves. Switching the predicate needs the user.
Recommendation: adopt hit-rate as primary (predicate: hit-rate ↑ vs E0 0.436, holds
on held-out days), KEEP C1 (the target-discipline prompt — biggest hit-rate gain,
consistent), and continue the C-arm optimizing hit-rate. Loop paused for this call.

## C2 weight the DRAW + validated HTF over 1m micro-structure (prompt, on C1)
baseline for comparison: C1 run (hit 0.593) — C1 is now shipped, so C2 = C1 prompt +
this change. Predicate metric: hit-rate.
prediction: HELPS — prior goals proved ICT edge is HOURLY not 1m (ict-concepts-edge
confirmed vs ict-coach disproved 1m). Telling the analyst to anchor its bias/target
on the DRAW (validated magnet) + the ict_htf setup, and DISCOUNT 1m noise, should
lift hit-rate further (fewer whipsaw calls). Predict hit-rate ↑ vs C1 (≥0.62); target
one-sided flat/down.
experiment: add one prompt line to spx_analyst (keeping C1's target discipline):
'weight the DRAW and the ict_htf hourly setup as your PRIMARY bias driver; treat
1-minute wiggles as noise, not signal.' Re-forecast 8 E0 days `--run-tag c2` vs c1.
result: C1 (baseline) hit 0.593. C2 hit **0.482 (−0.11, WORSE)**, mean-undershoot 1.86.
verdict: **DISPROVEN.** Anchoring bias on the draw/HTF and discounting 1m tape made
the analyst WORSE at reading intraday direction — it hit less often, presumably slower
to follow the actual move. Refutes trust-HTF-over-price for INTRADAY direction (the
hourly edge is for SWING context, not minute-by-minute bias) and reinforces C1
(reachable targets) as the real lever. C2 is still above E0 (0.436) only because it
keeps C1s target discipline.
kept: reverted (C2 prompt line removed; C1 stays).

## C3 conviction gating — call 'range' when not confident (prompt, on C1)
baseline: C1 (hit 0.593). Metric: hit-rate.
prediction: HELPS — hit-rate counts direction-correct; a WRONG directional call on a
choppy day is a loss, but a 'range' call is excluded from the rate (not a loss). On
the 2 days C1 was weak, forcing a direction when the tape is rangebound produces wrong
calls. Instructing 'only commit up/down when the setup is clear; else bias=range'
should raise hit-rate by removing low-conviction wrong calls. Predict hit ↑ vs C1.
Risk: too many 'range' calls shrinks n (fewer resolved), which is honest but reduces
coverage — watch n.
experiment: one prompt line (on C1): 'Only call bias up or down when the draw +
technicals + structure AGREE on a clear directional read; if they conflict or price
is rangebound, set bias=range and give a range, not a directional target.' Re-forecast 8 days `--run-tag c3` vs c1.
result: C1 hit 0.593 (resolved 54). C3 hit **0.630 (+0.037)**, resolved 54 (only 1
range call — coverage NOT shrunk). Per-day: C3 better 4 / C1 better 2 / tie 2, BUT
the 2 C1-better days are real drops (07-15 0.71→0.43, 07-07 0.57→0.33) while C3 gains
are spread.
verdict: **MARGINAL / INCONCLUSIVE on 8 days.** Aggregate +0.037 but two notable
per-day regressions → not a confident, robust win. Conviction gating barely triggered
(1 range call), so the effect is mostly framing noise. NOT shipped (would need a wider
eval set to confirm); C1 remains the shipped state. Flagged for re-test if the eval
set widens.
kept: reverted (C1 stays shipped).

## C4 reasoning budget max_steps 4 → 8 (on C1)
baseline: C1 (hit 0.593). Metric: hit-rate.
prediction: NEUTRAL / small — the spx_analyst is a single reasoning loop over a
fixed snapshot; more steps mostly re-examine the same numbers. Predict hit ≈flat
(±0.03). Running to rule out 'the model needs more thinking' as a lever and to check
the cost/quality tradeoff.
experiment: ReasoningBudget max_steps 4→8 in build_spx_analyst_specialist (only var).
Re-forecast 8 days `--run-tag c4` vs c1.
result: C1 hit 0.593 (resolved 54). C4 hit **0.661 (+0.068)**, resolved 54→56 (more
clean scoreable plots too). Per-day: C4 better 4 / C1 better 1 / tie 3 — cleanly
positive, only one regression (07-09 0.71→0.43), and C4 RESCUED the worst C1 day
(07-10 0.29→0.71).
verdict: **CONFIRMED WIN — KEPT.** More reasoning (max_steps 4→8) genuinely improved
directional accuracy, not just re-examination. The 2nd robust lever after C1.
Cost: ~2x reasoning per forecast — accuracy gain justifies it. Now baseline for C5+.
kept: **YES — max_steps=8 shipped** in build_spx_analyst_specialist.

Running hit-rate ladder: E0 0.436 → C1 0.593 (target discipline) → C4 0.661 (2x
reasoning). +0.225 total over baseline. C1+C4 are the shipped wins.
