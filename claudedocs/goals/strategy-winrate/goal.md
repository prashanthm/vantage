# Goal: improve win rate + profit factor of Vantage's strategies

- **Outcome**: The playbook-driven paper strategies (test + break setups, SPX/QQQ/IWM)
  win more often and lose less per dollar won; new strategies added if the existing
  family can't reach the bar.
- **Success predicate**: On the frozen E0 backtest window (~60 sessions of 15m bars,
  replaying ticket generation per session and settling first-touch target/stop,
  mark-to-close at EOD), **win rate ≥ E0 + 10 percentage points AND profit factor
  ≥ E0 × 1.25**, with the full test suite still green (ADR-010 intact).
- **Baseline**: E0 = build `server/vantage_server/backtest.py` (bars frozen to a
  cache file so every experiment measures identically) and measure the current
  strategy config.
- **Budget**: 25 experiments minimum.
- **Trigger**: now.
- **Coordinator**: Opus, delegating where parallel.
- **Constraints**: paper/backtest only — no orders ever (ADR-010); experiments on
  branch `goal/strategy-winrate`; confirmed improvements committed, all else
  reverted; predictions pre-registered in log.md before each run.
- **Honest caveat**: yfinance caps intraday history (~60d) — results are indicative
  on 2–3 months, not statistically conclusive; GEX cannot be reconstructed
  historically, so backtests run on the chart-derived level dimensions.

Status: **achieved** · started 2026-07-11 · achieved 2026-07-11
Result: E0 WR 0.103 / PF 0.263 → final WR 0.500 / PF 1.289 (reclaim
config); 25 experiments (11 confirmed / 9 disproven / 2 mixed / 3
inconclusive). Kept: reclaim-entry guidance folded into prod tickets.
Full record in log.md.
