# ADR-005: Hash-routed sidebar views, one job per screen

## Status

Accepted

## Context

v1 rendered the whole product as one long scroll, which stopped scaling past ~5 modules. Fintech dashboards of this scope (Fortune 6, Empower/Schwab-class aggregators) converge on a persistent left navigation over dedicated views, with global context pinned.

## Decision Drivers

1. One job per screen: each view (Overview, Holdings, Tax Center, Recommendations, Market Intel, Options Intel, AI Charts) answers one question; the long scroll buried the Tax Center — the differentiator — below four screens of content.
2. Deep-linkability: `#/tax`, `#/charts` must be shareable/bookmarkable without a server or router dependency (ADR-003 buildless constraint → hash routing, not history API, which needs server rewrites).
3. Account scope is global state — it belongs in the persistent sidebar, not per-view controls.
4. Rejected: **single long scroll with anchors** — proven unusable at 7 modules. Rejected: **history-API router (react-router)** — needs a server rewrite rule and a dependency; hash routing is 20 lines.

## Research & Rubric

No options weighed — pattern inherited from industry reference products; constraints from ADR-003.

## Decision

Navigation is a persistent left sidebar with two groups (Portfolio: overview/holdings/tax/recs; Intelligence: markets/options/charts) over hash-routed views (`#/<route>`), account scope pinned in the sidebar, implemented as a ~20-line `useHashRoute` hook.

## Consequences

### Becomes Easier

- Views grow independently; a new view is a nav row + a component.
- Every screen is deep-linkable with zero server config.

### Becomes Harder

- No nested/param routes without growing the hand-rolled router.
- Cross-view state (selected symbol, scope) must be lifted to the shell by hand.

## Applies To

- The SPA shell spec and every view feature; ADR-003, ADR-004.
