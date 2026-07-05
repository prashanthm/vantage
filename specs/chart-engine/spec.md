# Chart Engine — Spec

> **Feature slug:** chart-engine
> Product doc: [initiatives/vantage/features/chart-engine.md](../../initiatives/vantage/features/chart-engine.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

AI Charts renders an SVG candlestick chart per symbol: seeded deterministic daily series ending exactly at the quoted price, volume subchart, labeled support/resistance dashed lines, 1M/3M/6M timeframes, y-grid, and a crosshair with date + OHLC tooltip.

## Acceptance Criteria

- [ ] Deterministic seeded series end at quote
- [ ] Volume subchart renders per bar
- [ ] S/R lines labeled and dashed
- [ ] Crosshair tooltip with OHLC
- [ ] Timeframe slicing 1M/3M/6M

## Out of Scope

- Intraday bars; drawing tools; real history.

## ADRs Applied

- ADR-006 (seeded)
- ADR-003 (hand-rolled SVG, no chart lib)
- ADR-004 (status colors)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
