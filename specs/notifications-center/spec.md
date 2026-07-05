# Notifications Center — Spec

> **Feature slug:** notifications-center
> Product doc: [initiatives/vantage/features/notifications-center.md](../../initiatives/vantage/features/notifications-center.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

A bell FAB with unread count opens a slide-over inbox of typed notifications with unread highlighting, mark-read on click, mark-all-read, and per-type checkboxes that mute types and persist in settings.

## Acceptance Criteria

- [ ] Unread badge counts only unmuted types
- [ ] Click marks read; mark-all-read works
- [ ] Per-type mute persists via settings save
- [ ] Typed rendering with icon/label/time

## Out of Scope

- Push/email delivery; server-generated notifications.

## ADRs Applied

- ADR-009 (localStorage prefs)
- ADR-011

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
