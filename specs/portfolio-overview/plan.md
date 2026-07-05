# Portfolio Overview — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/app.jsx (OverviewView, StatTile usage)`
- `src/util.jsx (allocation, StatTile)`
- `src/data.js (ALLOCATION_TARGETS, ASSET_CLASSES)`

## Implementation Steps

1. Compute allocation by asset class from scoped lots
2. Render stat tiles from positions + TLH engine outputs
3. Render segmented allocation bar + legend with drift badges

## ADRs Applied

- ADR-007 (derived)
- ADR-004 (palette discipline)

## Edge Cases

- Division by zero when scoped value is 0
- Drift badges suppressed in single-account scope (targets are portfolio-level)
