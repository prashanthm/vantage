# Tax Center View — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/app.jsx (TaxView, nav dot)`
- `app.css (.vg-badge, .vg-navdot)`

## Implementation Steps

1. Render engine output as table
2. Inline wash reasons + remediation hints
3. Wire FAQ expander and nav indicator

## ADRs Applied

- ADR-010
- ADR-011
- ADR-005 (dedicated view)

## Edge Cases

- 'Below threshold' and 'N/A' rows render as monitors, not actions
