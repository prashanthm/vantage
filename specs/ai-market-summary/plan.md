# AI Market Summary — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/app.jsx (MarketsView)`
- `src/data.js (AI_INSIGHTS, AI_PICKS)`

## Implementation Steps

1. Author per-symbol insight fixtures
2. Render pills + bias + meters + summary
3. Render picks with click-through

## ADRs Applied

- ADR-006 (fixtures)
- ADR-011

## Edge Cases

- Picks without an insight entry do not navigate
