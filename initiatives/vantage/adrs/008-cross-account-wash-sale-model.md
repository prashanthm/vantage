# ADR-008: Cross-account wash-sale model — all accounts plus scheduled auto-buys

## Status

Accepted

## Context

The wash-sale rule (IRC §1091) disallows a loss when a substantially identical security is bought within 30 days either side of the sale — in **any** of the taxpayer's accounts, including IRAs (Rev. Rul. 2008-5). Single-account tools systematically miss cross-account washes; catching them is Vantage's core differentiator.

## Decision Drivers

1. Inherited semantics: sentinel `tlh_monitor.py` defines the reference model — per-lot marking, harvest thresholds, 30-day window, different-index partner map (VOO→VTI, IWM→IJR…), and `auto_buys` schedules.
2. The look-forward matters as much as the look-back: a scheduled monthly auto-invest inside the next 30 days washes a harvest just as surely as last week's DRIP — so `washStatus()` blocks on both `RECENT_BUYS` and `AUTO_BUYS`.
3. Substantially-identical families (VOO/SPY/IVV; QQQ/QQQM) must wash each other; near-identical-but-different-index pairs must NOT (that asymmetry is what makes partner replacement legal).
4. Tax-advantaged accounts can't harvest (status `N/A`) but their buys still trigger washes for taxable accounts — both directions are modeled.

## Research & Rubric

No options weighed — inherited decision (sentinel ADR-007/008 semantics + Rev. Rul. 2008-5); the family/partner tables are data, revisable without re-deciding.

## Decision

TLH candidacy is computed per lot across **all** linked accounts: blocked if any account bought a same-family symbol in the past 30 days or has a scheduled auto-buy within the next 30; replacements come from the different-index partner map; tax-advantaged lots are excluded as candidates but included as wash triggers. Output is decision-support only (Inherited: no order placement — ADR-010).

## Consequences

### Becomes Easier

- The flagship product claim ("we catch what single-account tools miss") is a tested pure function, not marketing.

### Becomes Harder

- The family and partner tables are maintained data — new holdings require curation, and "substantially identical" is a judgment the tables encode.

## Applies To

- Tax Center and Recommendations specs; options-income specs (assignment can trigger a wash); ADR-006, ADR-007, ADR-010.
