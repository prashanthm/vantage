"""Project an index-ETF 0DTE playbook onto its E-mini FUTURE.

NQ tracks the Nasdaq-100 (≈ QQQ ≈ NDX) and RTY tracks the Russell 2000 (≈ IWM ≈
RUT) nearly tick-for-tick. Rather than build a separate GEX/playbook for the
futures (they have no usable own option chain — the dealer hedging lives in the
index/ETF options), we take the ETF playbook's confluence zones + levels and
rescale their prices into futures points via the live future/ETF ratio. Same
zones, expressed where a futures trader reads them.

Analysis/context only — projects levels for reference, places no orders (ADR-010).
"""
from __future__ import annotations

from typing import Any

#: E-mini future -> the ETF underlying whose playbook drives it.
FUTURE_TO_ETF = {"NQ": "QQQ", "MNQ": "QQQ", "RTY": "IWM", "M2K": "IWM"}
#: the yfinance continuous-front symbol for each future's price (for the ratio).
FUTURE_YF = {"NQ": "NQ=F", "MNQ": "NQ=F", "RTY": "RTY=F", "M2K": "RTY=F"}


def future_etf(contract: str) -> str | None:
    """The ETF underlying (QQQ/IWM) a futures contract rides, or None if unknown."""
    return FUTURE_TO_ETF.get((contract or "").upper())


def _future_last(contract: str) -> float | None:
    """Latest futures price (15m close) for the ratio. Best-effort; None on miss."""
    from . import spx_playbook as sp
    yf_sym = FUTURE_YF.get((contract or "").upper())
    if not yf_sym:
        return None
    df = sp._fetch_15m(yf_sym)
    if df is None or getattr(df, "empty", True):
        return None
    return float(df["Close"].iloc[-1])


def projection_ratio(contract: str, etf_spot: float | None) -> float | None:
    """future_price / etf_spot — the multiplier that turns an ETF level into
    futures points (NQ/QQQ ≈ 41, RTY/IWM ≈ 10). None if either price is missing."""
    fut = _future_last(contract)
    if not fut or not etf_spot:
        return None
    return fut / etf_spot


def project_levels(contract: str, scaffold: dict,
                   ratio: float | None = None) -> dict:
    """Project an ETF playbook ``scaffold`` (from build_playbook for QQQ/IWM) onto
    ``contract``'s futures points. Returns
    ``{available, contract, etf, ratio, spot, zones:[...], levels:[...], note}``
    where each zone/level price is in FUTURES points, tagged with its role/kinds.
    Reference/context only — no orders (ADR-010)."""
    etf = future_etf(contract)
    if not etf or not scaffold:
        return {"available": False, "contract": contract, "etf": etf}
    etf_spot = (scaffold.get("regime") or {}).get("spot")
    if ratio is None:
        ratio = projection_ratio(contract, etf_spot)
    if not ratio:
        return {"available": False, "contract": contract, "etf": etf,
                "note": "no live futures/ETF ratio — projection unavailable"}

    def _p(v):
        return round(v * ratio, 1) if v is not None else None

    zones = []
    for z in scaffold.get("confluence") or []:
        zones.append({
            "lo": _p(z.get("lo")), "hi": _p(z.get("hi")), "price": _p(z.get("price")),
            "role": z.get("role"), "kinds": z.get("kinds", []),
            "strength": z.get("strength"),
        })
    levels = []
    for r in (scaffold.get("table") or {}).get("rows") or []:
        levels.append({
            "price": _p(r.get("price")), "label": r.get("label"),
            "role": r.get("role"), "expect": r.get("expect"),
            "key": r.get("key"), "durable": bool(r.get("durable")),
        })
    reg = scaffold.get("regime") or {}
    return {
        "available": True,
        "contract": (contract or "").upper(),
        "etf": etf,
        "ratio": round(ratio, 3),
        "spot": _p(etf_spot),
        "gamma": reg.get("gamma"),
        "zones": zones,
        "levels": levels,
        "note": (f"{contract.upper()} levels projected from the {etf} 0DTE playbook "
                 f"(×{ratio:.2f}). The Nasdaq-100/Russell-2000 dealer-gamma regime "
                 "lives in the index/ETF options; the future respects the same "
                 "levels. Context, not a signal (ADR-008); no orders (ADR-010)."),
    }


def project_for_store(store: Any, contract: str) -> dict:
    """Load the ETF playbook from the store and project it onto ``contract``.
    Returns the projection, or an unavailable stub when no ETF playbook exists."""
    etf = future_etf(contract)
    if not etf:
        return {"available": False, "contract": contract, "etf": None}
    row = store.load_spx_playbook(symbol=etf) if getattr(store, "uses_sqlite", False) else None
    scaffold = (row or {}).get("scaffold") if row else None
    if not scaffold:
        return {"available": False, "contract": contract, "etf": etf,
                "note": f"no {etf} playbook generated yet"}
    return project_levels(contract, scaffold)
