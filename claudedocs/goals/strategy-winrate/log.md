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

## H1 widening the stop pad (0.20% → 0.50%) rescues instant stop-outs
prediction: WR at least doubles (≥0.20) since 15m bars routinely range past
0.20%; PF improves to ~0.4-0.6 (bigger per-loss size partly offsets); still
unprofitable overall.
experiment: params {"stop_pad_pct": 0.50}; all else default.
result: WR 0.2371, PF 0.239, net −26.0% (n=97; 65 stop / 22 eod / 10 target)
verdict: mixed — WR-doubling confirmed, PF-improvement disproven (0.239 < 0.263).
Wider stops rescue entries but grow loss size faster than the saved trades pay.
kept: reverted (params-only; nothing to revert in code)

## H2 fixed R-multiple targets (1.5R) beat next-zone targets
prediction: rescues most of the 155 no-target tickets → n roughly doubles
(~200+); WR 0.30-0.45 (targets sit a reachable 0.30% away at the 0.20% stop);
PF 0.6-0.9 — the biggest single-variable PF gain available.
experiment: params {"target_r_multiple": 1.5}; all else default.
result: WR 0.1724, PF 0.293, net −20.3% (n=174; IWM finally trades, n=10;
no_target 155→0, no_fill 56→134)
verdict: disproven — WR fell below prediction band (0.17 vs 0.30-0.45); PF gain
marginal (0.293 vs 0.263). Targets aren't the constraint; selection is.
kept: reverted

## H3 dropping counter-trend tickets lifts both metrics
prediction: matches E0's with-trend slice: WR ≈ 0.127, PF ≈ 0.33, n ≈ 63 —
confirms slice arithmetic transfers (trades are independent).
experiment: params {"exclude_counter_trend": true}; all else default.
result: WR 0.127, PF 0.332, net −7.35% (n=63) — exactly the E0 with-trend slice.
verdict: confirmed — slice arithmetic transfers 1:1; PF 0.332 already clears the
PF target (0.329) but WR doesn't. Selection filters compose predictably.
kept: reverted (will fold into the composite config later)

## H4 dropping "fresh" (no-memory) zones keeps only proven levels
prediction: matches E0 slices minus fresh: n ≈ 26 (strong+tested+weak),
WR ≈ 0.19, PF ≈ 0.45. Sample gets thin — informative but fragile alone.
experiment: params {"exclude_freshness": ["fresh"]}; all else default.
result: WR 0.1923, PF 0.635, net −1.53% (n=26)
verdict: confirmed — biggest single-filter PF jump (0.263 → 0.635). Durable-level
memory is real signal; zones with no cross-session record are the drag.
kept: reverted (candidate for the composite)

## H5 dropping break (C/D) setups
prediction: matches E0 test-only slice: n ≈ 52, WR ≈ 0.135, PF ≈ 0.35.
experiment: params {"include_breaks": false}; all else default.
result: WR 0.1346, PF 0.351, net −5.84% (n=52) — exactly the E0 test slice.
verdict: confirmed — breaks subtract value in this window.
kept: reverted (candidate for the composite)

— instrument upgrade (between H5 and H6): harness gains entry_mode="reclaim",
stop_atr_mult, time_stop_bars, skip_open_bars, direction_gate="structure".
Defaults off; E0 re-verified identical after the change. New fill rules locked
by added tests. —
