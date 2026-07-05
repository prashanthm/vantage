# Chart Recommendation Panel — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/charts.jsx (right panel)`
- `src/data.js (CHART_RECS)`
- `app.css (.vg-reccard)`

## Implementation Steps

1. Aggregate held lots for the symbol across accounts
2. Draw avg-cost line + panel detail
3. Author portfolio-aware rec fixtures + render card

## ADRs Applied

- ADR-008 (tax-date-aware recs)
- ADR-011
- ADR-010

## Edge Cases

- Symbols with insight but no rec render read-only panel gracefully
