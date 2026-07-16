# Goal: ICT-informed feature set for the Vantage-native live coach

- **Outcome**: A prioritized, EVIDENCE-BACKED set of features to build into the
  live (Vantage-native) coach, derived from the operator's own two indicators
  (liq-levels-mtf, t4t-high-prob-ob) + ICT concepts, and validated against the
  operator's real trades. Ports the indicators to Python so the coach can reason
  about liquidity/OB/FVG live — the thing Pine cannot do.

- **Success predicate**: `claudedocs/goals/ict-coach/design-doc.md` exists and,
  for EACH proposed coach feature, carries a real-trade backtest verdict
  (confirmed / disproven / inconclusive) with the measurement + a build priority.
  A feature is "confirmed" if it separates the operator's winners from losers on
  the 1m-persisted real trades (directionally; small-n caveat noted per feature).
  Ships when every proposed feature has a verdict and the doc ranks them.

- **Baseline (E0)**: reproduce the two indicators in Python and confirm they
  detect the structures on the captured 1m sessions (07-13..16) — pivots/sweeps,
  OBs (sweep+displacement+FVG), breakers. No edge claim yet; just "the engine
  works and finds the structures the charts show".

- **Budget**: 12 experiments. Trigger: now.

- **Constraints**: research + backtest only, NO prod code built into the coach
  until the doc is done and reviewed. Reuse the 1m intraday_bars persistence +
  the FVG harness. The two Pine scripts are the source of truth for the algos
  (not generic ICT theory). Order blocks / breakers / sweeps are reproducible;
  anything the scripts DON'T compute is out of scope.

- **Honest caveats**: the operator's real-trade sample is small (~48 trades over
  4 sessions, 1m). Feature verdicts are indicative, not conclusive — each carries
  its n. The 1m sample grows automatically (persistence shipped) so the doc's
  verdicts can be re-run later with more data.

Status: **ACHIEVED** · started+finished 2026-07-16 · design-doc.md ships 6 features each with a real-trade verdict. Confirmed: midday-level trap (strongest), against-HTF-draw, combined low-conviction flag. Disproven: raw sweep, 1m-FVG draw (inverted). The engine ports are in server/scratch. Nothing built into prod yet (per constraint).
