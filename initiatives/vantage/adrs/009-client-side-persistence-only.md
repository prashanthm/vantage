# ADR-009: Client-side persistence only — localStorage, no auth in prototype

## Status

Accepted

## Context

The prototype needs user preferences (default scope, harvest thresholds, tax rate, notification prefs) to survive reloads, but has no backend (ADR-012) and stores no real account data (ADR-006 mock layer).

## Decision Drivers

1. The only mutable user state is preferences; a namespaced localStorage key (`vantage.settings.v1`) covers it with zero infrastructure.
2. No PII, credentials, or real positions exist in the prototype, so an auth system would protect nothing while adding the exact class of credential-handling risk the household tooling should avoid until necessary.
3. Versioned key + defaults-merge on load gives forward-compatible settings migration for free.
4. Rejected: **cookie/session backend** — requires the server ADR-012 defers. Rejected: **no persistence** — losing thresholds on every reload makes the Tax Center demo incoherent.

## Research & Rubric

No options weighed — charter decision for the prototype phase; superseded in scope by ADR-013 when live data arrives.

## Decision

All persistence is a single versioned localStorage key holding the settings object, merged over defaults at load, written on save, with try/catch tolerance for private-mode denial. No authentication, no server-side state, until the live-data phase.

## Consequences

### Becomes Easier

- Settings survive reloads with ~15 lines of code; nothing sensitive exists to breach.

### Becomes Harder

- Preferences are per-browser, not per-user; multi-device sync and real-data auth are wholesale additions later (ADR-013 scope).

## Applies To

- Settings and notifications specs; ADR-012, ADR-013.
