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

Status: **achieved (backtest) — fix ported to both codepaths** · started
2026-07-16 · 3 experiments.
- H1/H2: corrected config backtests to WR 0.64 / PF 3.10 / no_target 0 (paper
  pipeline), vs live paper WR 0.24.
- H3: the COACH's own rules backtest to WR 0.68–0.73 / PF 4.6–6.9 on confluence
  levels; the live coach lacked the guards and was armng junk.
- Ported: `MIN_REWARD_RISK` 1.0→1.5 + `DIRECTION_GATE` in paper.py; `rrMin`
  input (1.5) + target-beyond-entry gate in coach_pine.py. 93 tests green.
- **Honest limit:** the GEX overlay is live-only and UNBACKTESTABLE; only the
  mechanics on confluence levels are validated. Live re-audit of paper trades
  (confirming zero wrong-side / sub-1.5R arms post-fix) still pending as new
  paper trades accrue.
