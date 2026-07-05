# ADR-006: Deterministic mock data layer with frozen clock

## Status

Accepted

## Context

The prototype phase has no backend (ADR-012) but must demonstrate time-dependent logic — wash-sale windows, long-term-date boundaries, chart history — reproducibly across sessions, screenshots, and tests.

## Decision Drivers

1. Wash-sale math depends on "today"; a live clock would silently change TLH statuses between demo sessions and break screenshot-based verification.
2. Chart candles must be stable per symbol so AI markers anchored to bar indices stay truthful; a seeded PRNG (mulberry32 keyed on the symbol) walking back from the real quoted price gives stable, plausible series that end exactly at the displayed price.
3. `Date.now()`-free code is also what a future record/replay test harness needs.
4. Rejected: **live clock + random data** — non-reproducible demos and flaky assertions. Rejected: **hand-authored OHLC fixtures** — 120 bars × 7 symbols of hand data is unmaintainable.

## Research & Rubric

No options weighed — charter decision for the prototype phase.

## Decision

All data is a committed mock module (`src/data.js`) with a frozen `TODAY` (2026-07-05), plus a seeded deterministic OHLC generator (`src/ohlc.js`). No runtime clock or randomness is consulted anywhere in portfolio or chart logic.

## Consequences

### Becomes Easier

- Every session, screenshot, and demo shows identical numbers; wash-window fixtures (e.g. the Jul 1 VOO auto-buy) stay valid.
- The live-data phase swaps one module boundary (`data.js`) rather than hunting scattered `new Date()` calls.

### Becomes Harder

- The demo goes stale as real time passes the frozen date; refreshing the fixture requires re-checking every date-dependent scenario.

## Applies To

- Tax Center, AI Charts, and portfolio-engine specs; ADR-007, ADR-008, ADR-013.
