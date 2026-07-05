# Chart Engine

> Part of epic: [ai-charts](../epics/ai-charts.md)
> **Slug:** chart-engine

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The full-screen SVG candlestick chart: deterministic seeded daily series per symbol ending exactly at the quoted price, volume subchart, support/resistance level lines, 1M/3M/6M timeframes, y-grid with labels, and a crosshair with an OHLC + date tooltip.

## Why

Satisfies ai-charts AC 1 (candles + volume + crosshair across timeframes) and AC 5 (deterministic series) — the rendering substrate for markers and recommendations.

## Acceptance Criteria

- [ ] Every tracked symbol renders candles and volume at 1M/3M/6M; the final close equals the quoted price.
- [ ] Support/resistance render as labeled dashed lines in the up/down status colors.
- [ ] Mouse movement drives a crosshair and a tooltip with date and O/H/L/C; leaving the chart clears it.
- [ ] The same symbol always renders the identical series (seeded generation, frozen clock).

## Depends On

- None (foundation for the epic). ADR-006, ADR-003 (SVG, no chart library).

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/chart-engine/`.
