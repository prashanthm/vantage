# Notifications Center — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/app.jsx (NotifPanel, FAB)`
- `src/data.js (NOTIFICATIONS_SEED, NOTIF_TYPES)`
- `app.css (.vg-notif, .vg-fab)`

## Implementation Steps

1. Seed typed notifications
2. Render slide-over with unread state
3. Wire per-type prefs into settings persistence

## ADRs Applied

- ADR-009 (localStorage prefs)
- ADR-011

## Edge Cases

- All-muted state shows explanatory empty state, not a blank panel
