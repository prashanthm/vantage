# Tax Intelligence

## Metadata

| Field | Value |
|-------|-------|
| **Slug** | tax-intelligence |
| **Initiative** | [../initiative.md](../initiative.md) |
| **Product brief** | [../product-brief.md](../product-brief.md) |
| **Owner** | prashanthm |

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## Problem

Tax-loss harvesting is the highest-certainty return enhancement available to taxable investors (+14–19 bps/yr in sentinel's research), but the wash-sale rule spans **all** of a taxpayer's accounts — including IRAs and scheduled auto-invests. Single-account tools (and every broker's own TLH view) systematically miss cross-account washes, silently voiding harvested losses.

## What We're Building

Vantage's Tax Center: every lot marked to the latest close, harvest candidates flagged by threshold, wash-sale windows computed across every linked account (look-back on actual buys, look-forward on scheduled auto-buys), replacement suggestions from the different-index partner map, and estimated after-tax benefit — as decision support only, never orders.

## Who It's For

Taxable-account investors who harvest losses themselves; anyone with a robo or DRIP that silently repurchases.

## Value

- Finds every harvestable loss and — uniquely — refuses the ones another account would wash.
- Converts a compliance trap (Rev. Rul. 2008-5) into an explained, dated, actionable status per lot.
- Quantifies the benefit at the user's marginal rate so harvests can be prioritized.

## Acceptance Criteria

- [ ] Every losing lot in a taxable account is classified: clear / wash-blocked (with reason + clear date) / below threshold; tax-advantaged lots are N/A but still act as wash triggers.
- [ ] A buy (or scheduled auto-buy) of a substantially identical security in ANY account blocks the harvest and names the offending account and transaction.
- [ ] Clear candidates show a different-index replacement or an explicit 31-day-wait instruction.
- [ ] Estimated benefit re-derives when the marginal tax rate setting changes.
- [ ] No code path places or stages an order (ADR-010).

## Features

| Feature | Slug | Description | Phase |
|---------|------|-------------|-------|
| TLH candidates engine | tlh-candidates-engine | Lot marking, thresholds, partner-map replacements, benefit estimates | Phase 1 — Core |
| Cross-account wash guard | cross-account-wash-guard | 30-day look-back/look-forward wash windows across all accounts | Phase 1 — Core |
| Tax Center view | tax-center-view | The per-lot status table + wash-sale education surface | Phase 1 — Core |

## Future Enhancements

- Realized gain/loss ledger and harvest history (after live data ships — needs transaction feeds).
- Spouse-account wash checking (after household grouping in account-aggregation).

## Additional Context

### Relevant ADRs

- [ADR-008](../adrs/008-cross-account-wash-sale-model.md) — the wash model this epic implements.
- [ADR-006](../adrs/006-deterministic-mock-data.md) — frozen clock keeps window fixtures stable.
- Inherited: Sentinel ADR-007/008 (decision-support only; sentinel TLH semantics).
