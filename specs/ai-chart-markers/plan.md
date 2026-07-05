# AI Chart Markers — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/charts.jsx (marker layer, legend, timeline)`
- `src/data.js (CHART_MARKERS)`

## Implementation Steps

1. Anchor markers by bars-from-end into generated series
2. Glyph render per type + AI tag
3. Legend + timeline chips

## ADRs Applied

- ADR-006 (stable anchoring)
- ADR-011

## Edge Cases

- Markers outside the visible timeframe slice simply don't render (no crash)
- Timeline uses full-series dates regardless of slice
