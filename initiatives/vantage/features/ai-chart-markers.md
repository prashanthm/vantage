# AI Chart Markers

> Part of epic: [ai-charts](../epics/ai-charts.md)
> **Slug:** ai-chart-markers

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The AI annotation layer on the chart: typed marker glyphs anchored to bars (buy/accumulation triangles, sell/distribution triangles, note dots — including TLH-window events on owned lots), a legend, marker text in the crosshair tooltip, and a dated marker-timeline chip row under the chart.

## Why

Satisfies ai-charts AC 2 (typed glyphs, legend, dated timeline, never color-only) — the layer that makes the chart "AI-enabled".

## Acceptance Criteria

- [ ] Markers render as distinct glyph shapes per type with an always-visible legend; type is never conveyed by color alone.
- [ ] Hovering a marked bar shows the marker's full label in the tooltip.
- [ ] The timeline chips list every marker with its actual bar date and label.
- [ ] Markers anchor to stable bar indices across re-renders (deterministic series).

## Depends On

- [chart-engine](chart-engine.md). ADR-006.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/ai-chart-markers/`.
