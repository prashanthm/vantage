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

SCHEMA_VERSION = 1

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
