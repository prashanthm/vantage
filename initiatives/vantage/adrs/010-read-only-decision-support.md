# ADR-010: Read-only decision support — no order or fund-movement code paths

## Status

Accepted

## Context

The portfolio-wide operating principle (mission + sentinel ADR-011/012 lineage) is a hard separation between analysis surfaces and anything that moves money. Vantage aggregates the household's whole financial picture — the blast radius of an execution bug or a hijacked surface would be maximal.

## Decision Drivers

1. Mission constraint: analysis/observation surfaces never mutate financial state; execution remains a human at their broker.
2. Regulatory posture: a tool that recommends but never executes stays decision-support; adding execution changes the compliance surface entirely (and would contradict ADR-011's educational-only banner).
3. Absence of code paths beats configuration: there is no broker-write integration to toggle, so no misconfiguration can place an order.
4. Rejected: **"paper trading" execution simulation** — normalizes an execution surface that policy forbids. Rejected: **broker deep-links pre-filling orders** — a gray zone deferred; if ever added it requires superseding this ADR.

## Research & Rubric

No options weighed — inherited/charter decision (portfolio-wide separation principle).

## Decision

Vantage contains no code that places orders, transfers funds, or writes to any broker or financial account. Aggregation is read-only. Every roadmap item that would breach this requires superseding this ADR first.

## Consequences

### Becomes Easier

- Trust boundary is auditable by inspection ("no execution code exists"), not by configuration review.

### Becomes Harder

- The product can never close the loop from recommendation to one-click action; users copy actions to their broker manually.

## Applies To

- Every feature and spec in the initiative; ADR-008 (TLH is advisory), ADR-011 (banner).
