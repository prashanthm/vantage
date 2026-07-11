"""Real-data store — the only place portfolio data is read from disk.

Historically a JSON-file reader; it now delegates to one of two backends behind
an identical ``load_*`` API:

  * ``_JsonBackend`` — the original behaviour: reads/writes the JSON files under
    the data directory (accounts.json, lots.json, bars/<SYM>.json, ...). The
    FIXTURE dataset (server/data, the parity-golden oracle) always uses this
    backend, so every contract/parity test is byte-identical.
  * ``_SqliteBackend`` — reads/writes a single ``vantage.db`` (stdlib sqlite3,
    WAL). Selected when the data dir contains a ``vantage.db`` (or ``VANTAGE_DB``
    / an explicit db path points at one). ACCUMULATING data (accounts, lots,
    history) upserts by natural key; snapshot data (bars, strategies, analysis,
    roundtrips, trade_stats, earnings) round-trips its dict payload.

Both backends return the SAME frozen dataclasses / dict shapes, so nothing
downstream (engine, API, MCP) knows which one is in play. Write methods exist on
Store but are only ever called by the operator CLIs (importer, snapshot_bars,
analyze, ml builders) — the read-only doctrine (ADR-010) is preserved: the REST
API and MCP surface only read.

Shapes are validated eagerly with explicit errors — a malformed file fails at
load time with the file and field named, never as a KeyError deep in the engine.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import db as _db
from .models import Account, AutoBuy, Lot, RecentBuy

# Real (imported) data lives in data-local (gitignored, SQLite-backed). There is
# NO packaged demo/fixture dataset — the app serves real data or nothing. Test
# suites point at synthetic inputs under tests/fixtures via an explicit arg/env.
LOCAL_DATA_DIR = Path(__file__).resolve().parent.parent / "data-local"
ENV_DATA_DIR = "VANTAGE_DATA_DIR"
ENV_DB = "VANTAGE_DB"


class StoreError(ValueError):
    """A data file is missing, unreadable, or shaped wrong."""


def resolve_data_dir(data_dir: str | os.PathLike[str] | None = None) -> Path:
    """Explicit arg > VANTAGE_DATA_DIR env > data-local (real imported data).

    There is no demo/fixture fallback: if none of these resolve to a real data
    dir, data-local is returned regardless (empty until a broker is imported) —
    the app shows empty states, never fabricated numbers.
    """
    if data_dir is not None:
        return Path(data_dir)
    env = os.environ.get(ENV_DATA_DIR)
    if env:
        return Path(env)
    return LOCAL_DATA_DIR


def resolve_db_path(data_dir: Path) -> Path | None:
    """The SQLite db backing ``data_dir``, or None when JSON should be used.

    Selection: an explicit ``VANTAGE_DB`` env (a file path, or a directory to
    look for vantage.db in) wins; otherwise a ``vantage.db`` inside ``data_dir``
    opts that directory into SQLite. Absent both, None → the JSON backend. The
    fixture dir carries no vantage.db, so it always stays JSON."""
    env = os.environ.get(ENV_DB, "").strip()
    if env:
        p = Path(env)
        if p.is_dir():
            candidate = p / _db.DB_FILENAME
            return candidate if candidate.is_file() else None
        # An explicit file path: use it whether or not it exists yet (the
        # migration CLI creates it; a running store points at a live one).
        if p.suffix or p.name == _db.DB_FILENAME:
            return p
        return p
    candidate = Path(data_dir) / _db.DB_FILENAME
    return candidate if candidate.is_file() else None


@dataclass(frozen=True)
class Dataset:
    """Everything the engine needs except quotes (those come from a provider)."""
    accounts: tuple[Account, ...]
    lots: tuple[Lot, ...]
    recent_buys: tuple[RecentBuy, ...]
    auto_buys: tuple[AutoBuy, ...]
    partner_map: dict[str, str]


def _read_json(path: Path) -> Any:
    if not path.is_file():
        raise StoreError(f"{path}: file not found (set {ENV_DATA_DIR} or create it)")
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise StoreError(f"{path}: invalid JSON ({e})") from e


def _require(record: dict, key: str, kind: type | tuple[type, ...], where: str) -> Any:
    if key not in record:
        raise StoreError(f"{where}: missing required key '{key}' in {record!r}")
    value = record[key]
    if not isinstance(value, kind):
        raise StoreError(f"{where}: key '{key}' must be {kind}, got {type(value).__name__} in {record!r}")
    return value


def _require_list(data: Any, where: str) -> list:
    if not isinstance(data, list):
        raise StoreError(f"{where}: top level must be a JSON array, got {type(data).__name__}")
    return data


_NUM = (int, float)


# =====================================================================
# JSON backend — the original file reader/writer, refactored out of Store.
# =====================================================================


class _JsonBackend:
    """Reads and validates the portfolio dataset from JSON files in a dir.

    Write methods delegate to the module-level writer functions the CLIs and
    tests already use (importer.write_lots, snapshot_bars.write_bars, ...), so
    the existing file-management behaviour — merge-by-account, .bak backups — is
    unchanged and every tmp_path JSON test keeps passing."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir

    # -- reads --------------------------------------------------------------

    def load_accounts(self) -> tuple[Account, ...]:
        path = self.data_dir / "accounts.json"
        rows = _require_list(_read_json(path), str(path))
        return tuple(
            Account(
                id=_require(r, "id", str, str(path)),
                name=_require(r, "name", str, str(path)),
                short=_require(r, "short", str, str(path)),
                type=_require(r, "type", str, str(path)),
                taxable=_require(r, "taxable", bool, str(path)),
                last_sync=_require(r, "last_sync", str, str(path)),
            )
            for r in rows
        )

    def load_lots(self) -> tuple[Lot, ...]:
        path = self.data_dir / "lots.json"
        rows = _require_list(_read_json(path), str(path))
        lots = tuple(
            Lot(
                account=_require(r, "account", str, str(path)),
                symbol=_require(r, "symbol", str, str(path)),
                date=_require(r, "date", str, str(path)),
                shares=float(_require(r, "shares", _NUM, str(path))),
                cost_per_share=float(_require(r, "cost_per_share", _NUM, str(path))),
            )
            for r in rows
        )
        _validate_lots(lots, str(path))
        return lots

    def load_recent_buys(self) -> tuple[RecentBuy, ...]:
        path = self.data_dir / "recent_buys.json"
        rows = _require_list(_read_json(path), str(path))
        return tuple(
            RecentBuy(
                account=_require(r, "account", str, str(path)),
                symbol=_require(r, "symbol", str, str(path)),
                date=_require(r, "date", str, str(path)),
                note=_require(r, "note", str, str(path)),
            )
            for r in rows
        )

    def load_auto_buys(self) -> tuple[AutoBuy, ...]:
        path = self.data_dir / "auto_buys.json"
        rows = _require_list(_read_json(path), str(path))
        out = []
        for r in rows:
            day = r.get("day_of_month")
            if day is not None and not isinstance(day, int):
                raise StoreError(f"{path}: day_of_month must be an integer in {r!r}")
            amount = r.get("amount")
            if amount is not None and not isinstance(amount, _NUM):
                raise StoreError(f"{path}: amount must be a number in {r!r}")
            out.append(
                AutoBuy(
                    account=_require(r, "account", str, str(path)),
                    symbol=_require(r, "symbol", str, str(path)),
                    day_of_month=day,
                    amount=float(amount) if amount is not None else None,
                    cadence=r.get("cadence"),
                )
            )
        return tuple(out)

    def load_partner_map(self) -> dict[str, str]:
        path = self.data_dir / "partner_map.json"
        data = _read_json(path)
        if not isinstance(data, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in data.items()
        ):
            raise StoreError(f"{path}: must be a JSON object of symbol -> replacement symbol")
        return data

    def load_history(self) -> list[dict]:
        path = self.data_dir / "history.json"
        if not path.is_file():
            return []
        rows = _require_list(_read_json(path), str(path))
        out = [r for r in rows if isinstance(r, dict)]
        out.sort(key=lambda r: str(r.get("date") or ""), reverse=True)
        return out

    def load_strategies(self) -> dict:
        path = self.data_dir / "strategies.json"
        if not path.is_file():
            return {"open": [], "closed": [], "by_ticker": [], "as_of": None}
        data = _read_json(path)
        if not isinstance(data, dict):
            raise StoreError(f"{path}: top level must be a JSON object with "
                             "'open' and 'closed' keys")
        return _normalize_strategies(data)

    def load_roundtrips(self) -> dict:
        path = self.data_dir / "ml" / "roundtrips.json"
        if not path.is_file():
            return {"as_of": None, "roundtrips": [], "summary": {}}
        try:
            data = _read_json(path)
        except StoreError:
            return {"as_of": None, "roundtrips": [], "summary": {}}
        if not isinstance(data, dict):
            return {"as_of": None, "roundtrips": [], "summary": {}}
        return _normalize_roundtrips(data)

    def load_trade_stats(self) -> dict:
        path = self.data_dir / "ml" / "trade_stats.json"
        if not path.is_file():
            return _empty_trade_stats()
        try:
            data = _read_json(path)
        except StoreError:
            return _empty_trade_stats()
        if not isinstance(data, dict):
            return _empty_trade_stats()
        return _normalize_trade_stats(data)


# =====================================================================
# SQLite backend — reads/writes a single vantage.db.
# =====================================================================


class _SqliteBackend:
    """Reads and validates the dataset from a SQLite db. Returns the SAME types
    as the JSON backend. Schema is ensured on first connect (idempotent)."""

    def __init__(self, data_dir: Path, db_path: Path):
        self.data_dir = data_dir
        self.db = _db.Database(db_path)
        self._ensured = False

    def _conn(self):
        conn = self.db.connect()
        if not self._ensured:
            self.db.init_schema(conn)
            self._ensured = True
        return conn

    # -- reads --------------------------------------------------------------

    def load_accounts(self) -> tuple[Account, ...]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT id, name, short, type, taxable, last_sync FROM accounts "
                "ORDER BY seq, id"
            ).fetchall()
        finally:
            conn.close()
        return tuple(
            Account(
                id=r["id"], name=r["name"], short=r["short"], type=r["type"],
                taxable=bool(r["taxable"]), last_sync=r["last_sync"],
            )
            for r in rows
        )

    def load_lots(self) -> tuple[Lot, ...]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT account, symbol, date, shares, cost_per_share FROM lots "
                "ORDER BY seq, account, symbol, date"
            ).fetchall()
        finally:
            conn.close()
        lots = tuple(
            Lot(account=r["account"], symbol=r["symbol"], date=r["date"],
                shares=float(r["shares"]), cost_per_share=float(r["cost_per_share"]))
            for r in rows
        )
        _validate_lots(lots, "lots (sqlite)")
        return lots

    def load_recent_buys(self) -> tuple[RecentBuy, ...]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT account, symbol, date, note FROM recent_buys "
                "ORDER BY seq, account, symbol, date"
            ).fetchall()
        finally:
            conn.close()
        return tuple(
            RecentBuy(account=r["account"], symbol=r["symbol"], date=r["date"],
                      note=r["note"])
            for r in rows
        )

    def load_auto_buys(self) -> tuple[AutoBuy, ...]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT account, symbol, day_of_month, amount, cadence FROM auto_buys "
                "ORDER BY seq, account, symbol"
            ).fetchall()
        finally:
            conn.close()
        return tuple(
            AutoBuy(
                account=r["account"], symbol=r["symbol"],
                day_of_month=r["day_of_month"],
                amount=float(r["amount"]) if r["amount"] is not None else None,
                cadence=r["cadence"],
            )
            for r in rows
        )

    def load_partner_map(self) -> dict[str, str]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT symbol, replacement FROM partner_map ORDER BY symbol"
            ).fetchall()
        finally:
            conn.close()
        return {r["symbol"]: r["replacement"] for r in rows}

    def load_history(self) -> list[dict]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM history ORDER BY date DESC"
            ).fetchall()
        finally:
            conn.close()
        out = [_history_row_to_dict(r) for r in rows]
        out.sort(key=lambda r: str(r.get("date") or ""), reverse=True)
        return out

    def load_strategies(self) -> dict:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT as_of, open, closed, by_ticker FROM strategies WHERE id=1"
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return {"open": [], "closed": [], "by_ticker": [], "as_of": None}
        return _normalize_strategies({
            "as_of": row["as_of"],
            "open": _db.loads(row["open"], []),
            "closed": _db.loads(row["closed"], []),
            "by_ticker": _db.loads(row["by_ticker"], []),
        })

    def load_roundtrips(self) -> dict:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT as_of, roundtrips, summary FROM roundtrips WHERE id=1"
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return {"as_of": None, "roundtrips": [], "summary": {}}
        return _normalize_roundtrips({
            "as_of": row["as_of"],
            "roundtrips": _db.loads(row["roundtrips"], []),
            "summary": _db.loads(row["summary"], {}),
        })

    def load_trade_stats(self) -> dict:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT as_of, baseline_win_rate, featured, buckets, notable, "
                "by_account FROM trade_stats WHERE id=1"
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return _empty_trade_stats()
        return _normalize_trade_stats({
            "as_of": row["as_of"],
            "baseline_win_rate": row["baseline_win_rate"],
            "featured": _db.loads(row["featured"], []),
            "buckets": _db.loads(row["buckets"], []),
            "notable": _db.loads(row["notable"], []),
            "by_account": _db.loads(row["by_account"], {}),
        })


# =====================================================================
# Shared normalization / validation (identical results across backends).
# =====================================================================


def _validate_lots(lots, where: str) -> None:
    for lot in lots:
        if lot.shares <= 0:
            raise StoreError(f"{where}: lot {lot.symbol} {lot.date} has non-positive shares")
        if lot.cost_per_share < 0:
            raise StoreError(f"{where}: lot {lot.symbol} {lot.date} has negative cost_per_share")


def _normalize_strategies(data: dict) -> dict:
    open_rows = data.get("open")
    closed_rows = data.get("closed")
    by_ticker_rows = data.get("by_ticker")
    return {
        "open": [r for r in open_rows if isinstance(r, dict)]
        if isinstance(open_rows, list) else [],
        "closed": [r for r in closed_rows if isinstance(r, dict)]
        if isinstance(closed_rows, list) else [],
        "by_ticker": [r for r in by_ticker_rows if isinstance(r, dict)]
        if isinstance(by_ticker_rows, list) else [],
        "as_of": data.get("as_of"),
    }


def _normalize_roundtrips(data: dict) -> dict:
    rows = data.get("roundtrips")
    summary = data.get("summary")
    return {
        "as_of": data.get("as_of"),
        "roundtrips": [r for r in rows if isinstance(r, dict)]
        if isinstance(rows, list) else [],
        "summary": summary if isinstance(summary, dict) else {},
    }


def _empty_trade_stats() -> dict:
    return {
        "as_of": None,
        "baseline_win_rate": None,
        "featured": [],
        "buckets": [],
        "notable": [],
        "by_account": {},
    }


def _normalize_trade_stats(data: dict) -> dict:
    by_account = data.get("by_account")
    return {
        "as_of": data.get("as_of"),
        "baseline_win_rate": data.get("baseline_win_rate"),
        "featured": [r for r in (data.get("featured") or []) if isinstance(r, dict)],
        "buckets": [r for r in (data.get("buckets") or []) if isinstance(r, dict)],
        "notable": [r for r in (data.get("notable") or []) if isinstance(r, dict)],
        "by_account": by_account if isinstance(by_account, dict) else {},
    }


def _history_row_to_dict(row) -> dict:
    """Reconstitute a history dict from a sqlite row: exactly the known columns
    that were present in the source (preserving explicit nulls) plus any
    ``extra`` keys. Falls back to 'non-null columns' for rows written before the
    present_cols marker existed."""
    keys = row.keys()
    present = _db.loads(row["present_cols"], None) if "present_cols" in keys else None
    out: dict = {}
    if isinstance(present, list):
        for col in _db.HISTORY_COLUMNS:
            if col in present:
                out[col] = row[col]
    else:
        for col in _db.HISTORY_COLUMNS:
            if row[col] is not None:
                out[col] = row[col]
    extra = _db.loads(row["extra"], {})
    if isinstance(extra, dict):
        for k, v in extra.items():
            out.setdefault(k, v)
    return out


# =====================================================================
# Store — the delegating facade the whole app talks to.
# =====================================================================


class Store:
    """Reads and validates the portfolio dataset, delegating to a JSON or
    SQLite backend chosen from the data dir / VANTAGE_DB (see resolve_db_path).

    Backend selection is lazy and cheap: nothing touches disk in ``__init__``,
    so ``Store(nonexistent_dir)`` still constructs and only a ``load_*`` call
    raises. Write methods are operator-only (the API/MCP surface never calls
    them) and route to the active backend."""

    def __init__(self, data_dir: str | os.PathLike[str] | None = None):
        self.data_dir = resolve_data_dir(data_dir)
        self._db_path = resolve_db_path(self.data_dir)
        if self._db_path is not None:
            self._backend: _JsonBackend | _SqliteBackend = _SqliteBackend(
                self.data_dir, self._db_path)
        else:
            self._backend = _JsonBackend(self.data_dir)

    @property
    def uses_sqlite(self) -> bool:
        return isinstance(self._backend, _SqliteBackend)

    # -- reads (delegated) --------------------------------------------------

    def load_accounts(self) -> tuple[Account, ...]:
        return self._backend.load_accounts()

    def load_lots(self) -> tuple[Lot, ...]:
        return self._backend.load_lots()

    def load_recent_buys(self) -> tuple[RecentBuy, ...]:
        return self._backend.load_recent_buys()

    def load_auto_buys(self) -> tuple[AutoBuy, ...]:
        return self._backend.load_auto_buys()

    def load_partner_map(self) -> dict[str, str]:
        return self._backend.load_partner_map()

    def load_history(self) -> list[dict]:
        return self._backend.load_history()

    def load_strategies(self) -> dict:
        return self._backend.load_strategies()

    def load_roundtrips(self) -> dict:
        return self._backend.load_roundtrips()

    def load_trade_stats(self) -> dict:
        return self._backend.load_trade_stats()

    def load_signals(self):
        """Authored trade signals. On SQLite, read from the signals table; on
        JSON, from signals.json (signals.py). Returns tuple[Signal, ...]."""
        if self.uses_sqlite:
            return self._load_signals_sqlite()
        from .signals import load_signals  # local import: avoids a cycle
        return load_signals(self.data_dir)

    def _load_signals_sqlite(self):
        from .signals import Signal
        conn = self._backend._conn()
        try:
            rows = conn.execute(
                "SELECT id, sym, pattern, entry, target, stop, move_pct, conf, time "
                "FROM signals ORDER BY seq, id"
            ).fetchall()
        finally:
            conn.close()
        out = []
        for r in rows:
            out.append(Signal(
                id=r["id"], sym=str(r["sym"]).upper(), pattern=r["pattern"],
                entry=float(r["entry"]), target=float(r["target"]),
                stop=float(r["stop"]),
                move_pct=float(r["move_pct"]) if r["move_pct"] is not None else None,
                conf=float(r["conf"]) if r["conf"] is not None else None,
                created_at=str(r["time"] or ""),
            ))
        return tuple(out)

    # -- the whole dataset --------------------------------------------------

    def load_dataset(self) -> Dataset:
        accounts = self.load_accounts()
        lots = self.load_lots()
        recent_buys = self.load_recent_buys()
        auto_buys = self.load_auto_buys()
        account_ids = {a.id for a in accounts}
        for lot in lots:
            if lot.account not in account_ids:
                raise StoreError(f"lots.json: lot references unknown account '{lot.account}'")
        for buy in recent_buys:
            if buy.account not in account_ids:
                raise StoreError(f"recent_buys.json: buy references unknown account '{buy.account}'")
        for ab in auto_buys:
            if ab.account not in account_ids:
                raise StoreError(f"auto_buys.json: auto-buy references unknown account '{ab.account}'")
        return Dataset(
            accounts=accounts,
            lots=lots,
            recent_buys=recent_buys,
            auto_buys=auto_buys,
            partner_map=self.load_partner_map(),
        )

    # ==================================================================
    # WRITE methods — operator-only. On JSON they perform the existing file
    # writes (merge-by-account + .bak backup); on SQLite they upsert in a
    # transaction. The API/MCP surface NEVER calls these.
    # ==================================================================

    def upsert_lots(self, imported_accounts, lots: list[dict], *, mode: str = "merge",
                    now=None):
        """Persist lots for the imported accounts. mode='merge' replaces only
        those accounts' lots (keeping others); mode='replace' swaps the whole
        set. ``imported_accounts`` is the set of account ids the ``lots`` cover.
        Returns a backup path (JSON) or None (SQLite)."""
        if not self.uses_sqlite:
            from .importer import write_lots
            existing = _json_list(self.data_dir / "lots.json")
            if mode == "replace":
                final = list(lots)
            else:
                acct_set = set(imported_accounts)
                keep = [l for l in existing if l.get("account") not in acct_set]
                final = keep + lots
            return write_lots(self.data_dir, final, now=now)
        with self._sqlite_txn() as conn:
            if mode == "replace":
                conn.execute("DELETE FROM lots")
            else:
                for acct in set(imported_accounts):
                    conn.execute("DELETE FROM lots WHERE account=?", (acct,))
            self._insert_lots(conn, lots)
        return None

    def _insert_lots(self, conn, lots: list[dict]) -> None:
        for i, l in enumerate(lots):
            conn.execute(
                "INSERT OR REPLACE INTO lots"
                "(account, symbol, date, shares, cost_per_share, seq) "
                "VALUES(?,?,?,?,?,?)",
                (str(l["account"]), str(l["symbol"]), str(l["date"]),
                 float(l["shares"]), float(l["cost_per_share"]), i),
            )

    def upsert_accounts(self, accounts: list[dict]) -> None:
        """Replace the accounts table/file with ``accounts`` (full list)."""
        if not self.uses_sqlite:
            path = self.data_dir / "accounts.json"
            path.write_text(json.dumps(accounts, indent=2) + "\n", encoding="utf-8")
            return
        with self._sqlite_txn() as conn:
            conn.execute("DELETE FROM accounts")
            self._insert_accounts(conn, accounts)

    def _insert_accounts(self, conn, accounts: list[dict]) -> None:
        for i, a in enumerate(accounts):
            conn.execute(
                "INSERT OR REPLACE INTO accounts"
                "(id, name, short, type, taxable, last_sync, seq) "
                "VALUES(?,?,?,?,?,?,?)",
                (str(a["id"]), str(a["name"]), str(a["short"]), str(a["type"]),
                 1 if a.get("taxable") else 0, str(a.get("last_sync", "never")), i),
            )

    def add_account(self, account: dict) -> bool:
        """Append one account if its id is new. Returns True when added, False
        when the id already existed."""
        existing = {a.id for a in self.load_accounts()} if self._accounts_exist() else set()
        if account["id"] in existing:
            return False
        if not self.uses_sqlite:
            path = self.data_dir / "accounts.json"
            rows = _json_list(path)
            rows.append(account)
            path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
            return True
        with self._sqlite_txn() as conn:
            n = conn.execute("SELECT COUNT(*) AS c FROM accounts").fetchone()["c"]
            conn.execute(
                "INSERT OR REPLACE INTO accounts"
                "(id, name, short, type, taxable, last_sync, seq) "
                "VALUES(?,?,?,?,?,?,?)",
                (str(account["id"]), str(account["name"]), str(account["short"]),
                 str(account["type"]), 1 if account.get("taxable") else 0,
                 str(account.get("last_sync", "never")), n),
            )
        return True

    def _accounts_exist(self) -> bool:
        if self.uses_sqlite:
            return True  # table exists after schema init
        return (self.data_dir / "accounts.json").is_file()

    def upsert_recent_buys(self, rows: list[dict]) -> None:
        if not self.uses_sqlite:
            path = self.data_dir / "recent_buys.json"
            path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
            return
        with self._sqlite_txn() as conn:
            conn.execute("DELETE FROM recent_buys")
            for i, r in enumerate(rows):
                conn.execute(
                    "INSERT OR REPLACE INTO recent_buys"
                    "(account, symbol, date, note, seq) VALUES(?,?,?,?,?)",
                    (str(r["account"]), str(r["symbol"]), str(r["date"]),
                     str(r.get("note", "")), i),
                )

    def upsert_auto_buys(self, rows: list[dict]) -> None:
        if not self.uses_sqlite:
            path = self.data_dir / "auto_buys.json"
            path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
            return
        with self._sqlite_txn() as conn:
            conn.execute("DELETE FROM auto_buys")
            for i, r in enumerate(rows):
                amount = r.get("amount")
                conn.execute(
                    "INSERT INTO auto_buys"
                    "(account, symbol, day_of_month, amount, cadence, seq) "
                    "VALUES(?,?,?,?,?,?)",
                    (str(r["account"]), str(r["symbol"]), r.get("day_of_month"),
                     float(amount) if amount is not None else None,
                     r.get("cadence"), i),
                )

    def set_partner_map(self, mapping: dict[str, str]) -> None:
        if not self.uses_sqlite:
            path = self.data_dir / "partner_map.json"
            path.write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")
            return
        with self._sqlite_txn() as conn:
            conn.execute("DELETE FROM partner_map")
            for sym, repl in mapping.items():
                conn.execute(
                    "INSERT OR REPLACE INTO partner_map(symbol, replacement) "
                    "VALUES(?,?)", (str(sym), str(repl)),
                )

    def upsert_history(self, account: str, rows: list[dict], *, now=None):
        """Accumulate history rows. On JSON, merge-by-account (this account's
        rows replaced, others kept) + backup — the importer's contract. On
        SQLite, INSERT OR REPLACE by row_key (dedupe): new rows added, existing
        rows kept/refreshed, so a refresh never drops prior history. Returns
        (path, backup) on JSON, (None, None) on SQLite."""
        if not self.uses_sqlite:
            from .importer import write_history
            return write_history(self.data_dir, account, rows, now=now)
        with self._sqlite_txn() as conn:
            self._insert_history(conn, rows)
        return None, None

    def _insert_history(self, conn, rows: list[dict]) -> None:
        for r in rows:
            if not isinstance(r, dict):
                continue
            key = _db.history_row_key(r)
            known = {c: r.get(c) for c in _db.HISTORY_COLUMNS}
            # Track which known columns were EXPLICITLY present (even if null) so
            # a round-trip restores exactly the source keys — a row carrying an
            # explicit ``price: None`` must not lose the key on read.
            present = [c for c in _db.HISTORY_COLUMNS if c in r]
            extra = {k: v for k, v in r.items()
                     if k not in _db.HISTORY_COLUMNS and k != "order_id"}
            conn.execute(
                "INSERT OR REPLACE INTO history"
                "(row_key, account, broker_account, date, kind, symbol, description, "
                " side, quantity, price, amount, state, extra, present_cols) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (key, known["account"], known["broker_account"], known["date"],
                 known["kind"], known["symbol"], known["description"], known["side"],
                 known["quantity"], known["price"], known["amount"], known["state"],
                 _db.dumps(extra) if extra else None, _db.dumps(present)),
            )

    def put_bars(self, symbol: str, series: dict, *, as_of: str,
                 lookback_days: int = 0, backfilled: bool = False, now=None):
        """Persist one symbol's bars. On JSON, snapshot_bars.write_bars (backup +
        provenance markers). On SQLite, upsert the row (daily/weekly/monthly as
        JSON). Returns (path, backup) on JSON, (None, None) on SQLite."""
        if not self.uses_sqlite:
            from .snapshot_bars import write_bars
            return write_bars(self.data_dir, symbol, series, as_of=as_of,
                              lookback_days=lookback_days, backfilled=backfilled,
                              now=now)
        daily = series.get("daily") or []
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO bars"
                "(symbol, as_of, lookback_days, backfilled, first_bar, last_bar, "
                " bar_count, daily, weekly, monthly) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (symbol.upper(), as_of, lookback_days, 1 if backfilled else 0,
                 str(daily[0].get("date"))[:10] if daily else None,
                 str(daily[-1].get("date"))[:10] if daily else None,
                 len(daily), _db.dumps(daily),
                 _db.dumps(series.get("weekly") or []),
                 _db.dumps(series.get("monthly") or [])),
            )
        return None, None

    def load_bars(self, symbol: str) -> dict | None:
        """Read one symbol's bars payload ({symbol, as_of, daily, weekly,
        monthly, ...}) or None. On JSON, reads bars/<SYM>.json; on SQLite, the
        bars table."""
        if not self.uses_sqlite:
            path = self.data_dir / "bars" / f"{symbol.upper()}.json"
            if not path.is_file():
                return None
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return None
            return data if isinstance(data, dict) else None
        conn = self._backend._conn()
        try:
            row = conn.execute(
                "SELECT * FROM bars WHERE symbol=?", (symbol.upper(),)
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        return {
            "symbol": row["symbol"],
            "as_of": row["as_of"],
            "lookback_days": row["lookback_days"],
            "backfilled": bool(row["backfilled"]),
            "first_bar": row["first_bar"],
            "last_bar": row["last_bar"],
            "bar_count": row["bar_count"],
            "daily": _db.loads(row["daily"], []),
            "weekly": _db.loads(row["weekly"], []),
            "monthly": _db.loads(row["monthly"], []),
        }

    def put_strategies(self, rollup: dict) -> None:
        """Persist the whole strategy roll-up snapshot {open, closed, by_ticker,
        as_of}. (The importer already merges by account before calling; on JSON
        this writes the file directly, on SQLite the single snapshot row.)"""
        norm = _normalize_strategies(rollup)
        if not self.uses_sqlite:
            path = self.data_dir / "strategies.json"
            path.write_text(json.dumps({
                "open": rollup.get("open", []),
                "closed": rollup.get("closed", []),
                "by_ticker": rollup.get("by_ticker", []),
                "as_of": rollup.get("as_of"),
            }, indent=2) + "\n", encoding="utf-8")
            return
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO strategies(id, as_of, open, closed, by_ticker) "
                "VALUES(1,?,?,?,?)",
                (norm["as_of"], _db.dumps(norm["open"]), _db.dumps(norm["closed"]),
                 _db.dumps(norm["by_ticker"])),
            )

    def put_analysis(self, date: str, payload: dict) -> None:
        """Persist one day's analysis journal {as_of, generated_at, decisions}."""
        if not self.uses_sqlite:
            raise RuntimeError("put_analysis on JSON backend is handled by analyze.write_journal")
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO analysis(date, as_of, generated_at, decisions) "
                "VALUES(?,?,?,?)",
                (date, payload.get("as_of", date), payload.get("generated_at"),
                 _db.dumps(payload.get("decisions") or [])),
            )

    def load_analysis_day(self, day: str | None = None) -> dict | None:
        """One day's journal (latest when ``day`` is None), or None. On JSON,
        delegates to analyze.load_day; on SQLite, reads the analysis table."""
        if not self.uses_sqlite:
            from . import analyze
            return analyze.load_day(self.data_dir, day)
        conn = self._backend._conn()
        try:
            if day is None:
                row = conn.execute(
                    "SELECT * FROM analysis ORDER BY date DESC LIMIT 1"
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM analysis WHERE date=?", (day,)
                ).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        return {
            "as_of": row["as_of"],
            "generated_at": row["generated_at"],
            "decisions": _db.loads(row["decisions"], []),
        }

    def load_analysis_symbol_history(self, symbol: str) -> list[dict]:
        """Every journaled decision for ``symbol`` across days, newest first."""
        if not self.uses_sqlite:
            from . import analyze
            return analyze.load_symbol_history(self.data_dir, symbol)
        want = symbol.upper()
        conn = self._backend._conn()
        try:
            rows = conn.execute(
                "SELECT date, as_of, decisions FROM analysis ORDER BY date"
            ).fetchall()
        finally:
            conn.close()
        trail: list[dict] = []
        for r in rows:
            for dec in _db.loads(r["decisions"], []):
                if str(dec.get("symbol", "")).upper() == want:
                    trail.append({"as_of": r["as_of"] or r["date"], "decision": dec})
        trail.sort(key=lambda x: str(x.get("as_of") or ""), reverse=True)
        return trail

    # ── SPX 0DTE playbook (single latest, SQLite-only like the notebook) ──────

    def upsert_spx_playbook(self, day: str, scaffold: dict, narrative=None) -> None:
        """Insert/replace the SPX playbook scaffold (+ optional narrative) for a day."""
        if not self.uses_sqlite:
            raise RuntimeError("upsert_spx_playbook requires the SQLite backend")
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO spx_playbook(date, session, scaffold, narrative) "
                "VALUES(?,?,?,?)",
                (day, scaffold.get("session"), _db.dumps(scaffold),
                 _db.dumps(narrative) if narrative is not None else None),
            )

    def load_spx_playbook(self, day: str | None = None) -> dict | None:
        """The playbook for ``day`` (latest when None), or None. Returns
        ``{date, session, scaffold, narrative}`` with parsed JSON."""
        if not self.uses_sqlite:
            return None
        conn = self._backend._conn()
        try:
            if day is None:
                row = conn.execute(
                    "SELECT * FROM spx_playbook ORDER BY date DESC LIMIT 1").fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM spx_playbook WHERE date=?", (day,)).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        return {
            "date": row["date"],
            "session": row["session"],
            "scaffold": _db.loads(row["scaffold"], {}),
            "narrative": _db.loads(row["narrative"], None) if row["narrative"] else None,
        }

    def load_spx_playbook_before(self, day: str) -> dict | None:
        """The most recent playbook strictly BEFORE ``day`` (i.e. last night's /
        the prior session's), or None. Same shape as ``load_spx_playbook``."""
        if not self.uses_sqlite:
            return None
        conn = self._backend._conn()
        try:
            row = conn.execute(
                "SELECT * FROM spx_playbook WHERE date < ? "
                "ORDER BY date DESC LIMIT 1", (day,)).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        return {
            "date": row["date"],
            "session": row["session"],
            "scaffold": _db.loads(row["scaffold"], {}),
            "narrative": _db.loads(row["narrative"], None) if row["narrative"] else None,
        }

    def save_spx_playbook_narrative(self, day: str, narrative) -> bool:
        """Attach the LLM narrative to an existing playbook row (lazy-fill on read).
        Returns True if a row was updated."""
        if not self.uses_sqlite:
            return False
        with self._sqlite_txn() as conn:
            cur = conn.execute(
                "UPDATE spx_playbook SET narrative=? WHERE date=?",
                (_db.dumps(narrative), day))
            return cur.rowcount > 0

    # ── durable level memory (SQLite-only) ───────────────────────────────────

    def record_levels(self, session: str, symbol: str, levels: list[dict],
                      day: dict | None = None) -> int:
        """Record one session's observed levels into ``level_history`` (idempotent
        per session/symbol/dim/price). ``levels`` is a list of
        ``{price, dim, kind, source, touches?}``; ``day`` optionally carries
        ``{high, low, close}`` for the session so a later pass can score whether
        price respected the level. Returns the number of rows written."""
        if not self.uses_sqlite:
            raise RuntimeError("record_levels requires the SQLite backend")
        dh = (day or {}).get("high"); dl = (day or {}).get("low"); dc = (day or {}).get("close")
        n = 0
        with self._sqlite_txn() as conn:
            for lv in levels:
                price = lv.get("price")
                dim = lv.get("dim"); kind = lv.get("kind"); src = lv.get("source")
                if price is None or not dim or not kind:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO level_history"
                    "(session, symbol, price, dim, kind, source, touches, "
                    " day_high, day_low, day_close) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (session, symbol, round(float(price), 2), dim, kind,
                     src or "chart", lv.get("touches"), dh, dl, dc),
                )
                n += 1
        return n

    def load_level_history(self, symbol: str, since: str | None = None,
                           until: str | None = None) -> list[dict]:
        """Every recorded level for ``symbol`` in ``[since, until]`` (inclusive),
        oldest session first. Empty on the JSON backend."""
        if not self.uses_sqlite:
            return []
        conn = self._backend._conn()
        try:
            sql = "SELECT * FROM level_history WHERE symbol=?"
            params: list = [symbol]
            if since:
                sql += " AND session>=?"; params.append(since)
            if until:
                sql += " AND session<=?"; params.append(until)
            sql += " ORDER BY session ASC, price DESC"
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()
        return [dict(r) for r in rows]

    def level_history_sessions(self, symbol: str) -> list[str]:
        """Distinct sessions recorded for ``symbol`` (oldest first)."""
        if not self.uses_sqlite:
            return []
        conn = self._backend._conn()
        try:
            rows = conn.execute(
                "SELECT DISTINCT session FROM level_history WHERE symbol=? "
                "ORDER BY session ASC", (symbol,)).fetchall()
        finally:
            conn.close()
        return [r["session"] for r in rows]

    # ── futures executions + order log (SQLite-only) ─────────────────────────

    def record_futures_fills(self, fills: list[dict], *,
                             account: str = "ampfutures") -> int:
        """Persist AMP futures EXECUTIONS into ``futures_fills`` (idempotent on
        ``order_id``). Each fill is a normalized dict from ``futures.parse_*``:
        ``{order_id, raw_symbol, contract, contract_month, point_value, side,
        order_type, quantity, fill_quantity, avg_fill_price, commission,
        placing_time, status_time, status, duration, extra}``. Rows without an
        order_id or a fill price are skipped. Returns the number written."""
        if not self.uses_sqlite:
            raise RuntimeError("record_futures_fills requires the SQLite backend")
        n = 0
        with self._sqlite_txn() as conn:
            for i, f in enumerate(fills):
                oid = f.get("order_id")
                px = f.get("avg_fill_price")
                if not oid or px is None:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO futures_fills"
                    "(order_id, raw_symbol, contract, contract_month, point_value,"
                    " side, order_type, quantity, fill_quantity, avg_fill_price,"
                    " commission, placing_time, status_time, status, duration,"
                    " account, extra, seq) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (str(oid), f.get("raw_symbol"), f.get("contract"),
                     f.get("contract_month"), float(f.get("point_value") or 0),
                     f.get("side"), f.get("order_type"), f.get("quantity"),
                     f.get("fill_quantity"), float(px), f.get("commission"),
                     f.get("placing_time"), f.get("status_time"),
                     f.get("status") or "Filled", f.get("duration"), account,
                     _db.dumps(f.get("extra") or {}), i),
                )
                n += 1
        return n

    def record_futures_orders(self, orders: list[dict], *,
                              account: str = "ampfutures") -> int:
        """Persist the fuller AMP order LOG (all statuses) into ``futures_orders``
        (idempotent on ``order_id``) for order-behavior analysis. Returns count."""
        if not self.uses_sqlite:
            raise RuntimeError("record_futures_orders requires the SQLite backend")
        n = 0
        with self._sqlite_txn() as conn:
            for i, o in enumerate(orders):
                oid = o.get("order_id")
                if not oid:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO futures_orders"
                    "(order_id, raw_symbol, contract, side, order_type, status,"
                    " quantity, fill_quantity, avg_fill_price, active_at,"
                    " placing_time, status_time, duration, account, extra, seq) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (str(oid), o.get("raw_symbol"), o.get("contract"),
                     o.get("side"), o.get("order_type"), o.get("status"),
                     o.get("quantity"), o.get("fill_quantity"),
                     o.get("avg_fill_price"), o.get("active_at"),
                     o.get("placing_time"), o.get("status_time"),
                     o.get("duration"), account, _db.dumps(o.get("extra") or {}), i),
                )
                n += 1
        return n

    def load_futures_fills(self, contract: str | None = None) -> list[dict]:
        """Every stored execution (optionally one ``contract``), CHRONOLOGICAL
        (status_time ascending) — the order the pairing needs. ``extra`` parsed
        back to a dict. Empty on the JSON backend."""
        if not self.uses_sqlite:
            return []
        conn = self._backend._conn()
        try:
            sql = "SELECT * FROM futures_fills"
            params: list = []
            if contract:
                sql += " WHERE contract=?"; params.append(contract)
            sql += " ORDER BY status_time ASC, order_id ASC"
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()
        out = []
        for r in rows:
            d = dict(r)
            d["extra"] = _db.loads(d.get("extra"), {})
            out.append(d)
        return out

    def load_futures_orders(self, contract: str | None = None,
                            status: str | None = None) -> list[dict]:
        """The order log (optionally filtered by contract / status)."""
        if not self.uses_sqlite:
            return []
        conn = self._backend._conn()
        try:
            sql = "SELECT * FROM futures_orders"
            clauses, params = [], []
            if contract:
                clauses.append("contract=?"); params.append(contract)
            if status:
                clauses.append("status=?"); params.append(status)
            if clauses:
                sql += " WHERE " + " AND ".join(clauses)
            sql += " ORDER BY status_time ASC, order_id ASC"
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()
        out = []
        for r in rows:
            d = dict(r)
            d["extra"] = _db.loads(d.get("extra"), {})
            out.append(d)
        return out

    def put_futures_meta(self, payload: dict) -> None:
        """Persist the parsed balances+positions snapshot (for reconciliation)
        in the generic ``meta`` table under key ``futures_reconcile``."""
        self.set_meta("futures_reconcile", _db.dumps(payload))

    def load_futures_meta(self) -> dict:
        """The last-imported balances+positions snapshot (or {})."""
        return _db.loads(self.get_meta("futures_reconcile"), {}) or {}

    # ── native GEX snapshot + history (SQLite-only) ──────────────────────────

    def put_gex_snapshot(self, snap: dict) -> None:
        """Store the latest GEX snapshot (full computed dict as JSON)."""
        if not self.uses_sqlite:
            raise RuntimeError("put_gex_snapshot requires the SQLite backend")
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO gex_snapshot(id, date, symbol, snapshot) "
                "VALUES(1,?,?,?)",
                (snap.get("date"), snap.get("symbol"), _db.dumps(snap)))

    def load_gex_snapshot(self) -> dict | None:
        """The latest GEX snapshot dict, or None."""
        if not self.uses_sqlite:
            return None
        conn = self._backend._conn()
        try:
            row = conn.execute("SELECT snapshot FROM gex_snapshot WHERE id=1").fetchone()
        finally:
            conn.close()
        return _db.loads(row["snapshot"], None) if row else None

    def record_gex_history(self, snap: dict) -> None:
        """Append one nightly GEX row (idempotent per session date) so the
        regime→next-day-range edge keeps working."""
        if not self.uses_sqlite:
            raise RuntimeError("record_gex_history requires the SQLite backend")
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO gex_history"
                "(date, symbol, spot, net_gex_bn, regime, gamma_flip, call_wall,"
                " put_wall, max_pain, call_share_pct) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (snap.get("date"), snap.get("symbol"), snap.get("spot"),
                 snap.get("net_gex_bn"), snap.get("regime"), snap.get("gamma_flip"),
                 snap.get("call_wall"), snap.get("put_wall"), snap.get("max_pain"),
                 snap.get("call_share_pct")))

    def load_gex_history(self) -> list[dict]:
        """Every recorded nightly GEX row, oldest first."""
        if not self.uses_sqlite:
            return []
        conn = self._backend._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM gex_history ORDER BY date ASC").fetchall()
        finally:
            conn.close()
        return [dict(r) for r in rows]

    # ── paper trades (SPY paper-trading tracker, SQLite-only) ────────────────

    def record_paper_trade(self, trade: dict) -> int:
        """Insert one open paper trade. Returns the new row id."""
        if not self.uses_sqlite:
            raise RuntimeError("record_paper_trade requires the SQLite backend")
        cols = ("opened_at", "session", "signal", "side", "symbol", "spx_level",
                "spy_entry", "spy_target", "spy_stop", "shares", "ref_strike",
                "source", "status", "opened_price_src")
        with self._sqlite_txn() as conn:
            cur = conn.execute(
                f"INSERT INTO paper_trades({','.join(cols)}) "
                f"VALUES({','.join('?' for _ in cols)})",
                tuple(trade.get(c) for c in cols))
            return int(cur.lastrowid)

    def load_paper_trades(self, status: str | None = None) -> list[dict]:
        """Paper trades (optionally filtered by status), newest first."""
        if not self.uses_sqlite:
            return []
        conn = self._backend._conn()
        try:
            sql = "SELECT * FROM paper_trades"
            params: list = []
            if status:
                sql += " WHERE status=?"; params.append(status)
            sql += " ORDER BY opened_at DESC, id DESC"
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()
        return [dict(r) for r in rows]

    def close_paper_trade(self, trade_id: int, *, spy_exit: float,
                          exit_reason: str, pnl: float, pnl_pct: float,
                          closed_at: str) -> bool:
        """Mark a paper trade closed with its exit + P&L. Returns True if updated."""
        if not self.uses_sqlite:
            return False
        with self._sqlite_txn() as conn:
            cur = conn.execute(
                "UPDATE paper_trades SET status='closed', spy_exit=?, exit_reason=?, "
                "pnl=?, pnl_pct=?, closed_at=? WHERE id=? AND status='open'",
                (spy_exit, exit_reason, pnl, pnl_pct, closed_at, trade_id))
            return cur.rowcount > 0

    # ── chart-snapshot journal (SQLite metadata; image bytes on disk) ────────

    def record_journal_snapshot(self, snap: dict) -> int:
        """Insert a journal snapshot row (image already written to disk). Returns
        the new id. `forecast` is stored as JSON; `scorecard` starts null."""
        if not self.uses_sqlite:
            raise RuntimeError("record_journal_snapshot requires the SQLite backend")
        with self._sqlite_txn() as conn:
            cur = conn.execute(
                "INSERT INTO journal_snapshots"
                "(created_at, session, symbol, image_path, image_mime, note,"
                " spot_at_snap, forecast, forecast_kind, entry, entry_updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (snap.get("created_at"), snap.get("session"), snap.get("symbol", "SPX"),
                 snap.get("image_path"), snap.get("image_mime"), snap.get("note"),
                 snap.get("spot_at_snap"), _db.dumps(snap.get("forecast") or {}),
                 snap.get("forecast_kind"),
                 _db.dumps(snap["entry"]) if snap.get("entry") else None,
                 snap.get("entry_updated_at")))
            return int(cur.lastrowid)

    def load_journal_snapshots(self) -> list[dict]:
        """All journal snapshots, newest first, with forecast/scorecard parsed."""
        if not self.uses_sqlite:
            return []
        conn = self._backend._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM journal_snapshots ORDER BY created_at DESC, id DESC"
            ).fetchall()
        finally:
            conn.close()
        out = []
        for r in rows:
            d = dict(r)
            d["forecast"] = _db.loads(d.get("forecast"), {})
            d["scorecard"] = _db.loads(d.get("scorecard"), None)
            d["entry"] = _db.loads(d.get("entry"), None)
            out.append(d)
        return out

    def load_journal_snapshot_for_day(self, day: str) -> dict | None:
        """The most recent auto/day snapshot whose created_at falls on ``day``
        (YYYY-MM-DD), or None. Used to keep the daily entry idempotent — one per
        trading day."""
        if not self.uses_sqlite:
            return None
        conn = self._backend._conn()
        try:
            row = conn.execute(
                "SELECT * FROM journal_snapshots WHERE substr(created_at,1,10)=? "
                "ORDER BY id DESC LIMIT 1", (day,)).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        d = dict(row)
        d["forecast"] = _db.loads(d.get("forecast"), {})
        d["scorecard"] = _db.loads(d.get("scorecard"), None)
        d["entry"] = _db.loads(d.get("entry"), None)
        return d

    def load_journal_snapshot(self, snap_id: int) -> dict | None:
        conn = self._backend._conn() if self.uses_sqlite else None
        if conn is None:
            return None
        try:
            row = conn.execute(
                "SELECT * FROM journal_snapshots WHERE id=?", (snap_id,)).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        d = dict(row)
        d["forecast"] = _db.loads(d.get("forecast"), {})
        d["scorecard"] = _db.loads(d.get("scorecard"), None)
        d["entry"] = _db.loads(d.get("entry"), None)
        return d

    def update_journal_scorecard(self, snap_id: int, scorecard: dict,
                                 scored_at: str) -> bool:
        if not self.uses_sqlite:
            return False
        with self._sqlite_txn() as conn:
            cur = conn.execute(
                "UPDATE journal_snapshots SET scorecard=?, scored_at=? WHERE id=?",
                (_db.dumps(scorecard), scored_at, snap_id))
            return cur.rowcount > 0

    def update_journal_image(self, snap_id: int, image_path: str,
                             image_mime: str) -> bool:
        """Attach / replace the reference image on an existing snapshot (the file
        is already written to disk). Store-only write (ADR-010)."""
        if not self.uses_sqlite:
            return False
        with self._sqlite_txn() as conn:
            cur = conn.execute(
                "UPDATE journal_snapshots SET image_path=?, image_mime=? WHERE id=?",
                (image_path, image_mime, snap_id))
            return cur.rowcount > 0

    def update_journal_entry(self, snap_id: int, entry: dict | None,
                             updated_at: str) -> bool:
        """Save the structured trade-action log ('what I did') for a snapshot.
        Store-only write (ADR-010). A falsy entry clears it."""
        if not self.uses_sqlite:
            return False
        with self._sqlite_txn() as conn:
            cur = conn.execute(
                "UPDATE journal_snapshots SET entry=?, entry_updated_at=? WHERE id=?",
                (_db.dumps(entry) if entry else None, updated_at, snap_id))
            return cur.rowcount > 0

    def delete_journal_snapshot(self, snap_id: int) -> bool:
        if not self.uses_sqlite:
            return False
        with self._sqlite_txn() as conn:
            cur = conn.execute("DELETE FROM journal_snapshots WHERE id=?", (snap_id,))
            return cur.rowcount > 0

    def put_roundtrips(self, account: str, roundtrips: list[dict], summary: dict,
                       *, as_of: str, now=None):
        """Persist the round-trips snapshot. On JSON, build_roundtrips.write_roundtrips
        (merge-by-account + backup). On SQLite, replace this account's rows and
        keep others, then store the merged snapshot. Returns (path, backup) on
        JSON, (None, None) on SQLite."""
        if not self.uses_sqlite:
            raise RuntimeError("put_roundtrips on JSON backend is handled by "
                               "build_roundtrips.write_roundtrips")
        current = self.load_roundtrips()
        kept = [r for r in current["roundtrips"] if r.get("account") != account]
        tagged = [{**r, "account": account} for r in roundtrips]
        all_rows = tagged + kept
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO roundtrips(id, as_of, account, roundtrips, summary) "
                "VALUES(1,?,?,?,?)",
                (as_of, account, _db.dumps(all_rows), _db.dumps(summary)),
            )
        return None, None

    def put_trade_stats(self, account: str, *, baseline_win_rate, featured, buckets,
                        notable, as_of: str, now=None):
        """Persist trade_stats. On SQLite, merge by-account like the JSON writer:
        this account's block replaces the prior one under by_account, top-level
        reflects the last built account."""
        if not self.uses_sqlite:
            raise RuntimeError("put_trade_stats on JSON backend is handled by "
                               "build_features.write_trade_stats")
        current = self.load_trade_stats()
        by_account = dict(current.get("by_account") or {})
        tagged_featured = [{**f, "account": account} for f in featured]
        by_account[account] = {
            "baseline_win_rate": baseline_win_rate,
            "featured": tagged_featured,
            "buckets": buckets,
            "notable": notable,
        }
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO trade_stats"
                "(id, as_of, account, baseline_win_rate, featured, buckets, notable, by_account) "
                "VALUES(1,?,?,?,?,?,?,?)",
                (as_of, account, baseline_win_rate, _db.dumps(tagged_featured),
                 _db.dumps(buckets), _db.dumps(notable), _db.dumps(by_account)),
            )
        return None, None

    def put_earnings(self, symbol: str, earnings: list[dict], dates: list[str],
                     *, as_of: str) -> None:
        if not self.uses_sqlite:
            raise RuntimeError("put_earnings on JSON backend is handled by "
                               "fetch_earnings.write_cache")
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO earnings(symbol, as_of, earnings, dates) "
                "VALUES(?,?,?,?)",
                (symbol.upper(), as_of, _db.dumps(earnings), _db.dumps(dates)),
            )

    def load_earnings(self, symbol: str) -> dict | None:
        if not self.uses_sqlite:
            from .ml.fetch_earnings import load_cached
            return load_cached(self.data_dir, symbol)
        conn = self._backend._conn()
        try:
            row = conn.execute(
                "SELECT * FROM earnings WHERE symbol=?", (symbol.upper(),)
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        return {
            "symbol": row["symbol"], "as_of": row["as_of"],
            "earnings": _db.loads(row["earnings"], []),
            "dates": _db.loads(row["dates"], []),
        }

    def put_signals(self, rows: list[dict]) -> None:
        if not self.uses_sqlite:
            path = self.data_dir / "signals.json"
            path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
            return
        with self._sqlite_txn() as conn:
            conn.execute("DELETE FROM signals")
            for i, r in enumerate(rows):
                conn.execute(
                    "INSERT OR REPLACE INTO signals"
                    "(id, sym, pattern, entry, target, stop, move_pct, conf, time, seq) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (r["id"], str(r["sym"]).upper(), str(r["pattern"]),
                     float(r["entry"]), float(r["target"]), float(r["stop"]),
                     float(r["move_pct"]) if r.get("move_pct") is not None else None,
                     float(r["conf"]) if r.get("conf") is not None else None,
                     str(r.get("time", "")), i),
                )

    def set_quotes(self, entries: dict[str, dict], *, as_of: str | None = None) -> None:
        """Upsert quote records (symbol -> {name, price, day_pct, asset_class})."""
        if not self.uses_sqlite:
            from .importer import update_quotes_file
            update_quotes_file(self.data_dir, entries)
            return
        with self._sqlite_txn() as conn:
            for sym, q in entries.items():
                conn.execute(
                    "INSERT OR REPLACE INTO quotes"
                    "(symbol, name, price, day_pct, asset_class) VALUES(?,?,?,?,?)",
                    (str(sym), str(q.get("name", sym)),
                     float(q["price"]) if q.get("price") is not None else None,
                     float(q.get("day_pct", 0)), str(q.get("asset_class", ""))),
                )
            if as_of is not None:
                self.set_meta("quotes_as_of", as_of, conn=conn)

    def load_quotes(self) -> dict | None:
        """{as_of, quotes: {sym: {...}}} from SQLite, or None on JSON (quotes
        stay in quotes.json read by FixtureQuoteProvider)."""
        if not self.uses_sqlite:
            return None
        conn = self._backend._conn()
        try:
            rows = conn.execute("SELECT * FROM quotes").fetchall()
        finally:
            conn.close()
        quotes = {
            r["symbol"]: {"name": r["name"], "price": r["price"],
                          "day_pct": r["day_pct"], "asset_class": r["asset_class"]}
            for r in rows
        }
        return {"as_of": self.get_meta("quotes_as_of"), "quotes": quotes}

    def set_meta(self, key: str, value: str, *, conn=None) -> None:
        if not self.uses_sqlite:
            return  # meta is a SQLite convenience; JSON has no equivalent
        if conn is not None:
            conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES(?,?)", (key, value))
            return
        with self._sqlite_txn() as c:
            c.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?,?)", (key, value))

    def get_meta(self, key: str) -> str | None:
        if not self.uses_sqlite:
            return None
        conn = self._backend._conn()
        try:
            row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        finally:
            conn.close()
        return row["value"] if row else None

    # -- per-ticker notebook (plan + journal) -------------------------------
    #
    # The notebook is a real-data feature — SQLite only. On JSON these raise,
    # matching put_analysis/put_roundtrips precedent.

    def load_ticker_plan(self, symbol: str) -> dict | None:
        """The structured plan for one symbol, or None. {thesis,target,stop,notes,updated_at}."""
        if not self.uses_sqlite:
            return None
        conn = self._backend._conn()
        try:
            row = conn.execute(
                "SELECT * FROM ticker_plan WHERE symbol=?", (symbol.upper(),)
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        return {"symbol": row["symbol"], "thesis": row["thesis"], "target": row["target"],
                "stop": row["stop"], "notes": row["notes"], "updated_at": row["updated_at"]}

    def upsert_ticker_plan(self, symbol: str, plan: dict, *, now: str) -> None:
        """Insert/replace the plan for one symbol. `plan` may carry thesis/target/stop/notes."""
        if not self.uses_sqlite:
            raise RuntimeError("upsert_ticker_plan requires the SQLite backend")
        target = plan.get("target")
        stop = plan.get("stop")
        with self._sqlite_txn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO ticker_plan(symbol, thesis, target, stop, notes, updated_at) "
                "VALUES(?,?,?,?,?,?)",
                (symbol.upper(), plan.get("thesis"),
                 float(target) if target not in (None, "") else None,
                 float(stop) if stop not in (None, "") else None,
                 plan.get("notes"), now),
            )

    def append_ticker_journal(self, symbol: str, kind: str, payload: dict, *, now: str) -> int:
        """Append one journal row; returns its id."""
        if not self.uses_sqlite:
            raise RuntimeError("append_ticker_journal requires the SQLite backend")
        with self._sqlite_txn() as conn:
            cur = conn.execute(
                "INSERT INTO ticker_journal(symbol, created_at, kind, payload) VALUES(?,?,?,?)",
                (symbol.upper(), now, kind, _db.dumps(payload)),
            )
            return int(cur.lastrowid)

    def load_ticker_journal(self, symbol: str, limit: int = 100) -> list[dict]:
        """Journal rows for one symbol, newest first. [{id,created_at,kind,payload}]."""
        if not self.uses_sqlite:
            return []
        conn = self._backend._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM ticker_journal WHERE symbol=? ORDER BY created_at DESC, id DESC LIMIT ?",
                (symbol.upper(), int(limit)),
            ).fetchall()
        finally:
            conn.close()
        return [{"id": r["id"], "created_at": r["created_at"], "kind": r["kind"],
                 "payload": _db.loads(r["payload"], {})} for r in rows]

    def has_ticker_journal_snapshot(self, symbol: str, day: str) -> bool:
        """True if a 'snapshot' journal row for this symbol already exists whose
        created_at date == day — the nightly writer's idempotency guard."""
        if not self.uses_sqlite:
            return False
        conn = self._backend._conn()
        try:
            row = conn.execute(
                "SELECT 1 FROM ticker_journal WHERE symbol=? AND kind='snapshot' "
                "AND substr(created_at,1,10)=? LIMIT 1",
                (symbol.upper(), day[:10]),
            ).fetchone()
        finally:
            conn.close()
        return row is not None

    # -- sqlite txn helper --------------------------------------------------

    def _sqlite_txn(self):
        assert isinstance(self._backend, _SqliteBackend)
        self._backend._conn().close()  # ensure schema exists
        return self._backend.db.transaction()


def _json_list(path: Path) -> list:
    """Read a JSON array file, or [] when absent. Used by the JSON write paths
    that merge against the current file."""
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []
