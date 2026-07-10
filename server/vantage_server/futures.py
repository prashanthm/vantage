"""Futures order-execution ingest + round-trip win-rate analysis (AMP/CQG).

Ingests an AMP Futures CSV export (order executions + the fuller order log),
normalizes the CQG contract codes, stores the fills idempotently, then DERIVES —
on read, never persisted — position-aware round-trips, dollar P&L, and a
win-rate-by-condition analysis (reusing the Bayesian bucketing engine in
``ml/buckets.py``). Because a windowed export can leave positions unpaired, the
analysis RECONCILES its computed P&L against the broker's authoritative realized
PnL and open position, and loudly flags any unmatched residual rather than
presenting a wrong win-rate as fact.

Decision-support only (ADR-008 context-not-signal). Reads the user's own exported
CSVs and writes only our SQLite store — no broker contact, no orders (ADR-010).

CLI: ``python -m vantage_server.futures --data-dir D --import ampfutures``.
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import glob
import io
import os
import sys
from collections import defaultdict, deque
from typing import Any

from .importer import _norm, _to_float  # reuse broker-CSV cell helpers
from .ml import buckets as _buckets
from .store import Store, resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2


class FuturesError(Exception):
    """A hard ingest error (bad header, unknown contract root)."""


# ── contract normalization ───────────────────────────────────────────────────

#: normalized contract -> dollars per 1.00 index point (E-mini NQ vs Micro NQ).
POINT_VALUES = {"NQ": 20.0, "MNQ": 2.0}
#: CQG root -> our normalized contract.
_ROOT_MAP = {"ENQ": "NQ", "MNQ": "MNQ"}
#: CME month letter -> month number.
_MONTH_CODE = {"F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
               "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12}
#: fills carry ET wall-clock timestamps (no tz in the export); confirmed with user.
FILL_TZ = "America/New_York"


def normalize_symbol(raw: str) -> dict:
    """Parse a CQG contract code like ``F.US.ENQU26`` into a normalized dict:
    ``{raw, contract, contract_month, point_value}``. Raises FuturesError on an
    unknown root so a mis-mapped contract can never silently corrupt dollar P&L
    (NQ and MNQ differ 10x)."""
    s = (raw or "").strip()
    body = s[5:] if s.upper().startswith("F.US.") else s
    # body = <ROOT><MONTHLETTER><YY>, e.g. ENQU26 -> root=ENQ, U, 26
    if len(body) < 4:
        raise FuturesError(f"unrecognized futures symbol: {raw!r}")
    yy = body[-2:]
    month_letter = body[-3:-2]
    root = body[:-3]
    contract = _ROOT_MAP.get(root.upper())
    if contract is None:
        raise FuturesError(f"unknown futures root {root!r} in {raw!r} "
                           f"(known: {sorted(_ROOT_MAP)})")
    contract_month = None
    mnum = _MONTH_CODE.get(month_letter.upper())
    if mnum and yy.isdigit():
        contract_month = f"20{yy}-{mnum:02d}"
    return {"raw": s, "contract": contract, "contract_month": contract_month,
            "point_value": POINT_VALUES[contract]}


# ── CSV parsing (by header NAME — the two AMP files differ in column order) ───

def _reader(text: str) -> tuple[csv.DictReader, dict]:
    """A DictReader plus a {normalized_header: original_key} map so we can look
    columns up by meaning regardless of exact casing/order."""
    r = csv.DictReader(io.StringIO(text))
    cols = {_norm(k): k for k in (r.fieldnames or [])}
    return r, cols


def _get(row: dict, cols: dict, *names: str) -> str | None:
    """First present value among the normalized column ``names``."""
    for nm in names:
        key = cols.get(nm)
        if key is not None:
            v = row.get(key)
            if v is not None and str(v).strip() != "":
                return str(v).strip()
    return None


def _bracket_extra(row: dict, cols: dict) -> dict:
    """Bracket prices (limit/stop/take-profit/stop-loss) preserved in `extra`."""
    return {
        "limit_price": _to_float(_get(row, cols, "limit price")),
        "stop_price": _to_float(_get(row, cols, "stop price")),
        "take_profit": _to_float(_get(row, cols, "take profit")),
        "stop_loss": _to_float(_get(row, cols, "stop loss")),
        "trailing_stop": _to_float(_get(row, cols, "trailing stop")),
    }


def parse_ampfutures_fills(text: str) -> tuple[list[dict], list[str]]:
    """Parse an AMP ``orders-filled`` (or the Filled subset of ``order-history``)
    export into normalized fill dicts. Header is matched by NAME, so the same
    parser handles both files despite their different column order. Returns
    ``(fills, warnings)``."""
    reader, cols = _reader(text)
    if "symbol" not in cols or "avg fill price" not in cols:
        raise FuturesError(
            "AMP fills CSV must have 'Symbol' and 'Avg fill price' columns; "
            f"got {sorted(cols)}")
    fills, warnings = [], []
    for n, row in enumerate(reader, start=2):
        raw = _get(row, cols, "symbol")
        if not raw:
            continue
        status = _get(row, cols, "status")
        if status is not None and status.lower() != "filled":
            continue  # order-history file carries cancels/rejects — skip non-fills
        px = _to_float(_get(row, cols, "avg fill price"))
        oid = _get(row, cols, "order id")
        if px is None or not oid:
            warnings.append(f"line {n}: missing fill price or order id — skipped")
            continue
        try:
            sym = normalize_symbol(raw)
        except FuturesError as e:
            warnings.append(f"line {n}: {e}")
            continue
        fills.append({
            "order_id": oid, "raw_symbol": sym["raw"], "contract": sym["contract"],
            "contract_month": sym["contract_month"], "point_value": sym["point_value"],
            "side": _get(row, cols, "side"),
            "order_type": _get(row, cols, "type"),
            "quantity": _to_float(_get(row, cols, "quantity")),
            "fill_quantity": _to_float(_get(row, cols, "fill quantity")),
            "avg_fill_price": px,
            "commission": _to_float(_get(row, cols, "commission")),
            "placing_time": _get(row, cols, "placing time"),
            "status_time": _get(row, cols, "status time"),
            "status": "Filled",
            "duration": _get(row, cols, "duration"),
            "extra": _bracket_extra(row, cols),
        })
    return fills, warnings


def parse_ampfutures_orders(text: str) -> tuple[list[dict], list[str]]:
    """Parse the full AMP ``order-history-all`` (every status) for order-behavior
    analysis. Returns ``(orders, warnings)``."""
    reader, cols = _reader(text)
    if "symbol" not in cols or "status" not in cols:
        raise FuturesError(
            "AMP order-history CSV must have 'Symbol' and 'Status' columns; "
            f"got {sorted(cols)}")
    orders, warnings = [], []
    for n, row in enumerate(reader, start=2):
        raw = _get(row, cols, "symbol")
        oid = _get(row, cols, "order id")
        if not raw or not oid:
            continue
        try:
            sym = normalize_symbol(raw)
        except FuturesError as e:
            warnings.append(f"line {n}: {e}")
            continue
        orders.append({
            "order_id": oid, "raw_symbol": sym["raw"], "contract": sym["contract"],
            "side": _get(row, cols, "side"),
            "order_type": _get(row, cols, "type"),
            "status": _get(row, cols, "status"),
            "quantity": _to_float(_get(row, cols, "quantity")),
            "fill_quantity": _to_float(_get(row, cols, "fill quantity")),
            "avg_fill_price": _to_float(_get(row, cols, "avg fill price")),
            "active_at": _get(row, cols, "active at"),
            "placing_time": _get(row, cols, "placing time"),
            "status_time": _get(row, cols, "status time"),
            "duration": _get(row, cols, "duration"),
            "extra": _bracket_extra(row, cols),
        })
    return orders, warnings


def parse_ampfutures_balances(text: str) -> dict:
    """The account-level realized PnL truth from ``amp-balances`` (skips the
    trailing ``TOTAL (USD)`` row). Returns ``{realized_pnl, balance,
    prev_balance}`` (values may be None if absent)."""
    reader, cols = _reader(text)
    for row in reader:
        cur = _get(row, cols, "currency") or ""
        if cur.upper().startswith("TOTAL"):
            continue  # summary row
        return {
            "realized_pnl": _to_float(_get(row, cols, "pnl")),
            "balance": _to_float(_get(row, cols, "account balance")),
            "prev_balance": _to_float(_get(row, cols, "prev day balance")),
        }
    return {"realized_pnl": None, "balance": None, "prev_balance": None}


def parse_ampfutures_positions(text: str) -> list[dict]:
    """Open positions from ``amp-net-positions`` → ``[{contract, signed_qty,
    avg_price, stop_loss, take_profit}]``. Side is 'Long'/'Short' here."""
    reader, cols = _reader(text)
    out = []
    for row in reader:
        raw = _get(row, cols, "symbol")
        if not raw:
            continue
        try:
            sym = normalize_symbol(raw)
        except FuturesError:
            continue
        qty = _to_float(_get(row, cols, "quantity")) or 0.0
        out.append({
            "contract": sym["contract"], "signed_qty": qty,
            "avg_price": _to_float(_get(row, cols, "avg price", "price")),
            "stop_loss": _to_float(_get(row, cols, "stop loss")),
            "take_profit": _to_float(_get(row, cols, "take profit")),
        })
    return out


# ── round-trip pairing (position-aware FIFO per contract) ────────────────────

def _parse_dt(s: str | None) -> _dt.datetime | None:
    if not s:
        return None
    try:
        return _dt.datetime.strptime(s.strip(), "%Y-%m-%d %H:%M:%S")
    except (ValueError, AttributeError):
        return None


def pair_roundtrips(fills: list[dict]) -> tuple[list[dict], dict]:
    """Pair fills into closed round-trips with a position-aware FIFO per contract,
    walking fills in ``status_time`` order. A fill on the opposite side of the
    current net position CLOSES the oldest open lot; a same-side fill opens/extends.

    Returns ``(roundtrips, leftover)`` where ``leftover[contract]`` is the signed
    unpaired residual (>0 net long, <0 net short) — the reconciliation lever. We
    never invent P&L for residual opens whose entry predates the export window.

    Each round-trip: ``{contract, point_value, direction ('long'|'short'),
    entry_time, exit_time, entry_price, exit_price, entry_type, exit_type,
    held_minutes, points, pnl_dollars, win}``."""
    ordered = sorted(fills, key=lambda f: (f.get("status_time") or "",
                                           str(f.get("order_id") or "")))
    open_lots: dict[str, deque] = defaultdict(deque)  # contract -> FIFO of open fills
    trips: list[dict] = []
    for f in ordered:
        c = f.get("contract")
        pv = float(f.get("point_value") or POINT_VALUES.get(c, 0.0))
        side = 1 if (f.get("side") or "").lower() == "buy" else -1
        lots = open_lots[c]
        # opposite side of current net position -> closes the oldest open lot
        if lots and (lots[0]["_dir"] * side < 0):
            entry = lots.popleft()
            direction = entry["_dir"]           # +1 long, -1 short
            entry_px = float(entry["avg_fill_price"])
            exit_px = float(f["avg_fill_price"])
            points = (exit_px - entry_px) * direction
            et = _parse_dt(entry.get("status_time"))
            xt = _parse_dt(f.get("status_time"))
            held = round((xt - et).total_seconds() / 60.0, 2) if (et and xt) else None
            trips.append({
                "contract": c, "point_value": pv,
                "direction": "long" if direction > 0 else "short",
                "entry_time": entry.get("status_time"),
                "exit_time": f.get("status_time"),
                "entry_price": entry_px, "exit_price": exit_px,
                "entry_type": entry.get("order_type"),
                "exit_type": f.get("order_type"),
                "held_minutes": held,
                "points": round(points, 4),
                "pnl_dollars": round(points * pv, 2),
                "win": points > 0,
            })
        else:
            lot = dict(f); lot["_dir"] = side
            lots.append(lot)
    leftover = {c: sum(l["_dir"] for l in lots) for c, lots in open_lots.items() if lots}
    return trips, leftover


# ── reconciliation against the broker's own numbers (the honesty layer) ──────

def reconcile(roundtrips: list[dict], leftover: dict, balances: dict,
              positions: list[dict]) -> dict:
    """Compare computed round-trip P&L + the unpaired residual against the
    broker's authoritative realized PnL and open position. A genuinely-open
    position that MATCHES the broker is expected (not a mismatch); an UNEXPECTED
    residual (closes whose opens predate the export) flips ``reconciled`` false
    and attaches a plain caveat so downstream never treats the numbers as fact."""
    computed = round(sum(t["pnl_dollars"] for t in roundtrips), 2)
    broker = balances.get("realized_pnl")
    expected_open: dict[str, float] = {}
    for p in positions or []:
        expected_open[p["contract"]] = expected_open.get(p["contract"], 0.0) + (p.get("signed_qty") or 0.0)

    unreconciled = []
    for c, resid in leftover.items():
        exp = expected_open.get(c, 0.0)
        if abs(resid - exp) > 1e-9:
            unreconciled.append({
                "contract": c, "fills_residual": resid, "broker_open": exp,
                "missing_fills_estimate": round(abs(resid - exp)),
            })

    delta = round(computed - broker, 2) if broker is not None else None
    pnl_ok = broker is not None and abs(computed - broker) <= 1.0
    reconciled = (not unreconciled) and bool(pnl_ok)

    caveat = None
    if not reconciled:
        parts = []
        if unreconciled:
            tot = sum(u["missing_fills_estimate"] for u in unreconciled)
            parts.append(
                f"The export is a WINDOW, not full history: ~{tot} closing fill(s) "
                "have opening fills from before the window, so those positions can't "
                "be paired here.")
        if broker is not None and not pnl_ok:
            parts.append(
                f"Computed round-trip P&L (${computed:,.0f}) does NOT match the "
                f"broker's realized PnL (${broker:,.0f}).")
        parts.append("Treat the win-rate/P&L below as a PARTIAL sample of the fully-"
                     "paired trades in-window, not the whole account. It improves as "
                     "you export more complete history.")
        caveat = " ".join(parts)

    return {
        "reconciled": reconciled,
        "computed_realized_pnl": computed,
        "broker_realized_pnl": broker,
        "delta": delta,
        "open_position_expected": expected_open,
        "open_position_from_fills": leftover,
        "unreconciled_contracts": unreconciled,
        "caveat": caveat,
    }


# ── featurization + analysis (reuse ml/buckets.py) ───────────────────────────

FUTURES_DIMENSIONS = ("exit_type", "direction", "contract",
                      "entry_hour_et", "hold_bucket", "playbook_align")


def _hold_bucket(minutes: float | None) -> str | None:
    if minutes is None:
        return None
    if minutes < 1:
        return "<1m"
    if minutes < 5:
        return "1-5m"
    if minutes < 30:
        return "5-30m"
    return "30m+"


def _exit_type_norm(t: str | None) -> str | None:
    if not t:
        return None
    tl = t.lower()
    if "stop loss" in tl:
        return "StopLoss"
    if "stop" in tl:
        return "Stop"
    if "limit" in tl:
        return "Limit"
    if "market" in tl:
        return "Market"
    return t


def feature_roundtrip(rt: dict, align: dict | None = None) -> dict:
    """Shape a round-trip into the dict ``ml.buckets`` consumes: top-level ``win``
    + ``realized_pnl``, plus a ``features`` dict of categorical values."""
    et = _parse_dt(rt.get("entry_time"))
    hour = str(et.hour) if et else None            # ET wall-clock (see FILL_TZ)
    pa = (align or {}).get(rt.get("entry_time"))    # 'with'|'against'|'neutral'|None
    return {
        "win": bool(rt["win"]),
        "realized_pnl": rt["pnl_dollars"],
        "features": {
            "exit_type": _exit_type_norm(rt.get("exit_type")),
            "direction": rt.get("direction"),
            "contract": rt.get("contract"),
            "entry_hour_et": hour,
            "hold_bucket": _hold_bucket(rt.get("held_minutes")),
            "playbook_align": pa,
        },
    }


def _overall(roundtrips: list[dict]) -> dict:
    n = len(roundtrips)
    wins = [t for t in roundtrips if t["win"]]
    losses = [t for t in roundtrips if not t["win"]]
    gw = sum(t["pnl_dollars"] for t in wins)
    gl = sum(t["pnl_dollars"] for t in losses)
    return {
        "n": n, "wins": len(wins), "losses": len(losses),
        "win_rate": round(len(wins) / n, 4) if n else None,
        "avg_win": round(gw / len(wins), 2) if wins else None,
        "avg_loss": round(gl / len(losses), 2) if losses else None,
        "gross_win": round(gw, 2), "gross_loss": round(gl, 2),
        "profit_factor": round(gw / abs(gl), 2) if gl else None,
        "total_pnl_dollars": round(gw + gl, 2),
        "total_points": round(sum(t["points"] for t in roundtrips), 2),
        "fees": "not in export (gross P&L)",
    }


def _order_behavior(orders: list[dict]) -> dict:
    """Cancel-rate + type mix from the full order log — the behavioral read."""
    if not orders:
        return {"available": False}
    total = len(orders)
    from collections import Counter
    status = Counter((o.get("status") or "").capitalize() for o in orders)
    cancelled = status.get("Cancelled", 0)
    filled = status.get("Filled", 0)
    stops = sum(1 for o in orders if "stop" in (o.get("order_type") or "").lower())
    return {
        "available": True,
        "total_orders": total,
        "filled": filled,
        "cancelled": cancelled,
        "rejected": status.get("Rejected", 0),
        "cancel_rate": round(cancelled / total, 4) if total else None,
        "stop_orders": stops,
        "note": (f"{cancelled} of {total} orders cancelled "
                 f"({round(100*cancelled/total)}%)" if total else ""),
    }


def analyze(fills: list[dict], orders: list[dict], balances: dict,
            positions: list[dict], *, align: dict | None = None) -> dict:
    """The full derived analysis: overall stats, win-rate-by-condition buckets,
    order behavior, and the reconciliation verdict. Pure over its inputs."""
    roundtrips, leftover = pair_roundtrips(fills)
    featured = [feature_roundtrip(rt, align) for rt in roundtrips]
    baseline = _buckets.baseline_win_rate(featured)
    bkts = _buckets.condition_buckets(featured, dimensions=FUTURES_DIMENSIONS)
    notable = _buckets.notable_buckets(bkts, baseline=baseline, min_n=3)
    return {
        "overall": _overall(roundtrips),
        "baseline_win_rate": baseline,
        "buckets": bkts,
        "notable": notable,
        "order_behavior": _order_behavior(orders),
        "reconciliation": reconcile(roundtrips, leftover, balances, positions),
        "roundtrips": roundtrips,
        "tz_note": "entry-hour buckets are ET wall-clock (broker export had no tz).",
    }


# ── playbook-alignment lens (NQ bars, reuse spx_playbook chart dims) ──────────

def playbook_alignment(fills: list[dict]) -> dict:
    """For each distinct entry timestamp, classify whether the entry agreed with
    the generic playbook (buy dips/sell rips toward S/R while mean-reverting vs
    fading momentum). Returns ``{entry_time: 'with'|'against'|'neutral'}``. Best-
    effort: if NQ bars aren't fetchable, returns {} and the dimension is omitted
    (never fabricated). Uses NQ=F 15m bars + the same VWAP/fractal-S/R dims as the
    SPX playbook."""
    try:
        from . import spx_playbook as sp
        df = sp._fetch_15m("NQ=F")
    except Exception:  # noqa: BLE001 — bars are optional context
        return {}
    if df is None or getattr(df, "empty", True):
        return {}
    try:
        import pandas as pd  # noqa: F401
        H = list(df["High"]); L = list(df["Low"]); C = list(df["Close"])
        ts = list(df.index)
        # rolling VWAP over the window (regime line), + fractal S/R clusters
        vol = list(df["Volume"]) if "Volume" in df else [1.0] * len(C)
        tp = [(H[i] + L[i] + C[i]) / 3 for i in range(len(C))]
        cum_pv = cum_v = 0.0
        vwap_at = []
        for i in range(len(C)):
            cum_pv += tp[i] * (vol[i] or 0.0); cum_v += (vol[i] or 0.0)
            vwap_at.append(cum_pv / cum_v if cum_v else C[i])
        ph, pl = sp._fractal_pivots(H, L, n=2)
        res = [z[0] for z in sp._cluster([H[i] for i in ph]) if z[1] >= 2]
        sup = [z[0] for z in sp._cluster([L[i] for i in pl]) if z[1] >= 2]
    except Exception:  # noqa: BLE001
        return {}

    def _bar_index(dt: _dt.datetime) -> int | None:
        # nearest 15m bar at or before the entry time (bars are ET tz-aware)
        best = None
        for i, t in enumerate(ts):
            tt = t.to_pydatetime().replace(tzinfo=None)
            if tt <= dt:
                best = i
            else:
                break
        return best

    tol = (C[-1] if C else 20000) * 0.0008  # ~0.08% cluster tolerance
    out: dict[str, str] = {}
    seen = set()
    for f in fills:
        key = f.get("status_time")
        if not key or key in seen:
            continue
        seen.add(key)
        dt = _parse_dt(key)
        if dt is None:
            continue
        bi = _bar_index(dt)
        if bi is None:
            continue
        price = float(f["avg_fill_price"])
        # NQ e-mini and MNQ trade the same index; MNQ fills use the same NQ bars.
        above_vwap = price > vwap_at[bi]
        side = (f.get("side") or "").lower()
        near_sup = any(abs(price - s) <= tol for s in sup)
        near_res = any(abs(price - r) <= tol for r in res)
        # WITH the playbook (mean-revert): buy a dip near support / sell a rip near
        # resistance. AGAINST: buy near resistance / sell near support (chasing).
        if side == "buy" and near_sup:
            out[key] = "with"
        elif side == "sell" and near_res:
            out[key] = "with"
        elif side == "buy" and near_res:
            out[key] = "against"
        elif side == "sell" and near_sup:
            out[key] = "against"
        else:
            out[key] = "neutral"
    return out


# ── CSV batch loading + import ───────────────────────────────────────────────

def _latest(pattern: str, base: str) -> str | None:
    matches = sorted(glob.glob(os.path.join(base, pattern)))
    return matches[-1] if matches else None


def load_ampfutures_dir(base: str) -> dict:
    """Read the AMP export directory → ``{fills, orders, balances, positions,
    warnings}``. Picks the latest file of each type by filename."""
    def _read(path: str | None) -> str:
        return open(path, encoding="utf-8-sig").read() if path else ""

    fills_txt = _read(_latest("amp-orders-filled-*.csv", base))
    hist_txt = _read(_latest("amp-order-history-all-*.csv", base))
    bal_txt = _read(_latest("amp-balances-*.csv", base))
    pos_txt = _read(_latest("amp-net-positions-*.csv", base))

    warnings: list[str] = []
    fills, w = (parse_ampfutures_fills(fills_txt) if fills_txt else ([], []))
    warnings += w
    orders, w = (parse_ampfutures_orders(hist_txt) if hist_txt else ([], []))
    warnings += w
    balances = parse_ampfutures_balances(bal_txt) if bal_txt else {}
    positions = parse_ampfutures_positions(pos_txt) if pos_txt else []
    return {"fills": fills, "orders": orders, "balances": balances,
            "positions": positions, "warnings": warnings}


def import_and_store(store: Store, base: str, *, account: str = "ampfutures",
                     dry_run: bool = False) -> dict:
    """Parse the AMP dir, store fills+orders (unless dry_run), persist the
    balances+positions snapshot for reconciliation. Returns counts + warnings."""
    data = load_ampfutures_dir(base)
    if not dry_run:
        store.record_futures_fills(data["fills"], account=account)
        store.record_futures_orders(data["orders"], account=account)
        store.put_futures_meta({"balances": data["balances"],
                                "positions": data["positions"]})
    return {"fills": len(data["fills"]), "orders": len(data["orders"]),
            "warnings": data["warnings"]}


def analysis_from_store(store: Store, *, contract: str | None = None,
                        with_alignment: bool = True) -> dict:
    """Load stored fills/orders + the reconcile meta, run the full analysis.
    The read-path used by the CLI and the API."""
    fills = store.load_futures_fills(contract)
    orders = store.load_futures_orders(contract)
    meta = store.load_futures_meta()
    balances = meta.get("balances") or {}
    positions = meta.get("positions") or []
    align = playbook_alignment(fills) if (with_alignment and fills) else {}
    return analyze(fills, orders, balances, positions, align=align)


# ============================================================ CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.futures",
        description="Ingest AMP futures order-execution CSVs and analyze win rate "
                    "(round-trips paired from fills; reconciled against the broker's "
                    "realized PnL). Decision-support, not a signal; no orders.")
    p.add_argument("--data-dir", help="override the data directory (where the db lives)")
    p.add_argument("--import", dest="import_dir", metavar="SUBDIR",
                   help="import CSVs from <data-dir>/<SUBDIR> (e.g. 'ampfutures')")
    p.add_argument("--account", default="ampfutures", help="logical account tag")
    p.add_argument("--contract", help="restrict analysis to one contract (NQ|MNQ)")
    p.add_argument("--no-alignment", action="store_true",
                   help="skip the NQ-bar playbook-alignment lens (faster/offline)")
    p.add_argument("--dry-run", action="store_true", help="parse + analyze, write nothing")
    p.add_argument("--json", action="store_true", help="print the analysis as JSON")
    return p


def _fmt_pct(x) -> str:
    return f"{100*x:.0f}%" if x is not None else "—"


def _print_human(analysis: dict) -> None:
    rec = analysis["reconciliation"]
    ov = analysis["overall"]
    if not rec["reconciled"]:
        print("\n⚠️  PARTIAL DATA — numbers are a sample, not the whole account:")
        print("    " + (rec["caveat"] or ""))
    print(f"\nRound-trips (fully paired in-window): {ov['n']}")
    print(f"  win rate {_fmt_pct(ov['win_rate'])} | profit factor {ov['profit_factor']} "
          f"| net ${ov['total_pnl_dollars']:,.0f} (gross of fees)")
    print(f"  avg win ${ov['avg_win']} | avg loss ${ov['avg_loss']}")
    print(f"  computed P&L ${rec['computed_realized_pnl']:,.0f} vs broker realized "
          f"${rec['broker_realized_pnl']:,.0f}" if rec['broker_realized_pnl'] is not None
          else "")
    ob = analysis["order_behavior"]
    if ob.get("available"):
        print(f"  order behavior: {ob['note']}; {ob['stop_orders']} stop orders")
    notable = analysis["notable"]
    if notable:
        print("\nStatistically-notable conditions (vs your average):")
        for b in notable[:12]:
            kind = "EDGE" if b.get("kind") == "edge" else "LEAK"
            print(f"  [{kind}] {b['dimension']}={b['value']}: {_fmt_pct(b['win_rate'])} "
                  f"win (n={b['n']}, net ${b['total_pnl']:,.0f})")
    else:
        print("\nNo statistically-notable condition buckets yet (need n>=3 with a "
              "clearly-separated win rate).")


def _run(args: argparse.Namespace) -> int:
    data_dir = resolve_data_dir(args.data_dir)
    store = Store(data_dir)
    if not getattr(store, "uses_sqlite", False):
        print("error: futures ingest requires the SQLite backend (a vantage.db)",
              file=sys.stderr)
        return EXIT_USER_ERROR

    if args.import_dir:
        base = os.path.join(str(data_dir), args.import_dir)
        if not os.path.isdir(base):
            print(f"error: import dir not found: {base}", file=sys.stderr)
            return EXIT_USER_ERROR
        res = import_and_store(store, base, account=args.account, dry_run=args.dry_run)
        tag = "[dry-run] parsed" if args.dry_run else "imported"
        print(f"{tag} {res['fills']} fills, {res['orders']} order-log rows")
        for w in res["warnings"][:10]:
            print(f"  warning: {w}")
        if args.dry_run:
            # analyze straight from the freshly-parsed (unsaved) data
            data = load_ampfutures_dir(base)
            align = ({} if args.no_alignment else playbook_alignment(data["fills"]))
            analysis = analyze(data["fills"], data["orders"], data["balances"],
                               data["positions"], align=align)
        else:
            analysis = analysis_from_store(store, contract=args.contract,
                                           with_alignment=not args.no_alignment)
    else:
        analysis = analysis_from_store(store, contract=args.contract,
                                       with_alignment=not args.no_alignment)

    if args.json:
        import json
        print(json.dumps(analysis, indent=2, default=str))
    else:
        _print_human(analysis)
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        return _run(args)
    except FuturesError as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_USER_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
