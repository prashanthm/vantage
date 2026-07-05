# IV Context Tiles — Spec

> **Feature slug:** iv-context-tiles
> Product doc: [initiatives/vantage/features/iv-context-tiles.md](../../initiatives/vantage/features/iv-context-tiles.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

Options Intel opens with per-symbol tiles: IV rank badge + meter, expected move, put/call ratio; IV>=60 highlights rich premium; clicking a tile selects that symbol and navigates to AI Charts.

## Acceptance Criteria

- [ ] Tiles render rank/meter/move/PCR per symbol
- [ ] Threshold-based labels not color-alone
- [ ] Click-through to charts with symbol

## Out of Scope

- Real IV computation; term-structure detail.

## ADRs Applied

- ADR-006
- ADR-011

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
