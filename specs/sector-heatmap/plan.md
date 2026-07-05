# Sector Heatmap — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/app.jsx (heatmap card, AnalysisModal)`
- `src/util.jsx (heatTint)`
- `src/data.js (SECTORS)`

## Implementation Steps

1. Fixture sector/stock moves
2. Tint function on diverging pair
3. Drill-in modal with holdings cross-ref

## ADRs Applied

- ADR-004 (validated palette)
- ADR-011

## Edge Cases

- |pct| < 0.15 renders neutral gray to avoid false polarity
