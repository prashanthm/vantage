# Notifications Center

> Part of epic: [portfolio-insights](../epics/portfolio-insights.md)
> **Slug:** notifications-center

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The unified alert inbox: a bell with unread count, a slide-over listing typed notifications (TLH, wash-sale, price/AI, drift, account sync) with unread state, mark-read and mark-all-read, and per-type mute preferences persisted with the user's settings.

## Why

Satisfies portfolio-insights AC 3 (unread state, mark-read, per-type mute persisted).

## Acceptance Criteria

- [ ] The unread badge counts only notifications of unmuted types; it updates on read and on preference change.
- [ ] Clicking a notification marks it read; mark-all-read clears all.
- [ ] Muting a type hides its notifications and persists across reload (localStorage settings).
- [ ] Each notification shows type icon, label, body, and time.

## Depends On

- [accounts-scope-rail](accounts-scope-rail.md) (settings plumbing). ADR-009.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/notifications-center/`.
