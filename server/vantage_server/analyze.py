"""Nightly position analyzer + decision journal — the I/O / orchestration layer.

This is the nightly job that applies the covered-call / cost-reduction playbook
(income.py — PURE) to every open position and PERSISTS a deterministic decision
record per position. Like snapshot_bars and the importer, it lives OUTSIDE the
read-only service surface (ADR-010): the REST API and MCP tools only READ the
journal it writes; only this operator-run command writes.

Pipeline (all I/O is here; the analyzer stays pure):
  1. Load the position universe: strategies.json (by_ticker book) + lots.json
     (equity holdings). Each open underlying is a position.
  2. For each held underlying, load its EOD bars from <data_dir>/bars/<UND>.json
     (written by snapshot_bars — analyze DEPENDS on these; it does NOT refetch).
     Missing bars fail clearly, telling the operator to run snapshot_bars first.
  3. current_price = the underlying's last daily close (the EOD read).
  4. multi_timeframe_read(daily, weekly, monthly) per underlying (technicals).
  5. wash_status(symbol) per underlying (engine) — the wash gate.
  6. analyze_portfolio(...) -> [PositionDecision].
  7. WRITE an APPEND-ONLY journal <data_dir>/analysis/<YYYY-MM-DD>.json =
     {as_of, decisions:[...]} — one file per day, idempotent (a same-day rerun
     backs up then overwrites THAT day's file; prior days are never touched) —
     and update <data_dir>/analysis/latest.json to point at the newest day.

    python -m vantage_server.analyze [--as-of DATE] [--data-dir DIR]

We do NOT fetch a live option chain: est_credit is the deterministic proxy in
income.py (flagged estimated=True). Keeping the nightly job chain-free keeps it
free of the option-chain network/auth path — the analyzer takes strike
candidates (distance_to_resistance rows) as an argument, so a future live-chain
wiring drops in without touching the pure engine.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from pathlib import Path

from . import engine
from . import income
from . import technicals as tech_engine
from .snapshot_bars import _underlying
from .store import Store, StoreError, resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2

ANALYSIS_DIRNAME = "analysis"
LATEST_FILENAME = "latest.json"


class AnalyzeError(ValueError):
    """An analysis precondition failed (missing bars, no positions)."""


# ------------------------------------------------------------- bars loading

def load_bars(data_dir: str | Path, underlying: str) -> dict:
    """Load <data_dir>/bars/<UND>.json written by snapshot_bars.

    Returns {"symbol", "as_of", "daily", "weekly", "monthly"}. Raises
    AnalyzeError (with the fix instruction) when the file is missing — analyze
    consumes the snapshot's output and must never silently refetch.
    """
    path = Path(data_dir) / "bars" / f"{underlying.upper()}.json"
    if not path.is_file():
        raise AnalyzeError(
            f"no bars for {underlying} at {path} — run "
            f"'python -m vantage_server.snapshot_bars --from-lots' first"
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise AnalyzeError(f"{path}: invalid JSON ({e})") from e
    for key in ("daily", "weekly", "monthly"):
        if not isinstance(data.get(key), list):
            raise AnalyzeError(f"{path}: missing or malformed '{key}' bars")
    return data


def current_price_from_bars(bars: dict) -> float:
    """The EOD read: the last daily close. Raises when there is no daily bar."""
    daily = bars.get("daily") or []
    if not daily:
        raise AnalyzeError(f"{bars.get('symbol')}: no daily bars — cannot price")
    return float(daily[-1]["close"])


# --------------------------------------------------- position universe

def _equity_holdings_by_symbol(lots) -> dict[str, dict]:
    """Aggregate plain-equity lots into {symbol: {shares, avg_cost}} — options
    (symbols with a space) and sleeves (CASH/CRYPTO/FUTURES) are excluded; those
    are covered by the option book / not chartable."""
    agg: dict[str, dict] = {}
    for lot in lots:
        sym = lot.symbol
        if " " in sym or _underlying(sym) is None or _underlying(sym) != sym:
            continue  # option display symbol or sleeve, not a plain equity
        entry = agg.setdefault(sym, {"shares": 0.0, "cost": 0.0})
        entry["shares"] += lot.shares
        entry["cost"] += lot.shares * lot.cost_per_share
    out: dict[str, dict] = {}
    for sym, e in agg.items():
        shares = e["shares"]
        out[sym] = {
            "shares": shares,
            "avg_cost": (e["cost"] / shares) if shares else 0.0,
        }
    return out


def build_positions_ctx(
    data_dir: str | Path, *, today: _dt.date, weekly_expiry_dte: int = 7,
) -> list[dict]:
    """Assemble the per-position context the analyzer consumes.

    Universe = every open underlying in the option position book (by_ticker)
    UNION every plain-equity holding. For each, load bars, price it off the last
    daily close, compute the multi-timeframe read + distance_to_resistance
    candidates + wash status. Raises AnalyzeError listing any underlyings whose
    bars are missing.
    """
    store = Store(data_dir)
    dataset = store.load_dataset()
    rollup = store.load_strategies()

    book_by_symbol: dict[str, dict] = {}
    for row in rollup.get("by_ticker", []):
        und = str(row.get("underlying") or "").upper()
        if und and row.get("status") == "open":
            book_by_symbol[und] = row
    equity_by_symbol = _equity_holdings_by_symbol(dataset.lots)

    symbols = sorted(set(book_by_symbol) | set(equity_by_symbol))
    if not symbols:
        raise AnalyzeError("no open positions found (no by_ticker book, no equity lots)")

    missing: list[str] = []
    ctxs: list[dict] = []
    for sym in symbols:
        try:
            bars = load_bars(data_dir, sym)
        except AnalyzeError:
            missing.append(sym)
            continue
        current_price = current_price_from_bars(bars)
        tech = tech_engine.multi_timeframe_read(
            bars["daily"], bars["weekly"], bars["monthly"],
            current_price=current_price,
        )
        candidates = tech_engine.distance_to_resistance(bars["daily"], current_price)
        wash = engine.wash_status(
            sym,
            accounts=dataset.accounts,
            recent_buys=dataset.recent_buys,
            auto_buys=dataset.auto_buys,
            today=_dt.datetime(today.year, today.month, today.day),
        )
        ctxs.append({
            "symbol": sym,
            "ticker_book": book_by_symbol.get(sym),
            "equity_holding": equity_by_symbol.get(sym),
            "current_price": current_price,
            "tech": tech,
            "wash": wash,
            "strike_candidates": candidates,
            "weekly_expiry_dte": weekly_expiry_dte,
        })

    if missing:
        raise AnalyzeError(
            "missing bars for: " + ", ".join(missing)
            + " — run 'python -m vantage_server.snapshot_bars --from-lots' first"
        )
    return ctxs


# --------------------------------------------------------------- journal I/O

def write_journal(
    data_dir: str | Path, as_of: str, decisions: list[income.PositionDecision],
    *, now: _dt.datetime | None = None,
) -> tuple[Path, Path | None, Path]:
    """Write the APPEND-ONLY per-day journal and refresh latest.json.

    <data_dir>/analysis/<as_of>.json = {as_of, decisions:[...]}. One file per
    day: a same-day rerun BACKS UP that day's file (…json.bak-<ISO>) then
    overwrites it; prior days' files are never read or written. latest.json is
    rewritten to the newest day present in the directory. Returns
    (day_path, backup | None, latest_path).
    """
    now = now or _dt.datetime.now()

    from .store import Store
    store = Store(data_dir)
    if store.uses_sqlite:
        payload = {
            "as_of": as_of,
            "generated_at": now.isoformat(timespec="seconds"),
            "decisions": [income.decision_to_dict(d) for d in decisions],
        }
        store.put_analysis(as_of, payload)
        # No filesystem day/latest files under SQLite; report symbolic paths.
        db_path = Path(data_dir) / "vantage.db"
        return db_path, None, db_path

    analysis_dir = Path(data_dir) / ANALYSIS_DIRNAME
    analysis_dir.mkdir(parents=True, exist_ok=True)

    day_path = analysis_dir / f"{as_of}.json"
    backup: Path | None = None
    if day_path.is_file():
        stamp = now.isoformat(timespec="seconds").replace(":", "-")
        backup = day_path.with_name(f"{as_of}.json.bak-{stamp}")
        backup.write_text(day_path.read_text(encoding="utf-8"), encoding="utf-8")

    payload = {
        "as_of": as_of,
        "generated_at": now.isoformat(timespec="seconds"),
        "decisions": [income.decision_to_dict(d) for d in decisions],
    }
    day_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    latest_path = _refresh_latest(analysis_dir)
    return day_path, backup, latest_path


def _day_files(analysis_dir: Path) -> list[str]:
    """The YYYY-MM-DD day keys present (json files, excluding latest and backups)."""
    days: list[str] = []
    for p in analysis_dir.glob("*.json"):
        if p.name == LATEST_FILENAME:
            continue
        stem = p.name[:-len(".json")]
        try:
            _dt.date.fromisoformat(stem)
        except ValueError:
            continue  # not a plain day file (e.g. a .bak-... would not match .json anyway)
        days.append(stem)
    return sorted(days)


def _refresh_latest(analysis_dir: Path) -> Path:
    """Point latest.json at the newest day file's content."""
    latest_path = analysis_dir / LATEST_FILENAME
    days = _day_files(analysis_dir)
    if not days:
        return latest_path
    newest = days[-1]
    content = (analysis_dir / f"{newest}.json").read_text(encoding="utf-8")
    latest_path.write_text(content, encoding="utf-8")
    return latest_path


# ------------------------------------------------------------- journal reads
# (used by the API/MCP surface — read-only)

def load_day(data_dir: str | Path, day: str | None = None) -> dict | None:
    """Load one day's journal (or the latest when ``day`` is None). Returns the
    parsed {as_of, decisions:[...]} dict, or None when there is no such day /
    no journal at all. TOLERANT of a missing directory."""
    analysis_dir = Path(data_dir) / ANALYSIS_DIRNAME
    if not analysis_dir.is_dir():
        return None
    if day is None:
        path = analysis_dir / LATEST_FILENAME
        if not path.is_file():
            days = _day_files(analysis_dir)
            if not days:
                return None
            path = analysis_dir / f"{days[-1]}.json"
    else:
        path = analysis_dir / f"{day}.json"
        if not path.is_file():
            return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def load_symbol_history(data_dir: str | Path, symbol: str) -> list[dict]:
    """Every journaled decision for ``symbol`` across all days, newest first —
    the trail Mira reads. Each element is {as_of, decision:{...}}."""
    analysis_dir = Path(data_dir) / ANALYSIS_DIRNAME
    if not analysis_dir.is_dir():
        return []
    want = symbol.upper()
    trail: list[dict] = []
    for day in _day_files(analysis_dir):
        try:
            data = json.loads((analysis_dir / f"{day}.json").read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for dec in data.get("decisions", []):
            if str(dec.get("symbol", "")).upper() == want:
                trail.append({"as_of": data.get("as_of", day), "decision": dec})
    trail.sort(key=lambda r: str(r.get("as_of") or ""), reverse=True)
    return trail


# --------------------------------------------------------------------- CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.analyze",
        description="Nightly position analyzer + decision journal (read-only "
                    "reads; writes the analysis journal). Depends on bars files "
                    "written by snapshot_bars.",
    )
    p.add_argument("--as-of", help="ISO date to stamp/journal (default: today)")
    p.add_argument("--data-dir", help="override the data directory")
    p.add_argument("--weekly-dte", type=int, default=7,
                   help="target DTE for the weekly covered call (default 7)")
    p.add_argument("--dry-run", action="store_true",
                   help="analyze and print a summary, write no journal")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        return _run(args)
    except (AnalyzeError, StoreError) as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_USER_ERROR


def _run(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args.data_dir)
    today = _dt.date.fromisoformat(args.as_of) if args.as_of else _dt.date.today()
    as_of = today.isoformat()

    ctxs = build_positions_ctx(data_dir, today=today, weekly_expiry_dte=args.weekly_dte)
    decisions = income.analyze_portfolio(ctxs, today=today)

    for d in decisions:
        line = f"{d.symbol:6} {d.conviction.label:8} -> {d.recommendation}"
        detail = d.action_detail
        if detail and detail.get("kind") == "sell_call":
            line += (f"  strike={detail['suggested_strike']} "
                     f"credit=${detail['est_credit']:,.0f} "
                     f"basis {detail['current_net_cost']:,.0f}->"
                     f"{detail['projected_net_cost']:,.0f}")
        elif detail and detail.get("kind") == "close":
            line += (f"  loss=${detail['unrealized_loss']:,.0f} "
                     f"wash_blocked={detail['wash_blocked']}")
        print(line)

    if args.dry_run:
        print(f"[dry-run] {len(decisions)} decisions for {as_of} — nothing written")
        return EXIT_OK

    day_path, backup, latest_path = write_journal(data_dir, as_of, decisions)
    print(f"wrote {day_path} ({len(decisions)} decisions)"
          + (f" (backup: {backup})" if backup else " (no previous file to back up)"))
    print(f"updated {latest_path}")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
