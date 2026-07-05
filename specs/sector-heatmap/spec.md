# Sector Heatmap — Spec

> **Feature slug:** sector-heatmap
> Product doc: [initiatives/vantage/features/sector-heatmap.md](../../initiatives/vantage/features/sector-heatmap.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

Eleven GICS sector cards with aggregate change and per-stock tiles tinted on the validated red-green diverging scale with signed % text; near-flat is neutral; clicking a tile opens an analysis modal that cross-references holdings.

## Acceptance Criteria

- [ ] 11 sectors with aggregates
- [ ] Tint scales with |move|, neutral near flat
- [ ] Signed % text on every tile (not color-alone)
- [ ] Modal states holding accounts or Not held

## Out of Scope

- Nasdaq-100 toggle; live sector data.

## ADRs Applied

- ADR-004 (validated palette)
- ADR-011

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
