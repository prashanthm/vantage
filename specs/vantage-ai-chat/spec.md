# Vantage AI Chat — Spec

> **Feature slug:** vantage-ai-chat
> Product doc: [initiatives/vantage/features/vantage-ai-chat.md](../../initiatives/vantage/features/vantage-ai-chat.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

A chat slide-over ('Vantage AI') answers portfolio questions with account-specific figures via keyword-matched canned rules, always falls back to a capability listing, and discloses demo/educational status.

> **Phase V4 update:** the Mira LLM backend is now wired in (`src/live.js` `streamTurn`:
> POST `{miraUrl}/turn` parsed as SSE over `fetch` + `ReadableStream`). `settings.aiBackend`
> ("mira" default | "off") selects the mode; the canned rules above are retained verbatim as the
> offline fallback, so all original AC keep holding with both services down.

## Acceptance Criteria

- [x] Wash/TLH/overlap/allocation rules answer with real dataset figures
- [x] Catch-all fallback exists
- [x] Demo + educational disclosure in panel
- [x] DS FormField + Button compose the input row
- [x] (V4) `aiBackend="mira"`: send streams plan_step events as a thinking sequence and accumulates token text into the reply bubble; stable per-session `thread_id`
- [x] (V4) Mira error/unreachable → canned rule reply with "offline — canned reply" hint; `aiBackend="off"` → original behavior unchanged

## Out of Scope

- ~~Real LLM backend (future: Mira framework).~~ Implemented in Phase V4 (canned fallback retained).

## ADRs Applied

- ADR-011
- ADR-010 (chat never offers to execute)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
