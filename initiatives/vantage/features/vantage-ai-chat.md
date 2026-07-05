# Vantage AI Chat

> Part of epic: [portfolio-insights](../epics/portfolio-insights.md)
> **Slug:** vantage-ai-chat

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The portfolio-aware assistant: a chat slide-over answering questions about harvesting, wash sales, overlap, allocation, and specific holdings with account-specific figures. Prototype phase uses keyword-matched canned responses with an explicit demo disclosure; a real LLM (Mira framework) is a future enhancement.

## Why

Satisfies portfolio-insights AC 4 (chat answers cross-account questions with account-specific figures).

## Acceptance Criteria

- [ ] Wash/TLH/overlap/allocation questions return answers naming actual accounts, positions, and dollar figures from the dataset.
- [ ] Unmatched questions get a capability-listing fallback, never silence.
- [ ] The panel discloses canned/demo status and the educational-only caveat.
- [ ] Input and send use DS components; messages render with sender-distinct styling.

## Depends On

- [recommendations-feed](recommendations-feed.md) (shared insight content). ADR-011.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/vantage-ai-chat/`.
