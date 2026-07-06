# Vantage backend (`server/`)

The deterministic portfolio engine behind Vantage (ADR-013/ADR-014). One pure
engine (`vantage_server/engine.py` — positions, allocation, overlap,
cross-account wash-sale windows, TLH candidates), exposed two ways:

- **REST** (`vantage_server/api.py`) — `/api/*` for the SPA.
- **MCP** (`vantage_server/mcp_server.py`) — `vantage.*` tools for Mira, the
  AI side. Mira performs **no portfolio math**; it calls these tools and every
  result carries a provenance block for grounding/attribution.

The service is **read-only by construction** (ADR-010): every REST route is
GET, every MCP tool declares `readOnlyHint`, and no order-placement or
fund-movement code path exists anywhere in the package.

## Ports

| Port | What | Where |
|------|------|-------|
| 8640 | MCP tool server (streamable HTTP, path `/mcp`) | `make run  # (in ../mcp)` |
| 8641 | REST API for the SPA | `make run-api` |
| 8642 | Vantage SPA (static, repo root) | `python3 -m http.server 8642` |
| 8080 | Mira (external AI system, MCP client) | not in this repo |

## Run

```sh
make setup        # create server/.venv (Python 3.12, uv if available) + editable install
make test         # pytest: engine units, parity goldens, API contract, MCP round-trips
make run-api      # uvicorn on http://127.0.0.1:8641  (GET /api/health to check)
make run  # (in ../mcp)      # MCP streamable HTTP on http://127.0.0.1:8640/mcp
make run-api-live # same API with live Stooq quotes overlaid (VANTAGE_QUOTES=stooq)
make run  # (in ../mcp)-live # same MCP server with live Stooq quotes
```

## Data

`VANTAGE_DATA_DIR` points at a directory of JSON files (`accounts.json`,
`lots.json`, `recent_buys.json`, `auto_buys.json`, `partner_map.json`,
`quotes.json`, plus optional `signals.json`); the default is `server/data/` —
a fixture dataset that mirrors
the SPA's `src/data.js` **exactly** (same symbols, same numbers, same frozen
`as_of` of 2026-07-05 09:30 ET), which is what makes the parity golden tests
possible.

Quotes default to the deterministic fixture provider. Every REST payload and
MCP tool result carries `{"as_of", "source"}` so consumers always know what
data they are looking at.

## Importing broker lots

`lots.json` can be populated from a broker positions export (CSV) or straight
from a broker's API with the importer CLI. This is operator-side **file
management**, deliberately outside the read-only service surface (ADR-010) —
the API and MCP tools never mutate anything; you do, from your own shell.

**Broker connections are modules.** Every API broker is one module in
`vantage_server/brokers/` implementing the `BrokerConnection` protocol
(`brokers/base.py`) and registered with `@register_connection`; the importer
discovers them from the registry, so `--broker` choices are the CSV parsers
plus every registered connection:

| `--broker` | Kind | Status |
|------------|------|--------|
| `robinhood` | API connection (`brokers/robinhood.py`) | **live** — official Agentic Trading API, read-only allowlist |
| `schwab-api` | API connection (`brokers/schwab.py`) | stub — TDA's API retired May 2024; TDA/Schwab accounts land on the Schwab Trader API (developer.schwab.com); module documents the OAuth + endpoint TODOs |
| `fidelity-api` | API connection (`brokers/aggregator.py`) | stub — Fidelity has no retail API; the path is a SnapTrade/Plaid-style aggregator; module documents the TODOs |
| `fidelity`, `schwab`, `vanguard`, `generic` | CSV importers (`importer.py`) | live — zero-dependency statement/positions parsing |

**Adding a broker** (nothing in `importer.py` changes):

1. Create one module `vantage_server/brokers/<broker>.py`.
2. Implement `fetch_positions` / `fetch_portfolio` / `interactive_auth` /
   `auth_status` per `brokers/base.py`, with a hard read-only allowlist at the
   transport layer (raise `ReadOnlyViolation` before any network I/O — ADR-010).
3. Decorate the class with `@register_connection` (`broker_id` = the `--broker` id).
4. Import the module from `brokers/__init__.py`.
5. Add tests proving the allowlist refusal path (see `tests/test_brokers_base.py`).

CSV examples:

```sh
# Fidelity positions export (no acquisition dates in the export → --as-of required)
.venv/bin/python -m vantage_server.importer positions.csv \
    --broker fidelity --account fid-taxable --as-of 2026-07-05

# Schwab positions export
.venv/bin/python -m vantage_server.importer positions.csv \
    --broker schwab --account schwab-roth --as-of 2026-07-05

# Vanguard holdings download (no cost basis in the basic download —
# Share Price is used as cost_per_share, with a warning per row)
.venv/bin/python -m vantage_server.importer ofxdownload.csv \
    --broker vanguard --account vg-401k --as-of 2026-07-05

# Generic CSV in the internal shape: account,symbol,date,shares,costPerShare
# (the account column is optional when --account is given)
.venv/bin/python -m vantage_server.importer lots.csv --broker generic
```

Semantics:

- `--merge` (default) replaces only the imported account's lots and keeps
  every other account; `--replace` swaps the whole lots file.
- Every write first backs up the previous file to `lots.json.bak-<timestamp>`
  next to it.
- `--dry-run` prints the parsed lots and summary, writes nothing.
- Cash/sweep rows, pending activity, and disclaimer footers are skipped with
  warnings; a file yielding zero lots aborts (exit 2).
- The target account must already exist in `accounts.json` (exit 2 otherwise);
  `--add-account "id,name,short,type,taxable"` appends it in the same run.
- `--data-dir` targets another data directory (default: `VANTAGE_DATA_DIR`
  or `server/data`).

## Real vs demo data

`server/data/` is the pristine fixture dataset (a test oracle — never import
into it). Real portfolios live in `server/data-local/` (gitignored), which is
preferred automatically when present: resolution is `VANTAGE_DATA_DIR` env >
`data-local/` > fixtures. The importer and both servers all follow this rule,
so imports land in `data-local/` once it exists. Delete `data-local/` to
return to demo mode.

## Robinhood (read-only)

**All your Robinhood accounts are readable**, not just agentic-enrolled ones —
`agentic_allowed: false` gates trading, never reads. Discover account numbers:

```bash
python -m vantage_server.importer --broker robinhood --list-accounts
```

then import each with `--broker-account <N>` (add `--include-cash` to book
non-equity value — options/crypto/futures/sweep — as a CASH position).


`--broker robinhood` (the first live broker connection module) syncs
positions straight from Robinhood's official Agentic Trading API (MCP over
streamable HTTP) instead of a CSV — same merge/replace/backup/dry-run
semantics as the CSV brokers:

```sh
.venv/bin/pip install -e ".[robinhood]"   # one-time: the optional mcp extra
.venv/bin/python -m vantage_server.importer \
    --broker robinhood --account rh-main --broker-account <N> --dry-run
```

(`--broker-account` is the broker-side account number for any API connection;
`--rh-account` still works as a deprecated alias.)

Drop `--dry-run` to write; `--as-of YYYY-MM-DD` overrides the lot date
(default: today). First-time users authorize once in the browser:

```sh
.venv/bin/python -m vantage_server.importer --broker robinhood --auth
```

- **Hard read-only guarantee (ADR-010)**: every Robinhood call goes through a
  single dispatcher with an explicit allowlist
  (`get_portfolio`, `get_equity_positions`, `get_equity_quotes` —
  `brokers/robinhood.py`); anything else raises `ReadOnlyViolation` before
  any network I/O. No order or transfer code path exists in this package.
- **Grant reuse**: the token file resolves env `ROBINHOOD_TOKEN_FILE` >
  `~/personal/sentinel/.robinhood_token.json` (an existing sentinel grant is
  reused rather than creating a competing one) > `server/.robinhood_token.json`.
  Saved atomically with chmod 600; token values are never printed or logged.
- **Average-cost limitation**: Robinhood returns one row per symbol with an
  AVERAGE buy price and no acquisition dates, so the sync writes ONE synthetic
  lot per position dated `--as-of`. Wash-sale/TLH math then runs on average
  basis — the statement-CSV import path stays the lot-accurate option.
- Zero-share rows are skipped with warnings; the target `--account` must exist
  in `accounts.json` (exit 2 otherwise; `--add-account` works here too).

## Live quotes

Set `VANTAGE_QUOTES=stooq` (or use `make run-api-live` / `make run  # (in ../mcp)-live`)
to overlay free delayed prices from stooq.com (stdlib urllib, no credentials,
symbols mapped to Stooq's lowercase `.us` form, e.g. `spy.us`).

Staleness semantics: any full-fetch failure degrades to fixture prices with
`"source": "fixture", "stale": true`; a symbol Stooq does not know (`N/D`
rows) keeps its fixture price and marks the snapshot `"stale": true` while the
rest of the symbols stay live. `name` and `asset_class` always come from the
fixture — Stooq has neither. `CASH` is never fetched (price is
definitionally 1).

Successful fetches are cached in `<data_dir>/quotes_cache.json` (with a
`fetched_at` timestamp) and reused for `VANTAGE_QUOTES_TTL` seconds
(default 900) so repeated requests don't hammer the free feed; cached
snapshots report `as_of` = the cached fetch time. Set `VANTAGE_QUOTES_TTL=0`
to bypass the cache entirely.

## Signals

`GET /api/signals` and the `vantage.signals` MCP tool grade the authored
trade signals in `data/signals.json` against the current quote snapshot.
**Statuses are computed from quotes, never authored**: the seed file carries
only facts (symbol, pattern, entry/target/stop, confidence, creation time) and
the loader rejects any authored `status` field. Direction is implied by
target vs entry; grading returns `open`/`hit_target`/`stopped` (or `unquoted`
when the symbol has no quote — the fixture quote table does not cover the
signal symbols, so fixture mode honestly reports `unquoted` instead of the
SPA's authored labels), a P/L % signed by direction, and a progress grade
A–F (A ≥ 75% of the entry→target move captured, B ≥ 50%, C flat-to-positive,
D negative but above halfway-to-stop, F at/below halfway-to-stop). The exact
rules live in `vantage_server/signals.py`.

## Semantics

The engine ports `src/util.jsx` (the product's current spec) faithfully —
thresholds `$200` / `3%` (either qualifies a loss), 30-day wash window in both
directions, cross-account including IRAs (Rev. Rul. 2008-5),
substantially-identical families, different-index partner map, auto-buy
look-ahead. Where `util.jsx` and sentinel's `tlh_monitor.py` differ, `util.jsx`
wins; the differences and resolutions are documented at the top of
`vantage_server/engine.py`.

## Integration notes

- The SPA (Phase V4) will swap its `src/data.js` mock boundary for `/api/*`;
  until then the SPA keeps running purely on the mock module — nothing under
  `src/` depends on this server.
- Mira connects as an MCP client to `http://127.0.0.1:8640/mcp` and gets the
  same numbers the SPA renders, from the same engine.

## MCP tool surface

Moved to its own project: [`../mcp`](../mcp/README.md) (`make -C ../mcp run`).
Prefer `../stack start` to run the whole stack.
