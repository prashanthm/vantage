# Portfolio Insights

## Metadata

| Field | Value |
|-------|-------|
| **Slug** | portfolio-insights |
| **Initiative** | [../initiative.md](../initiative.md) |
| **Product brief** | [../product-brief.md](../product-brief.md) |
| **Owner** | prashanthm |

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## Problem

Cross-account data without interpretation is just a bigger spreadsheet. The risks that actually cost money — duplicated exposure held three ways, allocation drift, concentration, idle cash, wash conflicts — need to be *surfaced, ranked, and explained*, and reach the user even when they aren't looking at the dashboard.

## What We're Building

The insight layer: a ranked recommendations feed (harvest, pause-auto-buy, consolidate overlap, rebalance-by-contribution, cash drag, concentration) with rationale on every card; a notifications center unifying all alert types with read state and per-type preferences; and a portfolio-aware AI chat that answers questions across all linked accounts.

## Who It's For

The same multi-account investor — in their role as decision-maker rather than data-reader.

## Value

- Every insight is cross-account-computed and explained — users learn *why*, not just *what*.
- Notifications make the product useful between visits; preferences keep it non-spammy.
- Recommendations never contradict the Tax Center (single wash-sale source of truth).

## Acceptance Criteria

- [ ] Recommendations render as ranked cards, each naming the accounts involved and the estimated annual impact where quantifiable.
- [ ] No recommendation conflicts with Tax Center wash status (shared engine, not duplicated logic).
- [ ] Notifications support unread state, mark-read, mark-all-read, and per-type mute persisted in settings.
- [ ] Chat answers harvest/wash/overlap/allocation questions with account-specific figures.

## Features

| Feature | Slug | Description | Phase |
|---------|------|-------------|-------|
| Recommendations feed | recommendations-feed | Ranked, explained cross-account action cards | Phase 1 — Core |
| Notifications center | notifications-center | Unified alert inbox + per-type preferences | Phase 1 — Core |
| Vantage AI chat | vantage-ai-chat | Portfolio-aware assistant (canned in prototype) | Phase 1 — Core |

## Future Enhancements

- Real LLM behind the chat (post-prototype; likely the Mira framework) — canned rules until then.
- Push/email delivery for notifications (needs the ADR-013 backend).

## Additional Context

### Relevant ADRs

- [ADR-008](../adrs/008-cross-account-wash-sale-model.md) — recommendations must consume, not re-implement, wash status.
- [ADR-009](../adrs/009-client-side-persistence-only.md) — notification prefs persist in localStorage.
- [ADR-011](../adrs/011-compliance-banner.md) — every insight surface is educational-only.
