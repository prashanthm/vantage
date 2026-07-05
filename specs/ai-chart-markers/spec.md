# AI Chart Markers — Spec

> **Feature slug:** ai-chart-markers
> Product doc: [initiatives/vantage/features/ai-chart-markers.md](../../initiatives/vantage/features/ai-chart-markers.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

Typed AI markers render on the chart at anchored bars: buy triangles below lows, sell triangles above highs, note dots; a legend names each type; marked bars add the label to the tooltip; a dated chip timeline lists all markers.

## Acceptance Criteria

- [ ] Three marker glyph types render
- [ ] Legend always visible
- [ ] Tooltip includes marker label
- [ ] Dated timeline chips

## Out of Scope

- User-authored annotations; marker editing.

## ADRs Applied

- ADR-006 (stable anchoring)
- ADR-011

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
