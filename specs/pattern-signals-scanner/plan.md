# Pattern Signals Scanner — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/app.jsx (MarketsView signals card)`
- `src/data.js (SIGNALS)`

## Implementation Steps

1. Fixture signals with mixed statuses
2. Tabbed filter render with badges

## ADRs Applied

- ADR-006
- ADR-011

## Edge Cases

- No active signals renders an empty-but-labeled table, not a hidden card
