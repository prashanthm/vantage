# Goal: scanner-families

**Outcome** — validate (or bury) five candidate scanner strategy families on
frozen equity data, and wire ONLY the confirmed ones into the scanner
registry as new detectors / arming gates. Operator approved all five
(2026-07-24): reclaim/role-flip, gap-continuation, volatility-expansion,
context-gated arming, sector/relative-strength pullback.

**Success predicate** — each family classified (confirmed / disproven /
inconclusive) against its pre-registered bar in log.md; confirmed families
get a scanner detector (its own follow-up implementation, paper-armed only
after the detector's live shakeout); disproven families join the graveyard.

**Data** — new frozen artifact `scanner_univ_hourly.json`: 730d × 60m bars
for the FIRST 60 of the 160-name scanner universe (cap logged here — not
silent; the top-60 slice is the liquid end where spreads are tradable), via
yfinance. Macro context reuses `macro_daily_3y.json` + a ^VIX3M add-on.
Existing frozen caches untouched.

**Method notes (honest simplifications, fixed for all runs)**
- "Durable zone" proxy: ≥2 hourly fractal pivots (3/3) within 0.4%; level =
  cluster mean. The production scanner's zone memory is richer; this is the
  portable core.
- Breadth proxy for H4: % of the 60-name universe above its own 50-day —
  not the sector-ETF breadth the playbook uses (self-contained tape).
- RS proxy for H5: top-quartile 20-day return within the universe — not
  sector-relative (no sector ETFs in the freeze).
- Exits are first-touch on hourly bars, stop-first on ambiguous bars,
  40-bar (~5 session) time cap, mark-to-close. No fees/slippage modeled.

**Budget** — 15 experiments (5 families need ≥1 each + sweeps).
**Constraints** — research-only (ADR-010); nothing arms paper trades from
this goal directly; any confirmed family ships its detector behind the
existing A+ tiering + contract-risk gate + dedup pipeline.

**Status**: ACHIEVED · started 2026-07-24 · closed 2026-07-24 — H1 reclaim/role-flip CONFIRMED (long-only, PF 3.60 n=453); gap-continuation, compression-expansion, context-gating, RS-filter all DISPROVEN. Detector build = follow-up. See log.md.
