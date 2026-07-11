"""Per-ticker fundamentals from yfinance — valuation context for the notebook.

Pulls the slow-moving valuation fields (market cap, P/E, 52-week range, analyst
target, dividend yield, name/sector) from yfinance ``ticker.info``. Cached on
disk per symbol with a long TTL (fundamentals barely move intraday). Any failure
returns ``None`` — the notebook hides the section rather than showing fabricated
numbers. yfinance is imported lazily; the clock and fetch are injectable for
tests.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
from pathlib import Path
from typing import Callable

from .store import resolve_data_dir

ENV_TTL = "VANTAGE_FUNDAMENTALS_TTL"
DEFAULT_TTL_SECONDS = 6 * 3600.0  # 6h — fundamentals move slowly
CACHE_DIRNAME = "fundamentals_cache"

# yfinance info key -> our field name. Missing keys map to None.
_FIELDS = {
    "name": ("shortName", "longName"),
    "sector": ("sector",),
    "market_cap": ("marketCap",),
    "enterprise_value": ("enterpriseValue",),
    "shares_outstanding": ("sharesOutstanding",),
    "pe": ("trailingPE",),
    "forward_pe": ("forwardPE",),
    "week52_low": ("fiftyTwoWeekLow",),
    "week52_high": ("fiftyTwoWeekHigh",),
    "target_mean": ("targetMeanPrice",),
    "dividend_yield": ("dividendYield",),
    "beta": ("beta",),
}


def _utc_now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _resolve_ttl(ttl: float | None) -> float:
    if ttl is not None:
        return float(ttl)
    env = os.environ.get(ENV_TTL, "").strip()
    if env:
        try:
            return float(env)
        except ValueError:
            pass
    return DEFAULT_TTL_SECONDS


def _yf_info(symbol: str) -> dict:
    import yfinance as yf  # noqa: PLC0415

    return yf.Ticker(symbol.upper()).info or {}


def _shape(info: dict, symbol: str) -> dict:
    out: dict = {"symbol": symbol.upper()}
    for field, keys in _FIELDS.items():
        val = None
        for k in keys:
            if info.get(k) is not None:
                val = info[k]
                break
        out[field] = val
    if out.get("name") is None:
        out["name"] = symbol.upper()
    return out


def fundamentals(
    symbol: str,
    data_dir: str | os.PathLike[str] | None = None,
    *,
    fetch: Callable[[str], dict] | None = None,
    ttl: float | None = None,
    clock: Callable[[], _dt.datetime] | None = None,
) -> dict | None:
    """Valuation fields for one symbol, disk-cached. None on any failure."""
    sym = symbol.upper()
    data_dir = resolve_data_dir(data_dir)
    clock = clock or _utc_now
    ttl = _resolve_ttl(ttl)
    cache = Path(data_dir) / CACHE_DIRNAME / f"{sym}.json"

    if ttl > 0 and cache.is_file():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            fetched_at = _dt.datetime.fromisoformat(str(data["fetched_at"]))
            age = (clock() - fetched_at).total_seconds()
            if 0 <= age < ttl:
                return data["value"]
        except Exception:
            pass  # corrupt/expired cache: refetch

    fetch = fetch or _yf_info
    try:
        info = fetch(sym)
    except Exception:
        return None
    if not info:
        return None
    value = _shape(info, sym)

    if ttl > 0:
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(
                json.dumps({"fetched_at": clock().isoformat(timespec="seconds"), "value": value},
                           indent=2) + "\n",
                encoding="utf-8",
            )
        except OSError:
            pass
    return value
