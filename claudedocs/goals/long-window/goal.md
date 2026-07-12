# Goal: validate the combined findings on the largest available window

- **Outcome**: Re-test every mechanism adopted across the three prior loops
  (reclaim entries, confirmation depth, pivot width 3, structure gate,
  durable-vs-fresh zones, break-vs-test hierarchy, confluence tolerance) on a
  ~730-day hourly replay (~480 sessions, 2024-07 → 2026-07, multiple regimes),
  producing a verdict per mechanism: regime-robust or window-artifact.
- **Baseline (E0)**: freeze a long hourly cache (^GSPC/SPY/QQQ/IWM, 60m×730d);
  measure the touch-entry baseline at hourly granularity.
- **Success predicate**: ≥25 pre-registered experiments ending in a definitive
  verdict table: a mechanism REPLICATES if it beats its control on BOTH win
  rate and profit factor on the full window AND directionally in each yearly
  half (2024-07→2025-07, 2025-07→2026-07); failures are documented as
  window-artifacts and prod guidance corrected. Either verdict per mechanism
  satisfies the goal — the table is the deliverable.
- **Scope guard**: the 5m/15m champion config stays untouched (it used all
  fine-grained data that exists — yfinance caps 5m/15m at 60 days); hourly
  absolute numbers are NOT comparable to the 60-day program and are never
  claimed as trading expectations.
- **Budget**: 25 experiments minimum. **Coordinator**: Opus.
- **Constraints**: paper/backtest only (ADR-010); branch `goal/long-window`;
  one frozen cache for every run; predictions pre-registered; prod changes
  only as guidance corrections for failed mechanisms.

Status: **active** · started 2026-07-11
