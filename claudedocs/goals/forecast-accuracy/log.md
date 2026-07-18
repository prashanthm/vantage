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
result: _running_
verdict: _pending_
