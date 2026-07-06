"""Pure round-trip reconstruction + labeling — the trade-analysis foundation.

Given raw broker orders (the history-row contract) and per-close realized-gain
rows (get_pnl_trade_history), reconstruct LABELED closed round-trips: each a
matched open->close pair carrying the authoritative signed realized P/L, a
win/loss flag, and MFE/MAE excursion measured from daily bars. Everything here
is PURE — no network, no disk, no clock — so it is deterministic and fully
testable offline. The I/O (fetch pnl history, load bars, write json) lives in
build_roundtrips.py.

THE LABEL SOURCE. ``pnl_history`` (robinhood.fetch_pnl_trade_history) is
authoritative: each row is one CLOSE with a SIGNED ``realized_gain`` — the
dollar P/L Robinhood actually booked. We never recompute win/loss from prices;
we read it from realized_gain (win == realized_gain > 0). Orders supply the
entry side of the round-trip (open date, entry price, order ids); the pnl row
supplies the close and the label.

THE OPEN<->CLOSE MATCHING HEURISTIC. A realized_gain row is a CLOSE of some
key (see below). We walk pnl rows OLDEST-first and, for each, pop the most
recent still-open opening order of the same key whose timestamp is at or before
the close (a FIFO-ish "most-recent prior open" pairing — a close realizes the
position you were most recently holding). Concretely, per key we keep a stack
of open lots (buys for equities / opening orders for options) ordered by time;
a close pops the latest open at/under the close time. When no open can be
paired (history truncated before the open, or an option leg whose open predates
the fetched window), the round-trip is STILL EMITTED with the realized_gain and
``entry_unknown=True`` and best-effort None entry fields — never dropped, never
fabricated.

THE KEY. Options key on the DISPLAY symbol ("UND YYYY-MM-DD 750C") so a
specific contract's open pairs to its own close and not a different strike's.
Equities key on the plain symbol. The pnl row carries only the UNDERLYING, so
for options we resolve its key by choosing, among that underlying's currently
open contracts at the close time, the oldest open (FIFO) — documented as a
best-effort resolution since pnl rows don't name the contract.

MFE/MAE (max favorable / adverse excursion). From bars_by_symbol[underlying]
daily bars strictly within [open_date, close_date], MFE is the best price move
in the trade's favor (highest high for a long, lowest low for a short) and MAE
the worst, both expressed as SIGNED $ per unit against entry_price and as a pct
of entry cost basis. mfe_capture = realized_pnl / mfe_dollars (did you leave
money on the table?). For OPTIONS we use the UNDERLYING's bars as a proxy (the
option's own marks aren't in bars) and set proxy=True. When bars are missing or
the entry price is unknown, excursion fields are None (skipped, never guessed).
"""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass


@dataclass(frozen=True)
class RoundTrip:
    """One reconstructed, labeled closed round-trip.

    ``realized_pnl`` is the AUTHORITATIVE signed dollar P/L from the pnl row.
    ``win`` is realized_pnl > 0. Entry fields are None when the open could not
    be paired (``entry_unknown``); excursion fields are None when bars were
    missing or the entry was unknown. For options ``proxy`` marks that MFE/MAE
    came from the underlying's bars, not the contract's own marks."""
    symbol: str                       # underlying (equities: the ticker)
    kind: str                         # "equity" | "option"
    open_date: str | None             # ISO date of the paired open, or None
    close_date: str                   # ISO date of the close
    holding_days: int | None          # close_date - open_date in days, or None
    entry_price: float | None         # per-unit entry (share / contract), or None
    exit_price: float | None          # per-unit exit from the pnl row, or None
    quantity: float                   # closed quantity (shares / contracts)
    contracts_or_shares: str          # "shares" | "contracts"
    realized_pnl: float               # SIGNED $ — the label
    realized_pct: float | None        # realized_pnl / entry cost basis, or None
    win: bool                         # realized_pnl > 0
    mfe: float | None                 # max favorable excursion, SIGNED $ (>=0)
    mae: float | None                 # max adverse excursion, SIGNED $ (<=0)
    mfe_pct: float | None             # mfe as pct of entry cost basis
    mae_pct: float | None             # mae as pct of entry cost basis
    mfe_capture: float | None         # realized_pnl / mfe ($), or None
    proxy: bool                       # MFE/MAE from underlying bars (options)
    entry_unknown: bool               # True when no open could be paired
    open_order_id: str | None         # order id of the paired open, or None
    close_order_id: str | None        # id of the close (pnl rows rarely carry one)


# ---------------------------------------------------------------- helpers

_MULTIPLIER = 100.0  # option contract multiplier (shares per contract)


def _parse_date(value) -> _dt.date | None:
    """ISO timestamp/date -> date, or None. Tolerates trailing Z and bare dates."""
    if not value:
        return None
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return _dt.datetime.fromisoformat(text).date()
    except ValueError:
        try:
            return _dt.date.fromisoformat(text[:10])
        except ValueError:
            return None


def _parse_ts(value) -> _dt.datetime | None:
    """ISO timestamp -> aware/naive datetime for ordering, or None."""
    if not value:
        return None
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = _dt.datetime.fromisoformat(text)
    except ValueError:
        d = _parse_date(value)
        return _dt.datetime(d.year, d.month, d.day) if d else None
    # normalize to naive UTC-ish for cross-row comparison (drop tzinfo)
    return dt.replace(tzinfo=None)


def _underlying(symbol: str) -> str:
    """The equity underlying of a symbol: first token of an option display
    symbol ("SPY 2026-07-17 750C" -> "SPY"), else the symbol itself."""
    return str(symbol or "").strip().upper().split(" ", 1)[0]


def _is_option_symbol(symbol: str) -> bool:
    return " " in str(symbol or "").strip()


# ------------------------------------------------------- open bookkeeping

@dataclass
class _Open:
    """A still-open opening order awaiting a matching close."""
    key: str
    underlying: str
    kind: str            # "equity" | "option"
    date: _dt.date | None
    ts: _dt.datetime | None
    price: float | None  # per-unit entry (share / per-contract $)
    quantity: float
    order_id: str | None


def _opening_orders(orders: list[dict]) -> dict[str, list[_Open]]:
    """Index FILLED opening orders (equity buys / option opens) by key, each
    key's list ordered OLDEST-first.

    Equity opens: side == "buy", kind "equity" (a buy opens/adds a long).
    Option opens: kind "option", side == "buy" (a bought-to-open long leg) —
    the description carries "open"; we treat buy-side option legs as opens.
    Cancelled/unfilled orders (state != "filled") are ignored. The per-contract
    entry price for an option is price * multiplier (price is per-share)."""
    by_key: dict[str, list[_Open]] = {}
    for o in orders:
        if not isinstance(o, dict):
            continue
        if str(o.get("state") or "").lower() != "filled":
            continue
        kind = str(o.get("kind") or "")
        side = str(o.get("side") or "").lower()
        symbol = str(o.get("symbol") or "")
        if not symbol:
            continue
        if kind == "equity":
            if side != "buy":
                continue
            key = _underlying(symbol)
            price = o.get("price")
            entry = float(price) if price not in (None, "") else None
        elif kind == "option":
            # a bought-to-open long leg opens a position; short opens are not
            # round-tripped as long trades (their close is a buy-to-close whose
            # realized gain the pnl feed still books under the underlying).
            if side != "buy":
                continue
            key = symbol  # full display symbol keys the specific contract
            price = o.get("price")
            entry = float(price) * _MULTIPLIER if price not in (None, "") else None
        else:
            continue
        by_key.setdefault(key, []).append(_Open(
            key=key,
            underlying=_underlying(symbol),
            kind=kind,
            date=_parse_date(o.get("date")),
            ts=_parse_ts(o.get("date")),
            price=entry,
            quantity=abs(float(o.get("quantity") or 0.0)),
            order_id=o.get("order_id") or o.get("id"),
        ))
    for opens in by_key.values():
        opens.sort(key=lambda x: (x.ts or _dt.datetime.min))
    return by_key


def _pop_open(
    opens_by_key: dict[str, list[_Open]], key: str, close_ts: _dt.datetime | None,
) -> _Open | None:
    """Pop the most-recent open of ``key`` at or before ``close_ts`` (the
    position the close realizes). Removes it so it can't pair twice."""
    opens = opens_by_key.get(key)
    if not opens:
        return None
    chosen_idx = None
    for i, op in enumerate(opens):
        if close_ts is None or op.ts is None or op.ts <= close_ts:
            chosen_idx = i  # keep advancing to the most-recent eligible open
    if chosen_idx is None:
        return None
    return opens.pop(chosen_idx)


def _resolve_option_key(
    opens_by_key: dict[str, list[_Open]], underlying: str,
    close_ts: _dt.datetime | None,
) -> str | None:
    """A pnl row names only the underlying; pick the option contract key to
    pair its close with. Best-effort: among that underlying's still-open option
    contracts opened at/before the close, choose the OLDEST open (FIFO) — the
    contract most likely being closed. Returns the display-symbol key or None."""
    best_key = None
    best_ts = None
    for key, opens in opens_by_key.items():
        if not opens or not _is_option_symbol(key):
            continue
        if _underlying(key) != underlying:
            continue
        op = opens[0]  # oldest open of this contract
        if close_ts is not None and op.ts is not None and op.ts > close_ts:
            continue
        ts = op.ts or _dt.datetime.min
        if best_ts is None or ts < best_ts:
            best_ts = ts
            best_key = key
    return best_key


# ------------------------------------------------------------- excursion

def _bars_between(
    bars: list[dict], open_date: _dt.date | None, close_date: _dt.date,
) -> list[dict]:
    """Daily bars with open_date <= bar date <= close_date. When open_date is
    None, no window is defined and we return []."""
    if open_date is None:
        return []
    out = []
    for b in bars or []:
        d = _parse_date(b.get("date"))
        if d is None:
            continue
        if open_date <= d <= close_date:
            out.append(b)
    return out


def _excursion(
    bars: list[dict], *, open_date: _dt.date | None, close_date: _dt.date,
    entry_price: float | None, is_long: bool,
) -> tuple[float | None, float | None]:
    """(mfe_dollars, mae_dollars) per unit vs entry_price over the window.

    For a LONG: MFE = max(high) - entry (>=0 when price rose), MAE = min(low) -
    entry (<=0 when price fell). For a SHORT the sign of the move is flipped so
    a favorable move (price falling) is a positive MFE. Returns (None, None)
    when the window has no bars or entry_price is unknown."""
    if entry_price is None:
        return None, None
    window = _bars_between(bars, open_date, close_date)
    if not window:
        return None, None
    highs = [float(b["high"]) for b in window if b.get("high") not in (None, "")]
    lows = [float(b["low"]) for b in window if b.get("low") not in (None, "")]
    if not highs or not lows:
        return None, None
    hi, lo = max(highs), min(lows)
    if is_long:
        mfe = hi - entry_price
        mae = lo - entry_price
    else:
        # short: favorable = price down. Favorable excursion uses the low,
        # adverse uses the high; sign flipped so mfe>=0, mae<=0.
        mfe = entry_price - lo
        mae = entry_price - hi
    return mfe, mae


# --------------------------------------------------------------- reconstruct

def reconstruct(
    orders: list[dict],
    pnl_history: list[dict],
    *,
    bars_by_symbol: dict[str, list[dict]] | None = None,
) -> list[RoundTrip]:
    """Reconstruct labeled closed round-trips from orders + pnl history.

    ``orders`` are history-row dicts (robinhood.fetch_history contract).
    ``pnl_history`` are normalized realized-close rows
    (robinhood.fetch_pnl_trade_history contract) — the authoritative label.
    ``bars_by_symbol`` maps an UNDERLYING to its daily bar list (the ``daily``
    array of a bars/<UND>.json) for excursion; may be None/partial (excursion
    is skipped where absent). Returns round-trips ordered OLDEST close first;
    deterministic."""
    bars_by_symbol = bars_by_symbol or {}
    opens_by_key = _opening_orders(orders)

    # Walk closes oldest-first so "most-recent prior open" is well-defined as
    # we consume opens in time order.
    rows = [r for r in pnl_history if isinstance(r, dict) and r.get("timestamp")]
    rows_sorted = sorted(rows, key=lambda r: str(r.get("timestamp") or ""))

    trips: list[RoundTrip] = []
    for row in rows_sorted:
        close_ts = _parse_ts(row.get("timestamp"))
        close_date = _parse_date(row.get("timestamp"))
        if close_date is None:
            continue
        underlying = _underlying(str(row.get("symbol") or ""))
        realized = float(row.get("realized_gain") or 0.0)
        exit_price = row.get("price")
        exit_price = float(exit_price) if exit_price not in (None, "") else None
        quantity = float(row.get("quantity") or 0.0)

        # Resolve the key. The pnl row carries only the underlying; if an
        # option contract of that underlying is open, pair to it; otherwise
        # treat it as an equity close on the underlying.
        opt_key = _resolve_option_key(opens_by_key, underlying, close_ts)
        if opt_key is not None:
            key, kind, unit = opt_key, "option", "contracts"
        else:
            key, kind, unit = underlying, "equity", "shares"

        op = _pop_open(opens_by_key, key, close_ts)
        entry_unknown = op is None

        open_date = op.date if op else None
        entry_price = op.price if op else None
        open_order_id = op.order_id if op else None
        # closed quantity: the pnl row's, falling back to the open's size
        if quantity <= 0 and op is not None:
            quantity = op.quantity

        holding_days = None
        if open_date is not None:
            holding_days = (close_date - open_date).days

        # cost basis for pct + capture: entry_price * quantity * (multiplier
        # already folded into option entry_price, which is per-contract $).
        cost_basis = None
        if entry_price is not None and quantity > 0:
            cost_basis = abs(entry_price * quantity)
        realized_pct = (realized / cost_basis) if cost_basis else None

        # Excursion from the underlying's daily bars (proxy for options).
        bars = bars_by_symbol.get(underlying) or []
        proxy = kind == "option"
        mfe = mae = mfe_pct = mae_pct = mfe_capture = None
        if bars and entry_price is not None and open_date is not None:
            # per-share entry for excursion vs bar prices; option entry_price is
            # per-contract, so divide by the multiplier back to per-share.
            share_entry = entry_price / _MULTIPLIER if kind == "option" else entry_price
            mfe_sh, mae_sh = _excursion(
                bars, open_date=open_date, close_date=close_date,
                entry_price=share_entry, is_long=True,
            )
            if mfe_sh is not None and mae_sh is not None:
                # scale per-share excursion to the position: shares * move, or
                # contracts * multiplier * move.
                unit_mult = quantity * (_MULTIPLIER if kind == "option" else 1.0)
                mfe = round(mfe_sh * unit_mult, 2)
                mae = round(mae_sh * unit_mult, 2)
                if cost_basis:
                    mfe_pct = mfe / cost_basis
                    mae_pct = mae / cost_basis
                # capture: how much of the best unrealized $ the realized $ kept.
                if mfe and mfe > 0:
                    mfe_capture = round(realized / mfe, 4)

        trips.append(RoundTrip(
            symbol=underlying,
            kind=kind,
            open_date=open_date.isoformat() if open_date else None,
            close_date=close_date.isoformat(),
            holding_days=holding_days,
            entry_price=entry_price,
            exit_price=exit_price,
            quantity=quantity,
            contracts_or_shares=unit,
            realized_pnl=round(realized, 2),
            realized_pct=round(realized_pct, 6) if realized_pct is not None else None,
            win=realized > 0,
            mfe=mfe,
            mae=mae,
            mfe_pct=round(mfe_pct, 6) if mfe_pct is not None else None,
            mae_pct=round(mae_pct, 6) if mae_pct is not None else None,
            mfe_capture=mfe_capture,
            proxy=proxy,
            entry_unknown=entry_unknown,
            open_order_id=open_order_id,
            close_order_id=row.get("order_id") or row.get("id"),
        ))
    return trips


# ----------------------------------------------------------------- summarize

def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def summarize(roundtrips: list[RoundTrip]) -> dict:
    """Deterministic summary over a set of round-trips.

    {count, wins, losses, win_rate, avg_win, avg_loss, profit_factor
    (Σwins / |Σlosses|), avg_holding_days, avg_mfe_capture, entry_unknown,
    by_kind: {equity|option: {count, win_rate, ...}}}. profit_factor is None
    when there are no losing dollars (undefined ratio, not infinity)."""
    def block(trips: list[RoundTrip]) -> dict:
        count = len(trips)
        wins = [t for t in trips if t.win]
        losses = [t for t in trips if not t.win]
        win_pnls = [t.realized_pnl for t in wins]
        loss_pnls = [t.realized_pnl for t in losses]
        gross_win = sum(win_pnls)
        gross_loss = abs(sum(loss_pnls))
        holding = [t.holding_days for t in trips if t.holding_days is not None]
        captures = [t.mfe_capture for t in trips if t.mfe_capture is not None]
        return {
            "count": count,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / count, 4) if count else None,
            "avg_win": _avg(win_pnls),
            "avg_loss": _avg(loss_pnls),
            "gross_profit": round(gross_win, 2),
            "gross_loss": round(gross_loss, 2),
            "profit_factor": round(gross_win / gross_loss, 4) if gross_loss else None,
            "avg_holding_days": _avg([float(h) for h in holding]),
            "avg_mfe_capture": _avg(captures),
            "entry_unknown": sum(1 for t in trips if t.entry_unknown),
        }

    result = block(roundtrips)
    result["by_kind"] = {
        kind: block([t for t in roundtrips if t.kind == kind])
        for kind in ("equity", "option")
        if any(t.kind == kind for t in roundtrips)
    }
    return result


def summarize_rows(rows: list[dict]) -> dict:
    """Same summary as ``summarize`` but over already-serialized round-trip
    dicts (the shape stored in ml/roundtrips.json), so the API/MCP can
    recompute a summary over a FILTERED subset without re-running the engine.
    Missing/degenerate fields are tolerated (a row with no realized_pnl counts
    as a $0 loss)."""
    trips = [
        RoundTrip(
            symbol=str(r.get("symbol") or ""),
            kind=str(r.get("kind") or ""),
            open_date=r.get("open_date"),
            close_date=str(r.get("close_date") or ""),
            holding_days=r.get("holding_days"),
            entry_price=r.get("entry_price"),
            exit_price=r.get("exit_price"),
            quantity=float(r.get("quantity") or 0.0),
            contracts_or_shares=str(r.get("contracts_or_shares") or ""),
            realized_pnl=float(r.get("realized_pnl") or 0.0),
            realized_pct=r.get("realized_pct"),
            win=bool(r.get("win")),
            mfe=r.get("mfe"),
            mae=r.get("mae"),
            mfe_pct=r.get("mfe_pct"),
            mae_pct=r.get("mae_pct"),
            mfe_capture=r.get("mfe_capture"),
            proxy=bool(r.get("proxy")),
            entry_unknown=bool(r.get("entry_unknown")),
            open_order_id=r.get("open_order_id"),
            close_order_id=r.get("close_order_id"),
        )
        for r in rows if isinstance(r, dict)
    ]
    return summarize(trips)
