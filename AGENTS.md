# Vantage — Agent Guide

Single-repo project: the code (static SPA + Python backend), the product layer
(`initiatives/vantage/`), and the engineering layer (`specs/<feature-slug>/`) all live
here. Kadence (ai-sdlc-toolkit) conventions apply: durable intent in markdown, status in
GitHub, one feature → one branch → one merge.

## Doctrine (never violate)

- **Read-only decision support (ADR-010): no order placement, no fund movement, ever.**
  Every write path touches only our own SQLite store or local files — never a broker,
  never a fund-moving endpoint. New POST routes must be added to the write allow-list in
  `server/tests/test_api.py` (`ALLOWED_WRITE_ROUTES`) and justified as store-only.
- **Context, not a signal.** The playbooks/analyses are decision-support for reading the
  tape or reviewing trades — not buy/sell signals. Surfaces carry this caveat + "not
  financial advice". Don't fabricate numbers; when data is incomplete, say so.
- ADRs are authoritative: `initiatives/vantage/adrs/` (001–014). Read the relevant one
  before changing architecture.

## External data sources

Vantage consumes read-only data from outside the repo — it never writes to these. Notably
the SPX playbook reads a separate market-intel source (Sentinel) via `sentinel_bridge.py`
from a read-only mount; that source is not part of this repo and must never be modified.
Treat all such upstreams as read-only inputs.

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
