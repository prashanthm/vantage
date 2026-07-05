# ADR-013: Live data backend & broker aggregation (Phase 3 — deferred)

## Status

Proposed

## Context

Phase 3 (live-data) replaces the mock module with real quotes and real read-only account data. This is the initiative's largest unmade decision: it introduces the first server, the first credentials, and the first third-party data dependency — all deferred behind ADR-012 until this ADR is ratified.

## Decision Drivers

1. Quote feed options span free-tier (yfinance-class, as sentinel uses), paid market-data APIs, and broker-provided data — differing in licensing, reliability, and rate limits.
2. Account aggregation options: aggregator APIs (Plaid-class), per-broker APIs, or manual lots-file import (sentinel's current model) — differing enormously in credential risk and coverage.
3. ADR-010 constrains every option to read-only scopes; any aggregator credential must be incapable of trading.
4. The module boundary is already cut for the swap: everything consumes `src/data.js` exports and `genOHLC()` — the decision is about what fills that boundary, not app rework.

## Research & Rubric

Research pending: `initiatives/vantage/research/adr-013-live-data-backend.md` (to be authored before ratification; rubric: credential risk, read-only enforceability, coverage of the four account types, cost, licensing).

## Decision

Deferred. Candidate direction (non-binding): start with manual lots-file import + free quote feed (sentinel parity, zero credentials), and evaluate aggregator APIs only after that ships.

## Consequences

### Becomes Easier

- (Once decided) the same views run on real data with the swap contained at the data-module boundary.

### Becomes Harder

- Until decided, every demo remains visibly simulated; features in the live-data-platform epic stay deferred (`Proposed — features deferred`).

## Applies To

- live-data-platform epic (features deferred pending this ADR); ADR-006, ADR-009, ADR-010, ADR-012.
