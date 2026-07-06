"""Migrate a JSON data-local directory into a single ``vantage.db`` (SQLite).

Reads every JSON artifact the store historically consumed — accounts, lots,
recent_buys, auto_buys, partner_map, quotes, signals, history, strategies, bars/
<SYM>.json, analysis/<DATE>.json, ml/roundtrips.json, ml/trade_stats.json, ml/
earnings/<SYM>.json — and writes them into the corresponding SQLite tables. The
JSON files are LEFT IN PLACE as a backup; nothing is deleted.

The migration is IDEMPOTENT: re-running upserts the same rows (accumulating
tables dedupe by natural key), so a second run is a no-op on the data. After
writing, it verifies row counts by re-reading through the Store's SQLite backend
and comparing against the JSON source, then prints a per-table report.

    python -m vantage_server.migrate_to_sqlite [--data-dir data-local] [--db vantage.db]

``--db`` may be a bare filename (written inside the data dir) or an absolute
path. Once the db exists in the data dir, the Store auto-selects the SQLite
backend for that directory (or point VANTAGE_DB at the file).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import db as _db
from .store import (
    Store,
    _JsonBackend,
    _empty_trade_stats,
    _normalize_roundtrips,
    _normalize_strategies,
    _normalize_trade_stats,
)

EXIT_OK = 0
EXIT_ERROR = 2


def _json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _json_list(path: Path) -> list:
    data = _json(path)
    return data if isinstance(data, list) else []


def migrate(data_dir: Path, db_path: Path) -> dict:
    """Read every JSON artifact under ``data_dir`` and write ``db_path``. Returns
    a {table: row_count} report."""
    database = _db.Database(db_path)
    database.init_schema()

    counts: dict[str, int] = {}

    # A store pinned to this db (VANTAGE_DB-independent) for the write methods.
    store = _sqlite_store(data_dir, db_path)

    # -- accumulating tables (real columns, natural-key upsert) -------------
    accounts = _json_list(data_dir / "accounts.json")
    if accounts:
        store.upsert_accounts(accounts)
    counts["accounts"] = len(accounts)

    lots = _json_list(data_dir / "lots.json")
    if lots:
        imported = sorted({l.get("account") for l in lots if isinstance(l, dict)})
        store.upsert_lots(imported, [l for l in lots if isinstance(l, dict)],
                          mode="replace")
    counts["lots"] = len(lots)

    recent_buys = _json_list(data_dir / "recent_buys.json")
    store.upsert_recent_buys([r for r in recent_buys if isinstance(r, dict)])
    counts["recent_buys"] = len(recent_buys)

    auto_buys = _json_list(data_dir / "auto_buys.json")
    store.upsert_auto_buys([r for r in auto_buys if isinstance(r, dict)])
    counts["auto_buys"] = len(auto_buys)

    partner_map = _json(data_dir / "partner_map.json")
    if isinstance(partner_map, dict):
        store.set_partner_map({str(k): str(v) for k, v in partner_map.items()})
        counts["partner_map"] = len(partner_map)
    else:
        counts["partner_map"] = 0

    history = _json_list(data_dir / "history.json")
    hist_rows = [r for r in history if isinstance(r, dict)]
    if hist_rows:
        # One accumulate write for ALL rows (dedupe by row_key); account tag is
        # already on each row, so pass a sentinel account (unused for sqlite).
        store.upsert_history("__all__", hist_rows)
    counts["history"] = len(hist_rows)

    # -- quotes -------------------------------------------------------------
    quotes_data = _json(data_dir / "quotes.json")
    if isinstance(quotes_data, dict) and isinstance(quotes_data.get("quotes"), dict):
        store.set_quotes(quotes_data["quotes"], as_of=quotes_data.get("as_of"))
        counts["quotes"] = len(quotes_data["quotes"])
    else:
        counts["quotes"] = 0

    # -- signals ------------------------------------------------------------
    signals = _json_list(data_dir / "signals.json")
    sig_rows = [r for r in signals if isinstance(r, dict)]
    if sig_rows:
        store.put_signals(sig_rows)
    counts["signals"] = len(sig_rows)

    # -- strategies (single snapshot) --------------------------------------
    strategies = _json(data_dir / "strategies.json")
    if isinstance(strategies, dict):
        norm = _normalize_strategies(strategies)
        store.put_strategies(norm)
        counts["strategies"] = (len(norm["open"]) + len(norm["closed"])
                                + len(norm["by_ticker"]))
    else:
        counts["strategies"] = 0

    # -- bars (one row per symbol) -----------------------------------------
    bars_dir = data_dir / "bars"
    n_bars = 0
    if bars_dir.is_dir():
        for p in sorted(bars_dir.glob("*.json")):
            if ".bak-" in p.name:
                continue
            data = _json(p)
            if not isinstance(data, dict):
                continue
            symbol = str(data.get("symbol") or p.stem).upper()
            series = {
                "daily": data.get("daily") or [],
                "weekly": data.get("weekly") or [],
                "monthly": data.get("monthly") or [],
            }
            store.put_bars(symbol, series, as_of=str(data.get("as_of") or ""),
                           lookback_days=int(data.get("lookback_days") or 0),
                           backfilled=bool(data.get("backfilled")))
            n_bars += 1
    counts["bars"] = n_bars

    # -- analysis (one row per day) ----------------------------------------
    analysis_dir = data_dir / "analysis"
    n_days = 0
    if analysis_dir.is_dir():
        for p in sorted(analysis_dir.glob("*.json")):
            if p.name == "latest.json" or ".bak-" in p.name:
                continue
            stem = p.stem
            data = _json(p)
            if not isinstance(data, dict):
                continue
            store.put_analysis(stem, {
                "as_of": data.get("as_of", stem),
                "generated_at": data.get("generated_at"),
                "decisions": data.get("decisions") or [],
            })
            n_days += 1
    counts["analysis"] = n_days

    # -- ml/roundtrips (single snapshot) -----------------------------------
    rt = _json(data_dir / "ml" / "roundtrips.json")
    if isinstance(rt, dict):
        norm = _normalize_roundtrips(rt)
        _put_roundtrips_snapshot(store, norm)
        counts["roundtrips"] = len(norm["roundtrips"])
    else:
        counts["roundtrips"] = 0

    # -- ml/trade_stats (single snapshot) ----------------------------------
    ts = _json(data_dir / "ml" / "trade_stats.json")
    if isinstance(ts, dict):
        norm = _normalize_trade_stats(ts)
        _put_trade_stats_snapshot(store, ts.get("account"), norm)
        counts["trade_stats"] = len(norm["by_account"]) or (1 if norm["as_of"] else 0)
    else:
        counts["trade_stats"] = 0

    # -- ml/earnings (one row per symbol) ----------------------------------
    earnings_dir = data_dir / "ml" / "earnings"
    n_earn = 0
    if earnings_dir.is_dir():
        for p in sorted(earnings_dir.glob("*.json")):
            if ".bak-" in p.name:
                continue
            data = _json(p)
            if not isinstance(data, dict):
                continue
            symbol = str(data.get("symbol") or p.stem).upper()
            store.put_earnings(symbol, data.get("earnings") or [],
                               data.get("dates") or [],
                               as_of=str(data.get("as_of") or ""))
            n_earn += 1
    counts["earnings"] = n_earn

    return counts


def _put_roundtrips_snapshot(store: Store, norm: dict) -> None:
    """Write the whole roundtrips snapshot verbatim (rows already carry their
    account tag), preserving as_of/summary."""
    with store._sqlite_txn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO roundtrips(id, as_of, account, roundtrips, summary) "
            "VALUES(1,?,?,?,?)",
            (norm["as_of"], None, _db.dumps(norm["roundtrips"]),
             _db.dumps(norm["summary"])),
        )


def _put_trade_stats_snapshot(store: Store, account, norm: dict) -> None:
    with store._sqlite_txn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO trade_stats"
            "(id, as_of, account, baseline_win_rate, featured, buckets, notable, by_account) "
            "VALUES(1,?,?,?,?,?,?,?)",
            (norm["as_of"], account, norm["baseline_win_rate"],
             _db.dumps(norm["featured"]), _db.dumps(norm["buckets"]),
             _db.dumps(norm["notable"]), _db.dumps(norm["by_account"])),
        )


def _sqlite_store(data_dir: Path, db_path: Path) -> Store:
    """A Store forced onto the SQLite backend for ``db_path``, regardless of env
    (used so migration writes the target db even before it 'exists' by the
    normal auto-selection rule)."""
    from .store import _SqliteBackend

    store = Store.__new__(Store)
    store.data_dir = data_dir
    store._db_path = db_path
    store._backend = _SqliteBackend(data_dir, db_path)
    return store


def verify(data_dir: Path, db_path: Path) -> tuple[bool, list[str]]:
    """Re-read through the SQLite backend and compare key row counts against the
    JSON source. Returns (ok, messages)."""
    json_store = Store.__new__(Store)
    json_store.data_dir = data_dir
    json_store._db_path = None
    json_store._backend = _JsonBackend(data_dir)

    sql_store = _sqlite_store(data_dir, db_path)

    checks = [
        ("accounts", lambda s: len(s.load_accounts())),
        ("lots", lambda s: len(s.load_lots())),
        ("recent_buys", lambda s: len(s.load_recent_buys())),
        ("auto_buys", lambda s: len(s.load_auto_buys())),
        ("partner_map", lambda s: len(s.load_partner_map())),
        ("history", lambda s: len(s.load_history())),
        ("signals", lambda s: len(s.load_signals())),
        ("roundtrips", lambda s: len(s.load_roundtrips()["roundtrips"])),
    ]
    ok = True
    msgs: list[str] = []
    for name, fn in checks:
        try:
            j = fn(json_store)
        except Exception:
            j = 0
        s = fn(sql_store)
        status = "OK" if j == s else "MISMATCH"
        if j != s:
            ok = False
        msgs.append(f"  {name:14} json={j:<6} sqlite={s:<6} {status}")
    return ok, msgs


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.migrate_to_sqlite",
        description="Migrate a JSON data-local dir into a single vantage.db "
                    "(SQLite). JSON files are left in place as a backup.",
    )
    p.add_argument("--data-dir", default="data-local",
                   help="the JSON data directory to migrate (default: data-local)")
    p.add_argument("--db", default=_db.DB_FILENAME,
                   help="target db path — a bare filename lands inside --data-dir "
                        f"(default: {_db.DB_FILENAME})")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    data_dir = Path(args.data_dir)
    if not data_dir.is_dir():
        print(f"error: {data_dir} is not a directory", file=sys.stderr)
        return EXIT_ERROR
    db_path = Path(args.db)
    if not db_path.is_absolute() and db_path.parent == Path("."):
        db_path = data_dir / db_path.name

    print(f"migrating {data_dir} -> {db_path}")
    counts = migrate(data_dir, db_path)

    total = sum(counts.values())
    print(f"\nmigrated {total} row(s) across {len(counts)} table(s):")
    for table in sorted(counts):
        print(f"  {table:14} {counts[table]}")

    size = db_path.stat().st_size if db_path.is_file() else 0
    print(f"\ndb file: {db_path} ({size:,} bytes)")

    ok, msgs = verify(data_dir, db_path)
    print("\nverification (json vs sqlite row counts):")
    for m in msgs:
        print(m)
    print("\nOK — counts match" if ok else "\nWARNING — some counts differ (see above)")
    print(f"\nJSON files left in place under {data_dir} (backup). "
          f"Point the store at SQLite via a vantage.db in {data_dir} or VANTAGE_DB.")
    return EXIT_OK if ok else EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
