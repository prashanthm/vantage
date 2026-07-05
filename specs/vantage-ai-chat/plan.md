# Vantage AI Chat — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/app.jsx (ChatPanel)`
- `src/data.js (CHAT_RULES)`

## Implementation Steps

1. Author rule set with cross-account content
2. Render message list + input with auto-scroll
3. Add disclosure copy

## ADRs Applied

- ADR-011
- ADR-010 (chat never offers to execute)

## Edge Cases

- Empty input is a no-op; reply delay is cosmetic only
