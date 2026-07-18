# Goal: forecast-accuracy

**Started:** 2026-07-17
**Status:** active — E0 baseline set, Arm A done (metric shipped), A1/A2/B1 run.
Next: B2 (session clock), B3 (prior-day H/L/C), B4 (VIX/vol regime), … C/D arms.
Paced via /loop (each experiment ~15-70 min of LLM re-forecasting). Predicate not
yet met (E0 median 30.2pt; target ≤22.7pt).

## Outcome
The SPX-analyst's predicted path tracks the actual intraday tape more closely —
smaller points-error — without trading away directional correctness.

## Success predicate (measurable)
On a fixed evaluation set of replay days (re-forecast under each variant), the
**median absolute per-forecast target-error drops ≥ 25% vs the E0 baseline**, AND
the overall **hit-rate does not regress**. Both numbers come from a NEW
deterministic metric — no LLM judgment in the measurement.

## Primary metric — `target_error` (new, deterministic, offline)
Per resolved forecast, direction-aware distance between predicted `plot.target`
and the realized tape after `as_of` (matches the scorer's `_reached` logic):
- up-call: `abs(target − post_high)`
- down-call: `abs(target − post_low)`

Headline = **median abs target-error (pts)**. Secondary = **path-MAE** (mean abs
distance of predicted path steps to the realized close at each step's time, from
1m bars). Guard = hit-rate. Lives beside `_hit`/`_rate` in `replay_forecast.py`.

## Baseline (E0)
Implement the metric, compute it over existing stored, scored forecasts (the
shipped 2026-07-16 run + any others). That median target-error + hit-rate is what
every experiment is measured against.

## Budget
~20+ experiments (thorough). Stop early if the predicate holds.

## Trigger
Now.

## Constraints
- Measurement is ALWAYS the deterministic metric, never the LLM grader.
- Do NOT re-test validated-negatives: IPDA data-ranges, FVG-fill, premium/discount.
- Every feature-add experiment reuses the SAME frozen eval days (comparable).
- Respect the Mira-free-backend invariant + existing test gates.
- The ML spike uses a matched control (its error vs the LLM's on the same days).

## Honest caveats
- The metric is the real deliverable — makes future improvement measurable.
- ~9 days of 1m is a thin eval set; results are indicative and strengthen as the
  set grows ~1 day/session.
- ML arm is a feasibility spike, not a production model.

## Key prior findings carried in
- ICT edge is HOURLY, disproven at 1m (ict-concepts-edge vs ict-coach).
- Confirmed (hourly): confluence-stack, FVG-reaction, displacement, OB, sweep,
  hour-of-day. Disproven: FVG-fill, premium/discount, IPDA.
- Data ceiling: yfinance 1m ~30d (unbackfillable); ~3yr hourly frozen.
