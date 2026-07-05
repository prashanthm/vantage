# ADR-002: Trunk-based yolo delivery — short-lived branches, self-merge

## Status

Accepted

## Context

Kadence's delivery loop ships draft PRs that humans review and merge. Vantage's prototype phase has a single author who is also the reviewer; a mandatory PR gate adds latency without independent review actually occurring.

## Decision Drivers

1. Single author/operator — a PR review gate reviewed by its own author is ceremony, not quality control.
2. Preserving the *shape* of the discipline (feature branch → build → merge commit) keeps the door open to re-enable PR review without re-tooling when a second contributor or production stakes arrive.
3. Merge commits (`--no-ff`) keep feature boundaries visible in history for later archaeology.
4. Rejected: **direct commits to main** — loses feature boundaries and the ability to abandon a branch cleanly. Rejected: **full PR + review loop now** — no independent reviewer exists; the gate would be theater.

## Research & Rubric

No options weighed — charter decision for the prototype phase; revisit at live-data phase.

## Decision

Work happens on short-lived branches (`sdlc/*`, `feature/*`) merged to `main` by the author with `--no-ff` merge commits, no PR review required. The Ready-for-Dev gate and PR review re-enter when the live-data phase or a second contributor arrives.

## Consequences

### Becomes Easier

- Zero-latency shipping; the whole SDLC chain can run in one session.

### Becomes Harder

- No second pair of eyes — defects reach `main` unreviewed (mitigated by browser verification before merge).
- Re-introducing the gate later requires explicit discipline change, not just tooling.

## Applies To

- All feature work in this repo; supersedes nothing. ADR-001 (single repo) is the operating context.
