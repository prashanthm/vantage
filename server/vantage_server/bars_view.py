"""Read-only bars view — the chart's data layer, shared by /api/bars and the
vantage.bars MCP tool.

PURE reads of <data_dir>/bars/<SYMBOL>.json (written by snapshot_bars) plus the
deterministic technicals engine. No network, no writes. Fixture datasets carry
no bars/ directory, so every entry point degrades gracefully (BarsNotFound) to
let the SPA fall back to its bundled fixture chart.

Two products:
  * ``bars_payload`` — {symbol, as_of, timeframe, bars, levels, first_bar,
    last_bar, bar_count} for one timeframe (daily|weekly|monthly). ``levels``
    are technicals.support_resistance over that timeframe at the last close,
    Level objects serialized to {price, strength, kind}.
  * ``overlay_payload`` — the single bundle the chart draws everything from:
    {symbol, levels (all timeframes), analysis (latest journal decision for the
    symbol), cost_basis (avg cost of this underlying's equity + option lots),
    current_price}.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import analyze
from . import technicals as tech_engine
from .snapshot_bars import _underlying

TIMEFRAMES = ("daily", "weekly", "monthly")


class BarsNotFound(LookupError):
    """No bars/<SYMBOL>.json exists for the requested ticker."""


def _bars_path(data_dir: str | Path, symbol: str) -> Path:
    return Path(data_dir) / "bars" / f"{symbol.upper()}.json"


def load_bars_file(data_dir: str | Path, symbol: str) -> dict:
    """Load one symbol's bars, or raise BarsNotFound. Reads through the Store
    backend, so a SQLite-backed data dir serves bars from vantage.db while a
    JSON dir reads bars/<SYMBOL>.json. Malformed/absent data raises BarsNotFound
    (the SPA fallback path — never a 500)."""
    from .store import Store

    data = Store(data_dir).load_bars(symbol)
    if not isinstance(data, dict):
        raise BarsNotFound(symbol.upper())
    return data


def _serialize_level(level) -> dict:
    """A technicals.Level -> {price, strength, kind} (Level is not subscriptable)."""
    return {"price": level.price, "strength": level.strength, "kind": level.kind}


def _levels_for(daily_like: list[dict]) -> dict:
    """support_resistance over a bar series at its last close, serialized.

    Returns {"support": [...], "resistance": [...]}; empty lists when the series
    is empty (no close to price against)."""
    if not daily_like:
        return {"support": [], "resistance": []}
    current_price = float(daily_like[-1]["close"])
    sr = tech_engine.support_resistance(daily_like, current_price=current_price)
    return {
        "support": [_serialize_level(lv) for lv in sr["support"]],
        "resistance": [_serialize_level(lv) for lv in sr["resistance"]],
    }


def bars_payload(data_dir: str | Path, symbol: str, timeframe: str = "daily") -> dict:
    """{symbol, as_of, timeframe, bars, levels, first_bar, last_bar, bar_count}
    for one timeframe. Raises BarsNotFound (no file) or ValueError (bad
    timeframe)."""
    tf = timeframe.lower()
    if tf not in TIMEFRAMES:
        raise ValueError(f"unknown timeframe {timeframe!r} (want one of {TIMEFRAMES})")
    data = load_bars_file(data_dir, symbol)
    series = data.get(tf) if isinstance(data.get(tf), list) else []
    return {
        "symbol": symbol.upper(),
        "as_of": data.get("as_of"),
        "timeframe": tf,
        "bars": series,
        "levels": _levels_for(series),
        "first_bar": (str(series[0]["date"])[:10] if series else None),
        "last_bar": (str(series[-1]["date"])[:10] if series else None),
        "bar_count": len(series),
    }


# ------------------------------------------------------------- overlay bundle

def _cost_basis(data_dir: str | Path, underlying: str) -> dict | None:
    """Average cost of the held lots for ``underlying`` — equity lots and the
    option lots whose display symbol shares this underlying.

    Returns {equity: {shares, avg_cost} | None, options: {contracts, avg_cost}
    | None} or None when nothing is held. Equity avg_cost is per share; option
    avg_cost is the per-lot cost_per_share as the lot carries it (the importer
    stores option lots one row per contract)."""
    from .store import Store

    want = underlying.upper()
    eq_shares = eq_cost = 0.0
    opt_contracts = opt_cost = 0.0
    for lot in Store(data_dir).load_lots():
        und = _underlying(lot.symbol)
        if und != want:
            continue
        if " " in lot.symbol:  # option display symbol
            opt_contracts += lot.shares
            opt_cost += lot.shares * lot.cost_per_share
        else:  # plain equity in this underlying
            eq_shares += lot.shares
            eq_cost += lot.shares * lot.cost_per_share
    if eq_shares <= 0 and opt_contracts <= 0:
        return None
    out: dict = {"equity": None, "options": None}
    if eq_shares > 0:
        out["equity"] = {"shares": eq_shares, "avg_cost": eq_cost / eq_shares}
    if opt_contracts > 0:
        out["options"] = {"contracts": opt_contracts,
                          "avg_cost": opt_cost / opt_contracts}
    return out


def _latest_decision(data_dir: str | Path, symbol: str) -> dict | None:
    """The latest journaled PositionDecision for ``symbol`` (or None)."""
    from .store import Store

    day = Store(data_dir).load_analysis_day(None)
    want = symbol.upper()
    for dec in (day or {}).get("decisions", []):
        if str(dec.get("symbol", "")).upper() == want:
            return dec
    return None


def overlay_payload(data_dir: str | Path, symbol: str, *, live_price: float | None = None) -> dict:
    """The chart's full overlay bundle for one symbol. Raises BarsNotFound.

    {symbol, current_price, last_close (EOD bar close), levels (all timeframes),
    analysis (latest journal decision or None), cost_basis (lots avg cost or
    None)}.

    ``current_price`` prefers the live intraday quote (``live_price``, from the
    quote provider) so P&L and valuation agree with the positions view; it falls
    back to the last daily bar close when no live quote is available. S/R levels
    are always computed from the EOD bar series (they are structural, not
    intraday), so ``last_close`` is surfaced separately for reference.
    """
    data = load_bars_file(data_dir, symbol)
    sym = symbol.upper()
    daily = data.get("daily") if isinstance(data.get("daily"), list) else []
    last_close = float(daily[-1]["close"]) if daily else None
    current_price = float(live_price) if live_price is not None else last_close

    levels = {}
    for tf in TIMEFRAMES:
        series = data.get(tf) if isinstance(data.get(tf), list) else []
        levels[tf] = _levels_for(series)

    return {
        "symbol": sym,
        "as_of": data.get("as_of"),
        "current_price": current_price,
        "last_close": last_close,
        "levels": levels,
        "analysis": _latest_decision(data_dir, sym),
        "cost_basis": _cost_basis(data_dir, sym),
    }
