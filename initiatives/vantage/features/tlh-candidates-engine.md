# TLH Candidates Engine

> Part of epic: [tax-intelligence](../epics/tax-intelligence.md)
> **Slug:** tlh-candidates-engine

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The pure-function tax engine: marks every lot to the latest close, classifies losing lots against the user's harvest thresholds ($ and %), excludes tax-advantaged accounts as candidates, suggests replacements from the different-index partner map, and estimates after-tax benefit at the user's marginal rate.

## Why

Satisfies tax-intelligence AC 1 (per-lot classification), AC 3 (replacements), and AC 4 (benefit re-derives with rate) — the computational core of the epic.

## Acceptance Criteria

- [ ] Every losing lot is classified exactly one of: clear / blocked / below-threshold / N-A-tax-advantaged.
- [ ] Threshold changes in Settings immediately reclassify lots (no reload).
- [ ] Clear candidates with a partner-map entry name the replacement; single stocks without one get the 31-day-wait instruction.
- [ ] Estimated benefit equals harvestable loss × marginal rate and updates when either changes.

## Depends On

- [accounts-scope-rail](accounts-scope-rail.md) (lots model). ADR-008 (model), Inherited: Sentinel ADR-007/008.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/tlh-candidates-engine/`.
