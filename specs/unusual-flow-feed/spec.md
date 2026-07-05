# Unusual Flow Feed — Spec

> **Feature slug:** unusual-flow-feed
> Product doc: [initiatives/vantage/features/unusual-flow-feed.md](../../initiatives/vantage/features/unusual-flow-feed.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

A table of large options prints: ticker+time, side/kind badge (CALL/PUT x Sweep/Block/Ladder/Spread), contract, premium, sentiment read, confidence; explicitly labeled a mock feed.

## Acceptance Criteria

- [ ] Side badges styled by polarity
- [ ] Mock-feed label present

## Out of Scope

- Live flow data; filtering.

## ADRs Applied

- ADR-006
- ADR-011

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
