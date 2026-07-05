# Pattern Signals Scanner

> Part of epic: [market-intelligence](../epics/market-intelligence.md)
> **Slug:** pattern-signals-scanner

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The AI pattern-signal table: ticker, pattern name, entry/target/stop, expected move, confidence, and status — split into Active and Past tabs with counts, where past signals carry honest outcome badges (hit target / stopped).

## Why

Satisfies market-intelligence AC 2 (active/past separation with outcomes) — the anti-memory-holing guarantee.

## Acceptance Criteria

- [ ] Tabs show live counts; switching filters rows without reload.
- [ ] Every past signal displays an outcome badge; no signal disappears.
- [ ] Numeric columns are right-aligned tabular figures; move % carries direction styling with sign.

## Depends On

- None (fixture-driven). ADR-006.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/pattern-signals-scanner/`.
