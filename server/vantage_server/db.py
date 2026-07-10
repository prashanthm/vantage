"""SQLite backing store — stdlib ``sqlite3`` wrapper for the real-data store.

``Database(path)`` opens a WAL-mode connection with foreign keys on and a
``sqlite3.Row`` factory, applies an idempotent schema, and offers a small
transaction helper. The schema mirrors the JSON shapes the store historically
read from disk (see store.py): ACCUMULATING tables (accounts, lots, history)
get real columns + upsert-by-natural-key so a refresh can INSERT OR REPLACE and
dedupe, while "latest snapshot" tables (bars, strategies, analysis-per-date,
roundtrips, trade_stats, earnings) keep the current code's dict/array payloads
in JSON TEXT columns — minimal reshaping, exact round-trip.

This module is pure persistence: no market-data I/O, no engine logic. Only the
operator-side write methods on Store (and the migration CLI) call the write
paths; the FastAPI/MCP surface only ever reads.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA_VERSION = 7  # v7: journal_snapshots (chart image + forecast-vs-outcome)

#: A ``vantage.db`` in a data-local directory (or an explicit path) selects the
#: SQLite backend. The fixture dataset (server/data) never carries one, so it
#: keeps using the JSON backend and the parity goldens are untouched.
DB_FILENAME = "vantage.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    short       TEXT NOT NULL,
    type        TEXT NOT NULL,
    taxable     INTEGER NOT NULL,   -- 0/1 bool
    last_sync   TEXT NOT NULL,
    seq         INTEGER              -- preserves source ordering
);

CREATE TABLE IF NOT EXISTS lots (
    account         TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    date            TEXT NOT NULL,
    shares          REAL NOT NULL,
    cost_per_share  REAL NOT NULL,
    seq             INTEGER,
    PRIMARY KEY (account, symbol, date, shares, cost_per_share)
);

CREATE TABLE IF NOT EXISTS recent_buys (
    account TEXT NOT NULL,
    symbol  TEXT NOT NULL,
    date    TEXT NOT NULL,
    note    TEXT NOT NULL,
    seq     INTEGER,
    PRIMARY KEY (account, symbol, date, note)
);

CREATE TABLE IF NOT EXISTS auto_buys (
    account       TEXT NOT NULL,
    symbol        TEXT NOT NULL,
    day_of_month  INTEGER,
    amount        REAL,
    cadence       TEXT,
    seq           INTEGER
);

CREATE TABLE IF NOT EXISTS partner_map (
    symbol      TEXT PRIMARY KEY,
    replacement TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
    symbol      TEXT PRIMARY KEY,
    name        TEXT,
    price       REAL,
    day_pct     REAL,
    asset_class TEXT
);

CREATE TABLE IF NOT EXISTS bars (
    symbol         TEXT PRIMARY KEY,
    as_of          TEXT,
    lookback_days  INTEGER,
    backfilled     INTEGER,
    first_bar      TEXT,
    last_bar       TEXT,
    bar_count      INTEGER,
    daily          TEXT,   -- JSON array
    weekly         TEXT,   -- JSON array
    monthly        TEXT    -- JSON array
);

CREATE TABLE IF NOT EXISTS history (
    row_key       TEXT PRIMARY KEY,   -- stable content hash (no broker order_id)
    account       TEXT,
    broker_account TEXT,
    date          TEXT,
    kind          TEXT,
    symbol        TEXT,
    description   TEXT,
    side          TEXT,
    quantity      REAL,
    price         REAL,
    amount        REAL,
    state         TEXT,
    extra         TEXT,   -- JSON for any keys outside the known columns
    present_cols  TEXT    -- JSON list of known columns present in the source row
);

CREATE TABLE IF NOT EXISTS strategies (
    id         INTEGER PRIMARY KEY CHECK (id = 1),  -- single latest snapshot
    as_of      TEXT,
    open       TEXT,        -- JSON array
    closed     TEXT,        -- JSON array
    by_ticker  TEXT         -- JSON array
);

CREATE TABLE IF NOT EXISTS analysis (
    date         TEXT PRIMARY KEY,   -- YYYY-MM-DD
    as_of        TEXT,
    generated_at TEXT,
    decisions    TEXT                -- JSON array
);

CREATE TABLE IF NOT EXISTS spx_playbook (
    date      TEXT PRIMARY KEY,   -- generated_for (YYYY-MM-DD)
    session   TEXT,               -- the session the playbook is for
    scaffold  TEXT,               -- JSON: the deterministic playbook scaffold
    narrative TEXT                -- JSON/text: the LLM narrative (filled lazily; may be null)
);

CREATE TABLE IF NOT EXISTS roundtrips (
    id         INTEGER PRIMARY KEY CHECK (id = 1),  -- single latest snapshot
    as_of      TEXT,
    account    TEXT,
    roundtrips TEXT,     -- JSON array
    summary    TEXT      -- JSON object
);

CREATE TABLE IF NOT EXISTS trade_stats (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),  -- single latest
    as_of              TEXT,
    account            TEXT,
    baseline_win_rate  REAL,
    featured           TEXT,   -- JSON array
    buckets            TEXT,   -- JSON array
    notable            TEXT,   -- JSON array
    by_account         TEXT    -- JSON object
);

CREATE TABLE IF NOT EXISTS earnings (
    symbol   TEXT PRIMARY KEY,
    as_of    TEXT,
    earnings TEXT,   -- JSON array
    dates    TEXT    -- JSON array
);

CREATE TABLE IF NOT EXISTS signals (
    id         INTEGER PRIMARY KEY,
    sym        TEXT NOT NULL,
    pattern    TEXT NOT NULL,
    entry      REAL NOT NULL,
    target     REAL NOT NULL,
    stop       REAL NOT NULL,
    move_pct   REAL,
    conf       REAL,
    time       TEXT,
    seq        INTEGER
);

-- Per-ticker notebook: one structured plan per symbol (thesis / target / stop /
-- free-text notes). Written by the SPA via POST /api/ticker/{sym}/plan — the
-- second deliberate API write after refresh (ADR-014). No broker/fund contact.
CREATE TABLE IF NOT EXISTS ticker_plan (
    symbol      TEXT PRIMARY KEY,
    thesis      TEXT,
    target      REAL,
    stop        REAL,
    notes       TEXT,
    updated_at  TEXT NOT NULL
);

-- Per-ticker running journal: an append-only timeline of auto snapshots (nightly
-- price + P&L + recommendation) interleaved with manual notes. `payload` is JSON.
CREATE TABLE IF NOT EXISTS ticker_journal (
    id          INTEGER PRIMARY KEY,
    symbol      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    kind        TEXT NOT NULL,          -- 'snapshot' | 'note'
    payload     TEXT NOT NULL           -- JSON blob
);
CREATE INDEX IF NOT EXISTS ix_ticker_journal_sym ON ticker_journal(symbol, created_at);

-- Durable level memory: one row per (session, symbol, level). Recorded nightly so
-- a level's history builds over time — the thing that lets us surface a level
-- that has been repeatedly tested/respected across weeks (LuxAlgo-style memory),
-- but built from our own dimensions (fractal S/R, volume PoC, swings, round
-- numbers, and — going forward — GEX walls/flip/max-pain). `dim` is the coarse
-- dimension type (support/resistance/poc/swing/round/gex_wall/gamma_flip/max_pain);
-- `kind` is the human label; `touches` is that session's own touch count (price
-- dimensions only); `day_high`/`day_low`/`day_close` capture where price traded
-- that session so a later pass can ask "did price respect this level?".
CREATE TABLE IF NOT EXISTS level_history (
    session    TEXT NOT NULL,        -- YYYY-MM-DD the level was observed for
    symbol     TEXT NOT NULL,
    price      REAL NOT NULL,
    dim        TEXT NOT NULL,        -- coarse dimension type
    kind       TEXT NOT NULL,        -- human label (e.g. "support (3x tested)")
    source     TEXT NOT NULL,        -- 'chart' | 'GEX' | 'psych'
    touches    INTEGER,              -- session-local touch count (price dims)
    day_high   REAL,
    day_low    REAL,
    day_close  REAL,
    PRIMARY KEY (session, symbol, dim, price)
);
CREATE INDEX IF NOT EXISTS ix_level_history_sym ON level_history(symbol, session);

-- Futures order EXECUTIONS (filled orders) imported from an AMP/CQG CSV export.
-- One row per filled order (AMP "Order ID" is the natural dedupe key). These are
-- the ground truth for round-trip P&L; round-trips + win-rate are DERIVED on read
-- (never stored), because a windowed export can leave positions unpaired and any
-- cached P&L would be wrong. `contract` is normalized (NQ|MNQ); `point_value` is
-- baked at ingest ($20 NQ e-mini / $2 MNQ micro) so dollar P&L is unambiguous.
-- `extra` JSON carries the bracket prices (limit/stop/take-profit/stop-loss).
CREATE TABLE IF NOT EXISTS futures_fills (
    order_id       TEXT PRIMARY KEY,   -- AMP "Order ID" — idempotent dedupe key
    raw_symbol     TEXT NOT NULL,      -- 'F.US.ENQU26'
    contract       TEXT NOT NULL,      -- normalized 'NQ' | 'MNQ'
    contract_month TEXT,               -- 'YYYY-MM' parsed from the CQG month code
    point_value    REAL NOT NULL,      -- 20.0 (NQ) | 2.0 (MNQ)
    side           TEXT NOT NULL,      -- 'Buy' | 'Sell'
    order_type     TEXT,               -- Market | Stop | Stop Loss | Limit
    quantity       REAL,
    fill_quantity  REAL,
    avg_fill_price REAL NOT NULL,
    commission     REAL,               -- usually NULL in the AMP export
    placing_time   TEXT,               -- 'YYYY-MM-DD HH:MM:SS' (ET), as-is
    status_time    TEXT,               -- fill timestamp used for ordering
    status         TEXT,               -- 'Filled'
    duration       TEXT,               -- GTC | DAY
    account        TEXT,               -- logical account tag (default 'ampfutures')
    extra          TEXT,               -- JSON: limit/stop/take_profit/stop_loss
    seq            INTEGER              -- source ordering within an import batch
);
CREATE INDEX IF NOT EXISTS ix_futures_fills_contract ON futures_fills(contract, status_time);

-- Futures ORDER LOG (the fuller history, all statuses) — for order-BEHAVIOR
-- analysis (cancel rate, stop usage), distinct from the executions above. Same
-- Order ID key; Filled rows overlap futures_fills by design (separate concerns).
CREATE TABLE IF NOT EXISTS futures_orders (
    order_id       TEXT PRIMARY KEY,
    raw_symbol     TEXT NOT NULL,
    contract       TEXT NOT NULL,      -- 'NQ' | 'MNQ'
    side           TEXT NOT NULL,
    order_type     TEXT,               -- Market|Stop|Stop Loss|Take Profit|Limit|Trailing Stop
    status         TEXT NOT NULL,      -- 'Filled' | 'Cancelled' | 'Rejected'
    quantity       REAL,
    fill_quantity  REAL,
    avg_fill_price REAL,
    active_at      TEXT,
    placing_time   TEXT,
    status_time    TEXT,
    duration       TEXT,
    account        TEXT,
    extra          TEXT,               -- JSON: limit/stop prices
    seq            INTEGER
);
CREATE INDEX IF NOT EXISTS ix_futures_orders_status ON futures_orders(contract, status);

-- Native dealer-gamma (GEX) snapshot, computed IN Vantage from the yfinance
-- option chain (no longer dependent on Sentinel's file). Single latest snapshot;
-- the full computed dict lives in `snapshot` JSON. `gex_history` accrues one row
-- per session so the playbook's regime→next-day-range edge keeps working.
CREATE TABLE IF NOT EXISTS gex_snapshot (
    id        INTEGER PRIMARY KEY CHECK (id = 1),  -- single latest
    date      TEXT,                                -- YYYY-MM-DD (ET)
    symbol    TEXT,
    snapshot  TEXT                                 -- JSON: full compute_gex dict
);

CREATE TABLE IF NOT EXISTS gex_history (
    date            TEXT PRIMARY KEY,   -- one row per session (ET date)
    symbol          TEXT,
    spot            REAL,
    net_gex_bn      REAL,
    regime          TEXT,
    gamma_flip      REAL,
    call_wall       REAL,
    put_wall        REAL,
    max_pain        REAL,
    call_share_pct  REAL
);

-- Paper trades: a NO-MONEY track record of the 0DTE playbook's signals traded on
-- SPY (the SPX proxy). Each row is one simulated trade — opened at a signal's SPY
-- entry with a target (the next playbook level) and stop (just beyond the signal
-- level), then auto-closed by checking SPY intraday bars for the first touch of
-- target or stop. P&L is on SPY SHARES (the honest, simple proxy); `ref_strike`
-- records the nearest 0DTE option strike for reference only. This is a simulation
-- for learning + strategy validation — it places NO real orders (ADR-010).
CREATE TABLE IF NOT EXISTS paper_trades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    opened_at    TEXT NOT NULL,      -- ISO timestamp the paper trade was logged
    session      TEXT,               -- playbook session date it came from
    signal       TEXT NOT NULL,      -- human label ('fade resistance 754.95', ...)
    side         TEXT NOT NULL,      -- 'long' (buy dip) | 'short' (fade rally)
    symbol       TEXT NOT NULL,      -- 'SPY'
    spx_level    REAL,               -- the SPX level the signal keyed off
    spy_entry    REAL NOT NULL,      -- SPY price at open
    spy_target   REAL,               -- next playbook level (SPY terms)
    spy_stop     REAL,               -- just beyond the signal level (SPY terms)
    shares       REAL,               -- notional share count for the P&L calc
    ref_strike   REAL,               -- nearest 0DTE strike (reference only)
    source       TEXT,               -- 'auto' (signal) | 'manual'
    status       TEXT NOT NULL,      -- 'open' | 'closed'
    opened_price_src TEXT,           -- where the entry price came from
    closed_at    TEXT,               -- ISO close time
    spy_exit     REAL,               -- SPY price at close
    exit_reason  TEXT,               -- 'target' | 'stop' | 'manual' | 'expired'
    pnl          REAL,               -- (exit-entry)*shares signed by side
    pnl_pct      REAL                -- % move on SPY
);
CREATE INDEX IF NOT EXISTS ix_paper_status ON paper_trades(status, opened_at);

-- Chart-snapshot journal: a saved chart IMAGE paired with the playbook forecast
-- that was live when it was captured, so we can look back and score what was
-- FORECAST vs what actually HAPPENED — building (or dissolving) confidence in the
-- projections with evidence. The image bytes live on disk (data-dir/journal/);
-- this row holds the metadata + a frozen copy of the forecast (`forecast` JSON:
-- session, spot, regime, the plan line, and the key levels with roles) and a
-- later-computed `scorecard` JSON (which levels held/broke, was the regime call
-- right, price range since). Context/journal only — no orders (ADR-010).
CREATE TABLE IF NOT EXISTS journal_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,      -- ISO timestamp captured
    session      TEXT,               -- the playbook session it was linked to
    symbol       TEXT,               -- 'SPX' (proxy price scored on SPX/SPY)
    image_path   TEXT,               -- relative path under the journal dir
    image_mime   TEXT,               -- e.g. image/png
    note         TEXT,               -- the user's short note
    spot_at_snap REAL,               -- price when captured (for the outcome delta)
    forecast     TEXT,               -- JSON: frozen forecast (levels/regime/plan)
    scorecard    TEXT,               -- JSON: forecast-vs-outcome (filled later)
    scored_at    TEXT                -- when the scorecard was last computed
);
CREATE INDEX IF NOT EXISTS ix_journal_created ON journal_snapshots(created_at);
"""


class Database:
    """A thin, idempotent wrapper over a single SQLite file."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    # ----------------------------------------------------------- connection

    def connect(self) -> sqlite3.Connection:
        """Open a connection with WAL, foreign keys, and Row rows. Callers own
        the connection lifetime (close it, or use ``transaction``)."""
        conn = sqlite3.connect(str(self.path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def init_schema(self, conn: sqlite3.Connection | None = None) -> None:
        """Create every table if absent and stamp the schema version. Safe to
        call repeatedly (CREATE TABLE IF NOT EXISTS)."""
        own = conn is None
        conn = conn or self.connect()
        try:
            conn.executescript(_SCHEMA)
            conn.execute(
                "INSERT INTO meta(key, value) VALUES('schema_version', ?)\n"
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(SCHEMA_VERSION),),
            )
            conn.commit()
        finally:
            if own:
                conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """A committed-on-success / rolled-back-on-error connection scope."""
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def schema_version(self) -> int | None:
        conn = self.connect()
        try:
            row = conn.execute(
                "SELECT value FROM meta WHERE key='schema_version'"
            ).fetchone()
            return int(row["value"]) if row else None
        except sqlite3.OperationalError:
            return None  # meta table not created yet
        finally:
            conn.close()


# ---------------------------------------------------------------- JSON helpers


def dumps(value: Any) -> str:
    """Compact-but-stable JSON for a TEXT column."""
    return json.dumps(value, ensure_ascii=False)


def loads(text: Any, default: Any = None) -> Any:
    """Parse a JSON TEXT column, tolerating NULL/empty by returning ``default``."""
    if text is None or text == "":
        return default
    if not isinstance(text, (str, bytes, bytearray)):
        return text
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return default


def history_row_key(row: dict) -> str:
    """A stable natural key for a history row.

    Broker history rows carry no ``order_id``, so we hash the identifying
    content (account + full transaction tuple) to a deterministic key. Two rows
    describing the same transaction collapse to the same key — the dedupe the
    accumulate contract needs — while genuinely distinct rows stay distinct.
    An explicit ``order_id`` is honored when present (future-proofing)."""
    import hashlib

    if row.get("order_id"):
        return f"oid:{row['order_id']}"
    ident = [
        str(row.get("account") or ""),
        str(row.get("broker_account") or ""),
        str(row.get("date") or ""),
        str(row.get("kind") or ""),
        str(row.get("symbol") or ""),
        str(row.get("description") or ""),
        str(row.get("side") or ""),
        repr(row.get("quantity")),
        repr(row.get("price")),
        repr(row.get("amount")),
        str(row.get("state") or ""),
    ]
    digest = hashlib.sha1("\x1f".join(ident).encode("utf-8")).hexdigest()
    return f"h:{digest}"


#: The history columns stored as first-class columns; everything else on a row
#: is preserved in the ``extra`` JSON column so a round-trip is lossless.
HISTORY_COLUMNS = (
    "account", "broker_account", "date", "kind", "symbol", "description",
    "side", "quantity", "price", "amount", "state",
)
