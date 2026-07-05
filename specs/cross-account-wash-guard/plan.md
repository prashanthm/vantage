# Cross-Account Wash Guard — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/util.jsx (washFamily, washStatus)`
- `src/data.js (WASH_FAMILIES, RECENT_BUYS, AUTO_BUYS, WASH_WINDOW_DAYS)`

## Implementation Steps

1. Resolve the symbol's substantially-identical family
2. Scan recent buys across accounts within the window
3. Scan scheduled auto-buys for look-forward conflicts
4. Return blocked status with human-readable reason

## ADRs Applied

- ADR-008 (the model this implements)
- ADR-006 (deterministic dates)

## Edge Cases

- IRA/401(k) buys block taxable harvests (Rev. Rul. 2008-5) though those accounts cannot harvest
- A future auto-buy blocks even with no past buy
