# CodeGraph evaluation — 2026-07-20

Evaluated `@colbymchenry/codegraph` v1.4.1 as a local, token-efficient code map for
this repo (63 backend `.py` + 23 SPA `.jsx`, ~37k LOC). **Recommendation: KEEP** — it
delivers on every axis, installed cleanly and scoped, with a decisive token win.

## Authenticity / supply-chain check
- npm `@colbymchenry/codegraph@1.4.1`, maintainer `colbymchenry`, published 2026-07-10.
- **71k downloads/week, 387k/month; 61k GitHub stars; pushed 2026-07-20 (active).**
- Real, widely-used, actively-maintained package — supply-chain risk on the package
  itself is low.

## Install footprint (SCOPED — nothing global touched)
- Installed the CLI binary only: `npm i -g @colbymchenry/codegraph` (2 packages, on
  PATH at `~/.nvm/.../bin/codegraph`). **Deliberately did NOT run `codegraph install`**
  — that step edits GLOBAL config (`~/.claude/settings.json` auto-permissions,
  `.claude.json` MCP registration, injects a section into `CLAUDE.md`/`AGENTS.md`).
- **Verified byte-for-byte that global config is unchanged** (md5 before/after):
  `~/.claude/settings.json`, `~/.claude.json`, `AGENTS.md` — all identical. No MCP
  server registered, no CLAUDE.md injection.
- `codegraph init` wrote ONLY `.codegraph/codegraph.db` (20 MB SQLite) inside the repo
  — added to `.gitignore` (regenerable, not source).
- **Telemetry** was ON by default (anonymous, "no code/paths/names"); disabled it
  (`codegraph telemetry off`) — no phone-home for a private trading codebase.

## Index result
`183 files → 4,664 nodes, 14,182 edges in 2.0s.` Both languages parsed (Python + JSX).

## Query battery (all against KNOWN answers from recent work)
| Query | Result | Correct? |
|---|---|---|
| `query arm_scanner_spreads` | `scanner.py:405` + signature | ✓ |
| `callers settle_open` | signal_bot.poll:202, paper._run:808, +2 tests | ✓ (all 4) |
| `callers ScannerSpreadBook` (JSX) | HoldingsView (app.jsx:865) + PaperView (paper.jsx:41) | ✓ cross-file JSX resolved |
| `query scanner_reconcile` (route handler) | `api.py:1674` | ✓ |
| `callees tick` (deps) | load_paper_trades, order_status, set_broker_fill | ✓ real reconcile-loop calls |
| `impact htf_setup` | fn + its 2 tests (blast radius) | ✓ |
| `explore "scanner spread lifecycle"` | 47 symbols, blast radius, dynamic-dispatch/render links, missing-test flags | ✓ rich, grep-impossible |

## Token win
`query arm_scanner_spreads` = **4 lines** vs reading `scanner.py` = **528 lines**
(~130x). `explore` returns a few dozen lines of synthesized call-flow + blast radius
that would otherwise take several full-file reads. Matches the vendor's benchmarked
40–81% tool-call reduction.

## What it does that the homegrown stdlib map could NOT
- Reliable **call-graph** (`callers`/`callees`/`impact`) — the homegrown plan deferred
  this (jedi imperfect). CodeGraph resolves it, incl. JSX render/dispatch links.
- **Auto-sync** via a file watcher (`codegraph sync`/`daemon`) — no manual re-index.
- Missing-test-coverage flags in `explore`.

## How to use (CLI only — no MCP, no global install)
```
codegraph query <name>         # locate a symbol/route + signature
codegraph callers <symbol>     # who calls it
codegraph callees <symbol>     # what it calls
codegraph impact <symbol>      # blast radius before editing
codegraph explore "<phrase>"   # semantic context + call flow + blast radius
codegraph node <symbol|file>   # source + callers for one symbol
codegraph sync                 # re-index after changes (or codegraph index --force)
```
Run from the repo root (reads `.codegraph/codegraph.db`).

## Follow-ups (separate approval)
- Add a one-line pointer in `AGENTS.md` so new sessions know the tool + commands exist.
- Optionally hook `codegraph sync` into a git hook / `build.sh` to auto-refresh.
- Left OFF by choice: `codegraph install` (global MCP wiring) and the MCP server —
  CLI-only keeps it a pure local-file tool.
