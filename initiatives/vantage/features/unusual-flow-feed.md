# Unusual Flow Feed

> Part of epic: [options-intelligence](../epics/options-intelligence.md)
> **Slug:** unusual-flow-feed

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The unusual-options-activity table: large prints and sweeps with ticker, side/kind badge (call/put × sweep/block/ladder/spread), contract detail, premium size, a sentiment read, and confidence.

## Why

Satisfies the options-intelligence flow-watching scope; complements the screener with market-wide context.

## Acceptance Criteria

- [ ] Rows render side badges (call = positive styling, put = negative) with kind, contract, premium, sentiment, and confidence.
- [ ] The feed is labeled as a mock feed in the prototype (honest-data rule).

## Depends On

- None (fixture-driven). ADR-006, ADR-011.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/unusual-flow-feed/`.
