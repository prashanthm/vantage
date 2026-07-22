# Goal: level-folklore — which level/calendar edges are real?

- **Outcome:** every runnable hypothesis from the 2026-07-21 research list
  (level folklore + calendar effects) tested on the frozen harness with a
  pre-registered prediction, a distance-matched or permutation control, and an
  honest verdict — so Vantage draws only what survives.
- **Success predicate:** all 10 hypotheses carry verdict CONFIRMED / DISPROVEN /
  INCONCLUSIVE in log.md, each measured against its own pre-registered
  predicate (stated per-H below); confirmed ones get a follow-up note on where
  they'd wire in.
- **Baseline (E0):** the placebo machinery from the TDST study
  (server/scratch/tdst_backtest.py): touch/hold walk, seeded placebo draws,
  z-score vs placebo distribution.
- **Budget:** 10 experiments (one per hypothesis), single pass.
- **Trigger:** now (user: "Run each one on goal loop, test and log hypothesis").
- **Constraints:** frozen data only (`server/backtest_data/bars_hourly_730d.json`
  + already-persisted store artifacts read-only); scripts in `server/scratch/`
  (gitignored); no production writes; no strategy-facing code ships from this
  goal without its own review.
- **Status:** ACHIEVED (2026-07-21) — 10/10 verdicts logged: 2 confirmed, 7 disproven, 1 n-gated
- **Started:** 2026-07-21
