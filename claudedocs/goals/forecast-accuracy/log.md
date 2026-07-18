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
