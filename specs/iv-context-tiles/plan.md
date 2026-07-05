# IV Context Tiles — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/options.jsx (tile grid)`
- `src/data.js (OPTIONS_CONTEXT)`
- `app.css (.vg-ivtile)`

## Implementation Steps

1. Fixture context per symbol
2. Tile grid with meters + badges
3. Navigation wiring

## ADRs Applied

- ADR-006
- ADR-011

## Edge Cases

- Symbols without chart params must not appear as tiles (navigation target must exist)
