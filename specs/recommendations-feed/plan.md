# Recommendations Feed — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/app.jsx (RecsView, OverviewView top-actions)`

## Implementation Steps

1. Author card set from cross-account analyses
2. Bind quantifiable figures to settings
3. Surface top-2 on Overview

## ADRs Applied

- ADR-011
- ADR-008 (consumes, never re-implements wash logic)

## Edge Cases

- Cards must never contradict Tax Center statuses (single engine rule)
