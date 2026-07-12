# Goal: find the best confirmation-bar interval for the reclaim trigger

- **Outcome**: Determine which bar interval (2m / 5m / 15m / 30m / 60m) for the
  reclaim entry trigger produces the best win rate (PF as guard), and adopt the
  winner into ticket guidance.
- **Success predicate**: ≥25 pre-registered experiments on a frozen
  multi-interval cache, ending in one of two definitive outcomes:
  (a) an interval beats the 15m baseline by ≥5pp win rate with PF no worse,
  replicates in a split-half robustness check, and is adopted into prod ticket
  text; or (b) every alternative is measured and disproven — a confirmed "15m
  stands" also satisfies the goal.
- **Baseline (E0)**: freeze the multi-interval cache (same ~60-session window,
  ^GSPC/SPY/QQQ/IWM) and re-measure the 15m reclaim config on it (champion:
  WR 0.500 / PF 1.289 on the prior cache).
- **Method**: scaffold, levels, and ticket generation stay on 15m (the
  playbook's timeframe); only trigger detection + fill settlement run at the
  candidate interval — the interval is the sole variable. 1m excluded
  (yfinance ~30-day cap breaks window parity).
- **Budget**: 25 experiments minimum. **Coordinator**: Opus.
- **Constraints**: paper/backtest only (ADR-010); branch `goal/reclaim-interval`;
  identical frozen dataset per experiment; predictions pre-registered.

Status: **achieved** · started 2026-07-11 · achieved 2026-07-11 ·
outcome (a): champion changed to 3 consecutive 5m closes (WR 0.500→0.600,
PF 1.289→1.387, split-half replicated); adopted into prod ticket text.
25 experiments (13 confirmed / 3 disproven / 4 mixed / 1 inconclusive).
Full record in log.md.
