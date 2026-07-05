# ADR-007: Portfolio math is pure functions over a single lots table

## Status

Accepted

## Context

Consolidated totals, per-account scoping, overlap flags, drift, and TLH candidates are all views over the same underlying facts. Storing any derived value invites drift between views (the exact failure the product exists to prevent in users' portfolios).

## Decision Drivers

1. One source of truth: `LOTS` (account, symbol, date, shares, cost) is the only positional fact table; everything else — positions, allocation, weights, wash status — derives per render.
2. Pure functions (`positions()`, `allocation()`, `tlhCandidates()`, `washStatus()`) are unit-testable without DOM or fixtures beyond the data module.
3. The dataset is tiny (tens of lots); recomputation per render costs nothing measurable, so caching would be complexity without payoff.
4. Rejected: **precomputed/stored aggregates** — invites stale derived state. Rejected: **state-management library (Redux/Zustand)** — nothing here is async or shared enough to justify it under ADR-003.

## Research & Rubric

No options weighed — inherited from sentinel's derive-don't-store reporting discipline.

## Decision

All portfolio computation lives in `src/util.jsx` as pure functions over `LOTS` + `MARKET`; React state holds only UI concerns (route, scope, open panels, settings). Derived numbers are never persisted.

## Consequences

### Becomes Easier

- Scope switching is just re-calling the same functions with a different filter; correctness is testable in isolation.

### Becomes Harder

- At real-world scale (thousands of lots, live ticks) memoization will need to be introduced deliberately.

## Applies To

- Portfolio engine and Tax Center specs; ADR-006 (data), ADR-008 (wash model).
