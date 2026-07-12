"""Relative strength / factor decomposition from the bars already synced.

Answers the question a signal alone can't: is the NAME moving, or is its
sector / the market moving it? Computes, over the daily bars the nightly
already snapshots:

* trailing returns for the name, SPY, and the name's sector ETF (1w/1m/3m)
* beta vs SPY (up to ~126 daily return pairs)
* the idiosyncratic 1-month move: name_1m − beta × spy_1m

PURE derivation over injected bar dicts; the I/O wrapper reads through the
Store. Missing benchmark bars degrade to nulls with the benchmark named as
unavailable — never fabricated. Benchmarks only have data if the nightly
snapshots them (see nightly.sh: SPY + the sector ETFs of held names).
"""
from __future__ import annotations

import os
from typing import Any

# Held-universe sector map (GICS-ish, coarse). Unmapped symbols decompose vs
# SPY only. Extend as the book changes — one line per name.
SECTOR_ETF: dict[str, str] = {
    "PLTR": "XLK", "MSFT": "XLK", "INTU": "XLK", "ADBE": "XLK", "SOUN": "XLK",
    "BBAI": "XLK", "NBIS": "XLK", "IREN": "XLK", "SMX": "XLK",
    "ACN": "XLK", "FISV": "XLF", "NFLX": "XLC", "SNAP": "XLC",
    "NVO": "XLV", "SRPT": "XLV", "OCGN": "XLV", "UNH": "XLV",
    "ENPH": "XLE", "O": "XLRE", "FFAI": "XLY",
}

_WINDOWS = {"r_1w": 5, "r_1m": 21, "r_3m": 63}
_BETA_WINDOW = 126


def trailing_return(daily: list[dict], days: int) -> float | None:
    """Close-to-close return over the last ``days`` trading days, or None."""
    closes = [b.get("close") for b in daily if b.get("close") is not None]
    if len(closes) < days + 1:
        return None
    start, end = float(closes[-(days + 1)]), float(closes[-1])
    if start == 0:
        return None
    return end / start - 1.0


def _daily_returns(daily: list[dict], window: int) -> list[float]:
    closes = [float(b["close"]) for b in daily if b.get("close") is not None]
    closes = closes[-(window + 1):]
    return [closes[i] / closes[i - 1] - 1.0 for i in range(1, len(closes))
            if closes[i - 1] != 0]


def beta_vs(daily: list[dict], bench_daily: list[dict],
            window: int = _BETA_WINDOW) -> float | None:
    """OLS beta of the name's daily returns on the benchmark's, or None."""
    a = _daily_returns(daily, window)
    b = _daily_returns(bench_daily, window)
    n = min(len(a), len(b))
    if n < 40:  # too little overlap for a stable estimate
        return None
    a, b = a[-n:], b[-n:]
    mean_a, mean_b = sum(a) / n, sum(b) / n
    cov = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b)) / n
    var = sum((y - mean_b) ** 2 for y in b) / n
    if var == 0:
        return None
    return round(cov / var, 2)


def decompose(symbol: str, daily: list[dict],
              spy_daily: list[dict] | None,
              sector_daily: list[dict] | None,
              sector_symbol: str | None) -> dict[str, Any]:
    """The relative-strength read from bar series (pure)."""
    sym = symbol.upper()
    out: dict[str, Any] = {"symbol": sym, "sector_etf": sector_symbol}
    for key, days in _WINDOWS.items():
        out[key] = _round4(trailing_return(daily, days))
        out[f"spy_{key}"] = _round4(trailing_return(spy_daily or [], days))
        out[f"sector_{key}"] = _round4(trailing_return(sector_daily or [], days))

    beta = beta_vs(daily, spy_daily or [])
    out["beta_spy"] = beta
    idio = None
    if beta is not None and out["r_1m"] is not None and out["spy_r_1m"] is not None:
        idio = round(out["r_1m"] - beta * out["spy_r_1m"], 4)
    out["idio_r_1m"] = idio
    out["basis"] = "idio_r_1m = r_1m - beta_spy * spy_r_1m (daily closes)"
    out["benchmark_available"] = bool(spy_daily)
    return out


def relative_strength(
    symbol: str,
    data_dir: str | os.PathLike[str] | None = None,
) -> dict[str, Any] | None:
    """Store-backed wrapper: None when the NAME has no bars (benchmarks may
    be absent — that degrades to nulls inside the payload, not to None)."""
    from .store import Store, resolve_data_dir

    store = Store(resolve_data_dir(data_dir))
    sym = symbol.upper()

    def daily_for(s: str) -> list[dict] | None:
        data = store.load_bars(s)
        bars = data.get("daily") if isinstance(data, dict) else None
        return bars if isinstance(bars, list) and bars else None

    daily = daily_for(sym)
    if daily is None:
        return None
    sector_sym = SECTOR_ETF.get(sym)
    return decompose(
        sym, daily,
        spy_daily=daily_for("SPY"),
        sector_daily=daily_for(sector_sym) if sector_sym else None,
        sector_symbol=sector_sym,
    )


def _round4(value: float | None) -> float | None:
    return None if value is None else round(value, 4)
