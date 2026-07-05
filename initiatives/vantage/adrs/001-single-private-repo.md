# ADR-001: Single private repo for code, product docs, and specs

## Status

Accepted

## Context

Kadence's default topology splits governance (product-workspace) from code repos. Vantage is a solo prototype: one builder, one deliverable, no cross-team governance graph. The initiative needs a home for code, product-layer markdown (`initiatives/vantage/`), and engineering specs (`specs/`) with minimal coordination overhead.

## Decision Drivers

1. Solo project — the governance/code split buys traceability across teams that don't exist here, at the cost of two repos to keep in sync.
2. Feature issues must live where the build loop runs (`Closes #N` same-repo) — with one repo, epic and feature issues can co-locate without cross-repo references.
3. The prototype is private household-finance tooling; a private repo under the personal account is the natural trust boundary.
4. Rejected: **product-workspace + code repo split** — two-repo ceremony with zero second consumer. Rejected: **docs-only repo later** — splitting after the fact is cheap if the layout already mirrors kadence conventions.

## Research & Rubric

No options weighed — charter decision (kadence single-repo variant for solo initiatives).

## Decision

All Vantage artifacts — SPA code, `initiatives/vantage/` product layer, `initiatives/vantage/adrs/`, and `specs/<feature-slug>/` — live in the single private GitHub repo `prashanthm/vantage`. Epic and feature issues both live in this repo.

## Consequences

### Becomes Easier

- One clone, one issue tracker, one board; same-repo `Closes #N` everywhere.
- Docs and code move in the same commit — specs can't drift from the code they describe.

### Becomes Harder

- If Vantage ever joins a multi-product governance workspace, epics/ADR issues must be migrated out.
- Repo mixes concerns; contributors must read AGENTS.md routing to navigate.

## Applies To

- All epics and features of the vantage initiative; ADR-002 (branching) operates within this repo.
