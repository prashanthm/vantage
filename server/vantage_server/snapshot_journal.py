"""Nightly per-ticker journal snapshot — the auto-accruing side of the notebook.

For each held equity underlying, append one ``ticker_journal`` row of kind
``snapshot`` capturing today's price, unrealized P&L, and the decision-journal
recommendation/conviction. Run after ``analyze`` in the nightly pipeline so the
recommendation reflects the latest close. This is what makes each ticker's
notebook a running timeline "going forward".

Idempotent per day: if a snapshot row already exists for (symbol, today), that
symbol is skipped — a same-day rerun adds nothing. SQLite only (the notebook is
a real-data feature); a JSON data dir is a no-op with a notice.

    python -m vantage_server.snapshot_journal
    python -m vantage_server.snapshot_journal --as-of 2026-07-06 --dry-run

Like snapshot_bars / analyze, this is an operator CLI OUTSIDE the read-only
service surface — it writes only to our own SQLite (ADR-010 preserved: no broker,
no fund movement).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import sys
from pathlib import Path

from . import engine
from .quotes import get_provider
from .snapshot_bars import _underlying
from .store import Store, resolve_data_dir

EXIT_OK = 0
EXIT_ERR = 1


def _held_underlyings(lots) -> set[str]:
    """The set of plain equity underlyings held (skips options/sleeves/CUSIPs)."""
    out: set[str] = set()
    for l in lots:
        sym = l.symbol
        u = _underlying(sym)
        if u is None or u != sym:  # option contract / sleeve / non-ticker
            continue
        if sym.lstrip("-").isdigit():  # numeric CUSIP, not a listed ticker
            continue
        out.add(sym.upper())
    return out


def _recommendations_by_underlying(store: Store, day: str | None) -> dict[str, dict]:
    """{UNDERLYING: {recommendation, conviction}} from the latest analysis journal.

    Reads through the store (SQLite-aware) so it finds the decisions analyze
    persisted to vantage.db, not just JSON files."""
    journal = store.load_analysis_day(day)
    out: dict[str, dict] = {}
    for dec in (journal or {}).get("decisions", []):
        sym = str(dec.get("symbol") or "").upper()
        if not sym:
            continue
        conv = dec.get("conviction") or {}
        out[sym] = {
            "recommendation": dec.get("recommendation"),
            "conviction": conv.get("label"),
        }
    return out


def run(data_dir: str | Path | None = None, *, as_of: str | None = None,
        dry_run: bool = False) -> int:
    data_dir = resolve_data_dir(data_dir)
    store = Store(data_dir)
    if not store.uses_sqlite:
        print("snapshot_journal: SQLite backend required (notebook is a real-data "
              "feature) — nothing written.", file=sys.stderr)
        return EXIT_OK

    today = as_of or _dt.date.today().isoformat()
    now = f"{today}T00:00:00+00:00" if as_of else _dt.datetime.now(_dt.timezone.utc).isoformat()

    dataset = store.load_dataset()
    snap = get_provider(data_dir).snapshot()
    positions = engine.positions(dataset.lots, snap.quotes)
    recs = _recommendations_by_underlying(store, None)

    held = _held_underlyings(dataset.lots)
    wrote = skipped = 0
    for pos in positions:
        sym = pos.symbol.upper()
        if sym not in held:
            continue
        if store.has_ticker_journal_snapshot(sym, today):
            skipped += 1
            continue
        rec = recs.get(sym, {})
        payload = {
            "price": round(pos.value / pos.shares, 4) if pos.shares else None,
            "value": round(pos.value, 2),
            "unrl": round(pos.unrealized, 2),
            "recommendation": rec.get("recommendation"),
            "conviction": rec.get("conviction"),
        }
        if dry_run:
            print(f"[dry-run] {sym}: {payload}")
            continue
        store.append_ticker_journal(sym, "snapshot", payload, now=now)
        wrote += 1

    verb = "would write" if dry_run else "wrote"
    print(f"snapshot_journal ({today}): {verb} {wrote if not dry_run else len(held) - skipped} "
          f"snapshot(s), skipped {skipped} already-snapshotted.")
    return EXIT_OK


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.snapshot_journal",
        description="Append a per-ticker journal snapshot (price/P&L/recommendation) for each held underlying.",
    )
    p.add_argument("--as-of", help="ISO date to stamp (default: today)")
    p.add_argument("--data-dir", help="override the data directory")
    p.add_argument("--dry-run", action="store_true", help="print what would be written, write nothing")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    return run(args.data_dir, as_of=args.as_of, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
