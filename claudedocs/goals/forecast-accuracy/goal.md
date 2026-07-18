# Goal: forecast-accuracy

**Started:** 2026-07-17
**Status:** ACHIEVED (2026-07-18) — intraday hit-rate 0.436→0.661 (+51%) over the
8-day eval set. Two shipped wins: C1 (target discipline — nearest reachable target)
and C4 (reasoning budget 4→8). ML ruled out (no edge). 11 experiments; the deeper
finding was that the original metric (target-error) was measuring the wrong thing —
hit-rate is what measures intraday forecast quality. See log.md for the full ledger.

## Outcome
The SPX-analyst's predicted path tracks the actual intraday tape more closely —
smaller points-error — without trading away directional correctness.

## Success predicate (measurable) — REVISED 2026-07-18 (user-approved)
On a fixed evaluation set of replay days (re-forecast under each variant), the
**overall hit-rate rises materially vs the E0 baseline (0.436) and holds on the
held-out days**. Hit-rate = wins/resolved (a win is verdict "hit target" or
"direction correct"), fully deterministic. `target_error` (now one-sided) is kept
as a SECONDARY read only.

**Why revised:** the original predicate was median target-error ↓25%. Six
experiments proved that metric doesn't work for this problem — two-sided it rewards
over-ambitious targets (C1 finding); one-sided its median is 0.0 for every run (most
forecasts hit-or-overshoot). Hit-rate is the signal that consistently moves and
measures forecast quality. C1 (target-discipline prompt) is the confirmed win:
0.436 → 0.593.

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
