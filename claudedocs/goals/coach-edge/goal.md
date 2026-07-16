# Goal: close the gap between live paper trades and the validated backtest

- **Outcome**: The live paper-trade / coach implementation stops underperforming
  its own validated strategy. The `strategy-winrate` goal proved the reclaim
  config reaches WR 0.50 / PF 1.29 on the frozen 60-day window, yet the actual
  paper trades sit at ~24% WR / −$1,027. Find and fix the implementation drift so
  live paper results match the backtest within tolerance.

- **Success predicate**: Re-running the SAME backtest harness from
  `strategy-winrate` (frozen 60-day 15m window, reclaim config, first-touch
  target/stop settlement) on the CORRECTED target/R:R logic yields **win rate ≥
  0.45 AND profit factor ≥ 1.2** (i.e. within striking distance of the prior
  0.50/1.29), AND an audit of the closed paper trades confirms the specific bugs
  are gone (zero trades where the target sits on the wrong side of entry; zero
  armed setups below the min-R:R floor). Full test suite green (ADR-010 intact).

- **Baseline (E0)**: Reproduce the current behaviour on the frozen window and
  measure WR/PF with the target/R:R logic AS SHIPPED (no min-R:R gate, target =
  next opposing level even if wrong-side). Also record the closed paper-trade
  audit: how many had wrong-side targets, how many were sub-1R.

- **Budget**: 10 experiments.

- **Trigger**: now.

- **Constraints**: paper/backtest only — no orders ever (ADR-010). Experiments on
  branch `goal/coach-edge`; confirmed fixes committed, else reverted; predictions
  pre-registered in log.md before each run. Reuse the frozen bars in
  `server/backtest_data/` so every experiment measures identically.

- **Honest caveats**: same as strategy-winrate — one 60-day window (Apr–Jul 2026,
  net uptrend), no historical GEX (levels are chart-derived dimensions), thin
  per-tier samples. A "pass" means the implementation matches its backtest, NOT
  that the strategy is proven profitable live. GEX-gated setups can't be
  backtested here at all — those remain unvalidated.

Status: **predicate cleared in backtest (H2)** · started 2026-07-16 · 2 of 10
experiments used. Backtest of corrected config (reclaim + rr_min 1.5 +
direction_gate structure) = WR 0.640 / PF 3.095 / no_target 0, vs live paper
WR 0.24. Remaining: port the fix into the paper/coach codepath, then re-audit
live trades to confirm zero wrong-side targets and zero sub-1.5R arms (the
implementation half of the predicate).
