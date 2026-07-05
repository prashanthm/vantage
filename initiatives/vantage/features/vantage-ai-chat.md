# Vantage AI Chat

> Part of epic: [portfolio-insights](../epics/portfolio-insights.md)
> **Slug:** vantage-ai-chat

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The portfolio-aware assistant: a chat slide-over answering questions about harvesting, wash sales, overlap, allocation, and specific holdings with account-specific figures. Prototype phase uses keyword-matched canned responses with an explicit demo disclosure.

> **Status (Phase V4):** Mira integration implemented. When `aiBackend = "mira"` (default) the panel streams Mira's `/turn` SSE (plan steps + tokens) with a stable per-session thread id; the keyword-matched canned rules remain the automatic fallback whenever Mira is unreachable or errors (marked "offline — canned reply"), and `aiBackend = "off"` restores the pure canned demo.

## Why

Satisfies portfolio-insights AC 4 (chat answers cross-account questions with account-specific figures).

## Acceptance Criteria

- [x] Wash/TLH/overlap/allocation questions return answers naming actual accounts, positions, and dollar figures from the dataset.
- [x] Unmatched questions get a capability-listing fallback, never silence.
- [x] The panel discloses canned/demo status and the educational-only caveat.
- [x] Input and send use DS components; messages render with sender-distinct styling.
- [x] (V4) With Mira reachable, replies stream from `POST /turn` (SSE: plan steps + tokens); on error/unreachable the canned rule answers with an explicit offline hint — chat never goes silent.

## Depends On

- [recommendations-feed](recommendations-feed.md) (shared insight content). ADR-011.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/vantage-ai-chat/`.
