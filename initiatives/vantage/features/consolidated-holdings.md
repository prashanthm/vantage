# Consolidated Holdings

> Part of epic: [account-aggregation](../epics/account-aggregation.md)
> **Slug:** consolidated-holdings

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The Holdings view: combined positions across the scoped accounts with per-account chips, value/day/unrealized/weight columns, expandable per-lot rows (purchase date, cost, short/long-term), and cross-account flags — overlap (near-identical exposure held in multiple places) and single-stock concentration.

## Why

Satisfies account-aggregation AC 2 (combined positions with per-lot drill-down) and AC 4 (derived, never stored).

## Acceptance Criteria

- [ ] Each combined row aggregates all scoped lots for a symbol and lists holding accounts as chips.
- [ ] Clicking a row toggles per-lot subrows showing date, shares @ cost, unrealized, and term.
- [ ] Overlap badges render only in consolidated scope and name the overlap group; concentration badges flag single stocks >7% weight.
- [ ] Sorting is by value descending; weights sum to ~100% of scoped value.

## Depends On

- [accounts-scope-rail](accounts-scope-rail.md). ADR-007 (pure derivation).

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/consolidated-holdings/`.
