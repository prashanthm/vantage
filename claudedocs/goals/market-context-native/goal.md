# Goal: native Market Context module

**Started:** 2026-07-19
**Status:** active

## Outcome
Vantage computes its own Market Context (breadth, VIX term structure, sector
rotation, intermarket macro) from yfinance daily data — no Sentinel dependency —
folded into the Daily plan regime + analyst prompt; and the edge of the new
context signals on next-day SPX behavior is measured on the frozen harness.

## Success predicate (both required)
1. **Populates natively:** `market_context()` returns `available: True` with
   non-null `breadth.pct_above_50ma`, `vol.vix` + `vol.contango`/`stance`,
   `sectors[]`, and a new `intermarket{}` block, for a live call AND across the
   frozen eval sessions — with ZERO reads of any `/sentinel/` path
   (grep-verifiable). Wired into the playbook `regime` (VIX/breadth non-null).
2. **Edge tested:** ≥1 context signal (VIX term-structure stance OR breadth)
   has its relationship to next-day SPX realized range/direction MEASURED on the
   frozen harness vs a no-context baseline, with sample size — win OR honest
   no-edge. (Populating is the hard requirement; the edge is measured & reported
   either way.)

## Baseline (E0)
`market_context()` returns `_missing`/null today — live playbook regime shows
vix=None, breadth=None; depends on retired `/sentinel/logs/market_context.json`.
No intermarket block. Edge untested.

## Budget
12 experiments. Trigger: now.

## Constraints
- ADR-010 read-only (no order paths).
- No new pip dependencies (yfinance already present).
- Revert `server/tests/fixtures/quotes_cache_yf.json` churn before commits.
- Secret-scan before every push.
- Frozen harness (`server/backtest_data/*`) stays read-only.
