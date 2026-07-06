"""Nightly EOD OHLCV snapshot CLI — the read-only bar sync.

Fetches daily bars from the broker (READ-ONLY, ADR-010), derives weekly &
monthly by resampling, and writes one file per symbol to
<data_dir>/bars/<SYMBOL>.json:

    {"symbol", "as_of", "lookback_days", "daily": [...], "weekly": [...],
     "monthly": [...]}

Like the importer, this is OUTSIDE the read-only service surface — the REST
API and MCP tools never write; only this operator-run command does. Each write
backs up the previous file (bars/<SYMBOL>.json.bak-<ISO>) first.

    # snapshot the tickers currently held (from lots.json):
    python -m vantage_server.snapshot_bars --broker robinhood --from-lots
    # or an explicit list:
    python -m vantage_server.snapshot_bars --broker robinhood SOXS SNK PLTR

Symbols come from --from-lots (unique lot symbols) and/or positional args.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from pathlib import Path

from . import bars as bars_engine
from .brokers import CONNECTIONS, BrokerConnectionError, get_connection
from .store import Store, StoreError, resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2


class SnapshotError(ValueError):
    """A snapshot precondition failed (no symbols, bad broker, no bars)."""


def write_bars(
    data_dir: str | Path, symbol: str, series: dict, *, as_of: str,
    lookback_days: int, now: _dt.datetime | None = None,
) -> tuple[Path, Path | None]:
    """Write bars/<SYMBOL>.json, backing up the previous file first.

    ``series`` is {"daily": [...], "weekly": [...], "monthly": [...]}. Returns
    (path, backup | None). ``now`` is injectable for deterministic backup names.
    """
    now = now or _dt.datetime.now()
    bars_dir = Path(data_dir) / "bars"
    bars_dir.mkdir(parents=True, exist_ok=True)
    path = bars_dir / f"{symbol.upper()}.json"
    backup: Path | None = None
    if path.is_file():
        stamp = now.isoformat(timespec="seconds").replace(":", "-")
        backup = path.with_name(f"{symbol.upper()}.json.bak-{stamp}")
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    payload = {
        "symbol": symbol.upper(),
        "as_of": as_of,
        "lookback_days": lookback_days,
        "daily": series["daily"],
        "weekly": series["weekly"],
        "monthly": series["monthly"],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path, backup


# Non-equity lot symbols that carry no chartable ticker.
_SLEEVE_SYMBOLS = frozenset({"CASH", "CRYPTO", "FUTURES"})


def _underlying(symbol: str) -> str | None:
    """The chartable equity underlying for a lot symbol, or None.

    Option display symbols are "<UND> <YYYY-MM-DD> <STRIKE><C|P>" (importer
    format) — the underlying is the first token. Sleeves (CASH/CRYPTO/FUTURES)
    have no equity chart. Plain tickers pass through.
    """
    sym = symbol.strip().upper()
    if not sym or sym in _SLEEVE_SYMBOLS:
        return None
    underlying = sym.split(" ", 1)[0]
    return underlying or None


def _symbols_from_lots(data_dir: Path) -> list[str]:
    lots = Store(data_dir).load_lots()
    seen: dict[str, None] = {}
    for lot in lots:
        underlying = _underlying(lot.symbol)
        if underlying is not None:
            seen.setdefault(underlying, None)
    return list(seen)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.snapshot_bars",
        description="Nightly EOD OHLCV snapshot (read-only). Fetches daily bars "
                    "and derives weekly/monthly.",
    )
    p.add_argument("symbols", nargs="*", help="ticker symbols to snapshot")
    p.add_argument("--broker", default="robinhood",
                   help=f"broker connection ({', '.join(sorted(CONNECTIONS)) or 'none'})")
    p.add_argument("--from-lots", action="store_true",
                   help="also snapshot every symbol held in lots.json")
    p.add_argument("--lookback-days", type=int, default=400,
                   help="daily bars to request back from today (default 400)")
    p.add_argument("--as-of", help="ISO date to stamp the snapshot (default: today)")
    p.add_argument("--data-dir", help="override the data directory")
    p.add_argument("--dry-run", action="store_true",
                   help="fetch and print a summary, write nothing")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        return _run(args)
    except (SnapshotError, StoreError) as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_USER_ERROR


def _run(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args.data_dir)
    today = (_dt.date.fromisoformat(args.as_of) if args.as_of else _dt.date.today())

    symbols: list[str] = [s.upper() for s in args.symbols]
    if args.from_lots:
        for s in _symbols_from_lots(data_dir):
            if s not in symbols:
                symbols.append(s)
    if not symbols:
        raise SnapshotError("no symbols — pass symbols positionally and/or --from-lots")

    if args.broker not in CONNECTIONS:
        raise SnapshotError(
            f"unknown broker {args.broker!r} (have: {', '.join(sorted(CONNECTIONS)) or 'none'})"
        )
    conn = get_connection(args.broker)()
    if not hasattr(conn, "fetch_historicals"):
        raise SnapshotError(f"{args.broker}: connection does not support historicals")

    try:
        snapshot = bars_engine.snapshot_bars(
            symbols, today=today, lookback_days=args.lookback_days,
            fetch=conn.fetch_historicals,
        )
    except BrokerConnectionError as e:
        raise SnapshotError(f"{args.broker}: {e}") from e

    as_of = today.isoformat()
    wrote = 0
    for symbol in symbols:
        series = snapshot.get(symbol, {"daily": [], "weekly": [], "monthly": []})
        n = len(series["daily"])
        if n == 0:
            print(f"warning: {symbol}: no bars returned — skipping", file=sys.stderr)
            continue
        summary = (f"{symbol}: {n} daily, {len(series['weekly'])} weekly, "
                   f"{len(series['monthly'])} monthly")
        if args.dry_run:
            print(f"[dry-run] {summary}")
            continue
        path, backup = write_bars(data_dir, symbol, series, as_of=as_of,
                                  lookback_days=args.lookback_days)
        wrote += 1
        print(f"wrote {path} ({summary})"
              + (f" (backup: {backup})" if backup else " (no previous file to back up)"))

    if not args.dry_run and wrote == 0:
        raise SnapshotError("no symbols produced bars — nothing written")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
