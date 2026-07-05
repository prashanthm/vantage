# IV Context Tiles

> Part of epic: [options-intelligence](../epics/options-intelligence.md)
> **Slug:** iv-context-tiles

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

Per-symbol options context tiles: IV rank with a meter, expected move to the next monthly expiry, and put/call ratio — with a rich-premium highlight at high IV rank and click-through to the AI Charts view for the same symbol.

## Why

Satisfies options-intelligence AC 4 (IV tiles link to charts) and teaches the sell-rich/buy-cheap framing that grounds the income screener.

## Acceptance Criteria

- [ ] Each tracked symbol renders a tile with IV rank meter, expected move, and P/C ratio.
- [ ] IV rank ≥60 carries a rich-premium highlight; ≥40 an intermediate one — with text labels, not color alone.
- [ ] Clicking a tile navigates to AI Charts with that symbol selected.

## Depends On

- [chart-engine](chart-engine.md) (navigation target). ADR-006.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/iv-context-tiles/`.
