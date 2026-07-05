# Portfolio Overview

> Part of epic: [account-aggregation](../epics/account-aggregation.md)
> **Slug:** portfolio-overview

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The Overview screen's headline layer: stat tiles (total value, day P/L, unrealized P/L, harvestable losses with estimated benefit) and an asset-class allocation bar with legend and drift-vs-target badges, all scoped to the current account selection.

## Why

Satisfies account-aggregation AC 1 and AC 3 (allocation with drift badges) — the first-glance answer to "how am I doing, and am I off target?"

## Acceptance Criteria

- [ ] All four stat tiles re-derive when scope changes; deltas carry direction styling and sign.
- [ ] The allocation bar segments sum to 100% of scoped value and use the validated categorical palette with direct value labels.
- [ ] Drift badges appear only in consolidated scope and only at ≥3-point deviation from targets.
- [ ] The harvestable-losses tile's benefit note re-derives from the marginal-rate setting.

## Depends On

- [accounts-scope-rail](accounts-scope-rail.md) (scope state), [tlh-candidates-engine](tlh-candidates-engine.md) (harvestable figure).

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/portfolio-overview/`.
