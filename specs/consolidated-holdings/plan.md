# Consolidated Holdings — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/util.jsx (positions, overlapFor)`
- `src/app.jsx (HoldingsView)`
- `src/data.js (OVERLAP_GROUPS)`

## Implementation Steps

1. Group scoped lots by symbol; derive value/cost/unrl/weight
2. Compute overlap over the FULL portfolio regardless of scope
3. Render expandable table with badges

## ADRs Applied

- ADR-007 (pure derivation)
- ADR-005 (dedicated view)

## Edge Cases

- CASH pseudo-position renders without P/L columns
- Overlap computed portfolio-wide even when scoped (it is a cross-account property)
