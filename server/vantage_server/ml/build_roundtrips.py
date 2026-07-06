"""Round-trip build CLI — the fetch/persist layer around the pure engine.

Loads imported order history (data-local/history.json), FETCHES the account's
per-close realized-P/L history from the broker (READ-ONLY, ADR-010), loads the
deep daily bars, calls ml.roundtrips.reconstruct, and writes the labeled
round-trips + summary to <data_dir>/ml/roundtrips.json.

Like the importer and snapshot_bars, this is OUTSIDE the read-only service
surface: the REST API and MCP tools never write; only this operator-run command
does. The write MERGES by account (this account's round-trips are replaced,
others kept) and BACKS UP the previous file first (roundtrips.json.bak-<ISO>).

    # build round-trips for the margin account (default broker robinhood):
    python -m vantage_server.ml.build_roundtrips --account rh-margin --broker-account <N>
    # or resolve the broker account from history.json (broker_account column):
    python -m vantage_server.ml.build_roundtrips --account rh-margin

File shape:
    {"as_of", "account", "roundtrips": [ {RoundTrip...} ], "summary": {...}}
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from dataclasses import asdict
from pathlib import Path

from . import roundtrips as engine
from ..bars_view import BarsNotFound, load_bars_file
from ..brokers import CONNECTIONS, BrokerConnectionError, get_connection
from ..store import Store, StoreError, resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2


class BuildError(ValueError):
    """A build precondition failed (unknown account/broker, no history)."""


def roundtrips_path(data_dir: str | Path) -> Path:
    return Path(data_dir) / "ml" / "roundtrips.json"


def _resolve_broker_account(rows: list[dict], account: str) -> str | None:
    """The masked broker_account for ``account`` from history rows (e.g.
    '...9024'), or None. Only useful for the file provenance — the live fetch
    needs the FULL broker account number (--broker-account)."""
    for r in rows:
        if r.get("account") == account and r.get("broker_account"):
            return str(r["broker_account"])
    return None


def _bars_for(data_dir: str | Path, underlyings: set[str]) -> dict[str, list[dict]]:
    """Load the ``daily`` bar array for each underlying that has a bars file.
    Missing/malformed bars files are simply absent from the result (excursion
    is then skipped for those symbols — never fabricated)."""
    out: dict[str, list[dict]] = {}
    for sym in sorted(underlyings):
        try:
            data = load_bars_file(data_dir, sym)
        except BarsNotFound:
            continue
        daily = data.get("daily")
        if isinstance(daily, list) and daily:
            out[sym] = daily
    return out


def write_roundtrips(
    data_dir: str | Path, account: str, trips: list[engine.RoundTrip],
    summary: dict, *, as_of: str, now: _dt.datetime | None = None,
) -> tuple[Path, Path | None]:
    """Write ml/roundtrips.json, MERGING by account and backing up first.

    THIS account's previous round-trips are replaced; every other account's are
    kept (each row is tagged with ``account``). The previous file is ALWAYS
    backed up (roundtrips.json.bak-<ISO>). ``now`` is injectable for
    deterministic backup names. Returns (path, backup | None)."""
    now = now or _dt.datetime.now()
    ml_dir = Path(data_dir) / "ml"
    ml_dir.mkdir(parents=True, exist_ok=True)
    path = ml_dir / "roundtrips.json"

    existing_rows: list[dict] = []
    backup: Path | None = None
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                existing_rows = [r for r in (data.get("roundtrips") or [])
                                 if isinstance(r, dict)]
        except (json.JSONDecodeError, OSError):
            existing_rows = []
        stamp = now.isoformat(timespec="seconds").replace(":", "-")
        backup = path.with_name(f"roundtrips.json.bak-{stamp}")
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")

    kept = [r for r in existing_rows if r.get("account") != account]
    tagged = [{**asdict(t), "account": account} for t in trips]
    all_rows = tagged + kept

    payload = {
        "as_of": as_of,
        "account": account,
        "roundtrips": all_rows,
        "summary": summary,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path, backup


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.ml.build_roundtrips",
        description="Reconstruct labeled closed round-trips from order history + "
                    "realized-P/L history (read-only fetch, operator-side write).",
    )
    p.add_argument("--account", required=True,
                   help="Vantage account id to build round-trips for (e.g. rh-margin)")
    p.add_argument("--broker", default="robinhood",
                   help=f"broker connection ({', '.join(sorted(CONNECTIONS)) or 'none'})")
    p.add_argument("--broker-account", dest="broker_account", metavar="N",
                   help="broker-side account number for the live pnl fetch (required)")
    p.add_argument("--limit", type=int, default=500,
                   help="max realized-P/L close rows to fetch (default 500)")
    p.add_argument("--as-of", help="ISO date to stamp the build (default: today)")
    p.add_argument("--data-dir", help="override the data directory")
    p.add_argument("--dry-run", action="store_true",
                   help="fetch + reconstruct and print the summary, write nothing")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        return _run(args)
    except (BuildError, StoreError) as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_USER_ERROR


def _run(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args.data_dir)
    as_of = args.as_of or _dt.date.today().isoformat()

    if args.broker not in CONNECTIONS:
        raise BuildError(
            f"unknown broker {args.broker!r} (have: "
            f"{', '.join(sorted(CONNECTIONS)) or 'none'})")
    if not args.broker_account:
        raise BuildError(
            "--broker-account is required (the broker-side account number the "
            "realized-P/L history is fetched from)")

    store = Store(data_dir)
    all_history = store.load_history()
    orders = [r for r in all_history if r.get("account") == args.account]
    if not orders:
        raise BuildError(
            f"no order history for account '{args.account}' in "
            f"{data_dir / 'history.json'} — import it first "
            "(importer --with-history)")

    conn = get_connection(args.broker)()
    fetch_pnl = getattr(conn, "fetch_pnl_trade_history", None)
    if fetch_pnl is None:
        raise BuildError(
            f"{args.broker}: connection has no realized-P/L history capability")
    try:
        pnl_history = fetch_pnl(args.broker_account, limit=args.limit)
    except BrokerConnectionError as e:
        # Robinhood's realized-P/L endpoint transiently returns NotFound / empty.
        # Don't fail the (nightly) build: keep the last good roundtrips.json and
        # log a notice. A hard config error (bad account) still surfaces below as
        # zero round-trips from empty history, not here.
        existing = store.load_roundtrips().get("roundtrips")
        if existing:
            print(
                f"notice: {args.broker} realized-P/L history unavailable this run "
                f"({e}); keeping the existing {len(existing)} round-trip(s)",
                file=sys.stderr,
            )
            return EXIT_OK
        raise BuildError(f"{args.broker}: {e}") from e

    underlyings = {engine._underlying(r.get("symbol", "")) for r in orders}
    underlyings |= {engine._underlying(r.get("symbol", "")) for r in pnl_history}
    underlyings.discard("")
    bars_by_symbol = _bars_for(data_dir, underlyings)

    trips = engine.reconstruct(orders, pnl_history, bars_by_symbol=bars_by_symbol)
    summary = engine.summarize(trips)

    matched = sum(1 for t in trips if not t.entry_unknown)
    unknown = sum(1 for t in trips if t.entry_unknown)
    print(f"reconstructed {len(trips)} round-trip(s) for {args.account} "
          f"from {len(orders)} order(s) + {len(pnl_history)} realized close(s)")
    print(f"  matched to an open: {matched}   entry-unknown: {unknown}")
    print(f"  win_rate={summary['win_rate']}  profit_factor={summary['profit_factor']}  "
          f"avg_holding_days={summary['avg_holding_days']}  "
          f"avg_mfe_capture={summary['avg_mfe_capture']}")

    if args.dry_run:
        print(f"[dry-run] would write {roundtrips_path(data_dir)}; nothing written")
        return EXIT_OK

    path, backup = write_roundtrips(
        data_dir, args.account, trips, summary, as_of=as_of)
    print(f"wrote {path} ({len(trips)} round-trip(s))"
          + (f" (backup: {backup})" if backup else " (no previous file to back up)"))
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
