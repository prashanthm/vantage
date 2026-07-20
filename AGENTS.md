# Vantage — Agent Guide

Single-repo project: the code (static SPA + Python backend), the product layer
(`initiatives/vantage/`), and the engineering layer (`specs/<feature-slug>/`) all live
here. Kadence (ai-sdlc-toolkit) conventions apply: durable intent in markdown, status in
GitHub, one feature → one branch → one merge.

## Navigate with the code graph (do this before grepping)

This repo is indexed by **CodeGraph** — a local SQLite symbol/call graph
(`.codegraph/`, gitignored). To locate code, prefer these over `grep`/reading whole
files (they return a few lines instead of a 500-line file — much cheaper):

```
codegraph query <name>        # where a symbol/route/file is defined + its signature
codegraph callers <symbol>    # who calls it
codegraph callees <symbol>    # what it calls (a function's dependencies)
codegraph impact <symbol>     # blast radius before editing (what breaks)
codegraph explore "<phrase>"  # semantic context: relevant symbols + call flow + blast radius
codegraph node <symbol|file>  # one symbol's source + callers, or read a file
```

Run from the repo root. It resolves both Python and JSX (incl. cross-file component
usage). CLI-only — no MCP server. If a query returns nothing, the graph may be stale:
`codegraph sync` (a git hook auto-syncs on commit); full rebuild is `codegraph index
--force`. Fall back to grep/Read only when the graph can't answer. Eval + full command
notes: `tools/codegraph-eval.md`.

## Doctrine (never violate)

- **Read-only decision support (ADR-010): no order placement, no fund movement, ever.**
  Every write path touches only our own SQLite store or local files — never a broker,
  never a fund-moving endpoint. New POST routes must be added to the write allow-list in
  `server/tests/test_api.py` (`ALLOWED_WRITE_ROUTES`) and justified as store-only.
- **Context, not a signal.** The playbooks/analyses are decision-support for reading the
  tape or reviewing trades — not buy/sell signals. Surfaces carry this caveat + "not
  financial advice". Don't fabricate numbers; when data is incomplete, say so.
- ADRs are authoritative: `initiatives/vantage/adrs/` (001–015; 015 = the Alpaca autonomous
  order carve-out). Read the relevant one before changing architecture.

## External data sources

Vantage consumes read-only market data (quotes/bars) via `quotes.py`/`bars*.py` (yfinance).
**Sentinel is RETIRED** — the old `sentinel_bridge.py` market-context shim now delegates to
the native `market_context.py` (breadth / VIX term structure / sector rotation / intermarket,
computed from stored bars + a live yfinance fetch). Vantage owns its own market read now.

## Execution: paper on Alpaca (ADR-015)

Beyond the read-only doctrine, there is ONE sanctioned order surface — Alpaca (paper by
default). `brokers/alpaca_execution.py` places multi-leg (`mleg`) orders; `alpaca_broker.py`
reads positions/account/order-status. **Paper is NOT gated** (different account/URL, no real
money): `submit_strategy_order(..., paper=True)` submits when `is_paper()` without the live
gates; a paper request to the LIVE endpoint hard-refuses. **Live** requires all four ADR-015
gates (`VANTAGE_LIVE_OK` + `VANTAGE_AUTONOMOUS_OK` + kill-switch + per-strategy caps) — never
arm those in an agent session; the operator owns them. Alpaca order routes are allow-listed
in `test_api.py` like every other write route.

## Architecture

Docker Compose stack (`deploy/docker-compose.yml`), 4 services + 1 volume:

| Service | Port | Role |
|---------|------|------|
| `vantage-backend` | :8641 | FastAPI; owns `vantage.db` (READ-WRITE volume `vantage-data`); refresh + recompute writes |
| `vantage-mcp` | :8640 | MCP tool surface; reads the SAME db READ-ONLY |
| `vantage-spa` | :8642 | static SPA shell (nginx); browser talks to host-published ports |
| `mira` | :8080 | AI advisor → `vantage-mcp:8640/mcp` (tools) + host Ollama (LLM) |

- **Backend** (`server/vantage_server/`): `api.py` (routes), `store.py` + `db.py`
  (SQLite, dual JSON/SQLite backend), `importer.py` (broker CSV ingest), `spx_playbook.py`
  + `playbook_pine.py` (0DTE playbook + Pine export), `futures.py` (AMP futures analysis),
  `ml/` (roundtrips + Bayesian win-rate buckets), `sentinel_bridge.py`, `refresh.py`,
  `quotes.py`, `bars*.py`.
- **SPA** (`src/*.jsx` → `app.js`): buildless — esbuild bundles `src/app.jsx` into
  `app.js` (ADR-003). Uses the Lookey design system (`window.LookeyDS.*` + CSS tokens
  only). Hash-routed sidebar views (ADR-005), one job per screen.
- **Pine artifacts** (`pine/`): `spx_playbook.pine` (generated from the scaffold, has GEX)
  + `playbook_levels_standalone.pine` (self-contained, any-symbol, VWAP regime, no GEX).
  These ARE the source of truth — edit them here, never keep copies elsewhere.

## Build / run / deploy

- **SPA build**: `./build.sh` (esbuild `src/app.jsx` → `app.js`). MUST run before an SPA
  docker rebuild, or `src/` edits won't ship (the image copies `app.js`, not `src/`).
- **Backend/SPA code is BAKED into images** (no source bind-mount). On-disk edits go live
  only after: `cd deploy && docker compose build <svc> && docker compose up -d <svc>`.
  Wait for `docker inspect --format '{{.State.Health.Status}}'` == healthy.
- **Tests**: `cd server && VANTAGE_QUOTES=fixture .venv/bin/python -m pytest -q`. The
  fixture dataset lives in `server/tests/fixtures/`; real data lives in `data-local/`
  (gitignored, SQLite-backed).
- **Data dirs**: `resolve_data_dir` picks explicit `--data-dir` > `VANTAGE_DATA_DIR` env >
  `data-local`. The running container uses the docker `vantage-data` volume — NOT the host
  `data-local/` or `data/`. To load host CSVs into the container: `docker cp <path>
  vantage-vantage-backend-1:/data/<subdir>` then run the import inside the container.

## Store / schema conventions

- `db.py`: one `_SCHEMA` string, `CREATE TABLE IF NOT EXISTS`, bump `SCHEMA_VERSION` with a
  comment; `init_schema` migrates idempotently on connect (no separate migration files).
- Store writes: guard `if not self.uses_sqlite: raise`, use `with self._sqlite_txn() as
  conn`, `INSERT OR REPLACE` on a natural key (idempotent), return a count. Reads use
  `self._backend._conn()`; JSON columns via `_db.dumps`/`_db.loads`. Mirror `record_levels`
  / `load_level_history` for new tables.

## Feature notes (recent, non-obvious)

- **Scanner → paper-spread lifecycle** (the big recent build): the ICT hourly scanner
  (`ict_htf.py` detector, `scanner.py` universe run) grades A+ by FVG SIZE (≥0.7 ATR;
  thin <0.3 suppressed) with an ATR-floored stop and a validated exit ladder; setups are
  backtested (`claudedocs/research/scanner-*.md`). Each A+ setup auto-logs a debit spread
  and, when Alpaca-paper creds exist, SUBMITS a real mleg order (`arm_scanner_spreads` →
  `scanner_spread.alpaca_order`). `scanner_exec.py` (a `tick`/`run_loop` clone of
  `execution_monitor`) poll-reconciles fills + closes on the invalidation (stop-loss) or
  target; sidecar = `deploy/scanner-exec-loop.sh` + plist → `POST /api/scanner/reconcile`.
  Ledger = `paper_trades` (v25 cols: book/broker/entry_order_id/…). No creds → yfinance sim
  fallback (`paper.settle_open`). Book shows on the Positions page + Strategies→Track record.
  **The Pine chart (`coach_pine.py`) MIRRORS the ict_htf grade+floor** (same constants) so a
  scanner setup is verifiable on TradingView — change one, change both.
- **Strategies UI** = the pipeline only: Lifecycle (stage machine + promote gate) + Track
  record (paper performance). Signal Bot + Live book tabs were retired (legacy reclaim/
  Robinhood; backends still run, unlinked).

- **0DTE SPX playbook**: `spx_playbook.build_playbook(today, store=)` fuses Sentinel GEX +
  chart dims + durable-level memory (`level_history` table, schema v3) into a scaffold;
  `playbook_pine.build_playbook_pine` renders the Pine indicator. GEX comes from Sentinel's
  `yfinance` option-chain snapshot and is 0DTE-blind + can't be back-seeded (accrues
  forward). Refresh chain: Sentinel `python cli.py gex` → Vantage `POST /api/spx/playbook/
  recompute` → **bust Mira's cache** `GET :8080/playbook?refresh=1` (Mira caches the
  narrated playbook in-memory with NO TTL; the UI prefers Mira, so a recompute alone leaves
  the UI stale). The SPA "Recompute" button now passes `refresh=1`.
- **Futures analysis** (`futures.py`, schema v4): ingests AMP/CQG CSVs
  (`data/ampfutures/`), stores fills (PK = Order ID), derives round-trips + win-rate on
  read (reusing `ml/buckets.py`), reconciles vs the broker's realized PnL and flags partial
  (windowed) exports. CLI `python -m vantage_server.futures --import ampfutures`; API
  `GET /api/futures/analysis` + `POST /api/futures/import`; UI = the "Futures" screen.
  Point values: NQ=$20/pt, MNQ=$2/pt.

## Conventions

- UI uses the Lookey design system: `window.LookeyDS.*` components + CSS tokens only.
- Plain-language user-facing text (no unexplained jargon like "mean-reversion",
  "fade the rip") — the playbooks were reworked for a non-options reader.
- ADRs in `initiatives/vantage/adrs/`; product docs in `initiatives/vantage/`; specs in
  `specs/`.

## Routing table

| Initiative | Purpose | INDEX.md |
|-----------|---------|----------|
| [`vantage`](initiatives/vantage/initiative.md) | The portfolio advances the mission goal of running each product as a tracked initiative while reusing one AI-SDLC toolkit and one UI design system across all products. | [`initiatives/vantage/INDEX.md`](initiatives/vantage/INDEX.md) |
