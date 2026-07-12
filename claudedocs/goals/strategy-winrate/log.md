# Hypothesis log — strategy-winrate

Metric definitions (fixed for the whole loop):
- **win**: a settled ticket whose exit is the target, or whose EOD mark-to-close
  is positive. **loss**: stop hit or negative close-out.
- **win rate** = wins / settled tickets.
- **profit factor** = gross win points / gross loss points (SPX-equivalent points,
  summed across all three underlyings; each underlying's points normalized by its
  spot so no single symbol dominates: points are measured in % of entry).
- Measurement command: `python -m vantage_server.backtest --cache <frozen bars>`
  — identical dataset + command for every experiment.

Measurement command (fixed):
`server/.venv/bin/python -m vantage_server.backtest --cache backtest_data/bars_frozen.json [--params '{...}']`
Cache frozen 2026-07-10 evening ET: 1,560 15m RTH bars × {^GSPC, SPY, QQQ, IWM}
(60 sessions ≈ 2026-04-14 → 2026-07-10). Fill rules (fixed): resting limit at the
level; a bar touching entry+stop = stop-out; target never credited on the fill
bar; stop-first on ambiguous bars; EOD mark-to-close; unfilled tickets excluded.
Rules locked by `server/tests/test_backtest.py`.

## E0 baseline
method: harness replay, default params (stop_pad 0.20%, counter-trend kept,
breaks+tests, no filters), 108 replayed sessions across SPX/QQQ/IWM.
value: **win rate 0.1031, profit factor 0.263** (n=97 trades; net −12.8%-pts;
87 stop / 6 target / 4 eod; 308 tickets → 155 no-target, 56 no-fill)

→ **predicate targets: win rate ≥ 0.2031 AND profit factor ≥ 0.329** (suite green)

Diagnostics that seed the hypothesis queue:
- by setup: test WR 13.5% PF 0.35 · break WR 6.7% PF 0.17 (breaks worse)
- by trend: with-trend WR 12.7% PF 0.33 · counter WR 5.9% PF 0.14
- by side: long WR 28% PF 0.98 · short WR 4.2% PF 0.08 (window trended up —
  regime-aware rules preferred over direction bans to avoid overfitting)
- by freshness: strong WR 37.5% PF 1.84 (n=8, only profitable slice) ·
  fresh WR 7% PF 0.14 (n=71 — the "untested zones react best" premise is
  NOT supported in this window)
- IWM contributed 0 trades: all 24 of its tickets lacked a target (thin
  confluence without GEX) — a fixable strategy gap, not a harness bug.
- 87/97 exits are stops: the 0.20% stop pad is far tighter than typical 15m
  bar range — likely the single biggest lever.
