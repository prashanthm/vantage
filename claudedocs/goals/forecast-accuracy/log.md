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
