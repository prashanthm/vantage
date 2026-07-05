# Options Intelligence

## Metadata

| Field | Value |
|-------|-------|
| **Slug** | options-intelligence |
| **Initiative** | [../initiative.md](../initiative.md) |
| **Product brief** | [../product-brief.md](../product-brief.md) |
| **Owner** | prashanthm |

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## Problem

Options scanners show the whole market's chains; none answer the question that matters to a holder: *what income can MY positions generate, in WHICH account, without breaking my tax plan?* Covered calls need 100-share lots in an account that permits options; assignment can wash a planned harvest — connections no generic scanner makes.

## What We're Building

The Options Intel view: IV context tiles per symbol (IV rank, expected move, put/call ratio), an income-ideas screener that scans the user's actual holdings and idle cash per account for covered-call and cash-secured-put candidates (with eligibility, approval-level, and TLH-conflict annotations), and an unusual-options-activity feed.

## Who It's For

Holders who sell (or want to learn to sell) premium against their own book; flow-watchers.

## Value

- Income ideas are executable *by this user in that account* — eligibility and approval levels are part of the screen, not fine print.
- TLH cross-checks prevent an options trade from silently voiding a planned harvest.
- IV context teaches the sell-rich/buy-cheap discipline with the user's own names.

## Acceptance Criteria

- [ ] Every income idea names its backing (shares + account or cash + account), contract, delta, premium, and annualized yield; ineligible-but-close positions are shown with what's missing.
- [ ] Ideas in accounts that likely disallow options carry an explicit caveat.
- [ ] At least one surfaced cross-check ties options activity to the Tax Center (assignment-wash warning).
- [ ] IV tiles link through to the AI Charts view for the same symbol.

## Features

| Feature | Slug | Description | Phase |
|---------|------|-------------|-------|
| IV context tiles | iv-context-tiles | IV rank / expected move / P-C ratio per symbol | Phase 2 — Intelligence |
| Income ideas screener | income-ideas-screener | CC/CSP ideas from actual holdings + cash per account | Phase 2 — Intelligence |
| Unusual flow feed | unusual-flow-feed | Large prints & sweeps table with sentiment reads | Phase 2 — Intelligence |

## Future Enhancements

- Real chains and greeks (live-data phase, ADR-013).
- Strategy scanners (condor/strangle tiles, Fortune 6 parity) — only after real chains exist.

## Additional Context

### Relevant ADRs

- [ADR-008](../adrs/008-cross-account-wash-sale-model.md) — assignment-wash cross-checks consume the same engine.
- [ADR-010](../adrs/010-read-only-decision-support.md) — ideas are never staged as orders.
