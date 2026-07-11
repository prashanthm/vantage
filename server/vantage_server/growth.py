"""Per-ticker growth/quality metrics from yfinance statements.

The fundamentals module answers "what does the market pay today" (ratios from
``ticker.info``); this one answers "what is the business doing" — revenue
growth, margins, free cash flow, stock-based compensation, Rule of 40 — from
the quarterly income/cashflow statements. Statements only change when a company
reports, so the disk cache TTL is a week. Any failure returns ``None`` — the
consumer reports "no data" rather than showing fabricated numbers. yfinance is
imported lazily; the clock and fetch are injectable for tests.

Every derived field is nullable and derived purely in :func:`_derive` — missing
statement rows (yfinance labels drift across versions; ETFs return empty
statements) produce nulls, never estimates.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
from pathlib import Path
from typing import Callable

from .store import resolve_data_dir

ENV_TTL = "VANTAGE_GROWTH_TTL"
DEFAULT_TTL_SECONDS = 7 * 86400.0  # a week — statements change quarterly
CACHE_DIRNAME = "growth_cache"

# Statement row label -> our key. yfinance renders labels with spaces
# ("Total Revenue") but has used camel case in other versions; match both.
_INCOME_ROWS = {
    "total_revenue": ("Total Revenue", "TotalRevenue"),
    "gross_profit": ("Gross Profit", "GrossProfit"),
    "operating_income": ("Operating Income", "OperatingIncome"),
}
_CASHFLOW_ROWS = {
    "operating_cash_flow": ("Operating Cash Flow", "OperatingCashFlow",
                            "Cash Flow From Continuing Operating Activities"),
    "capital_expenditure": ("Capital Expenditure", "CapitalExpenditure"),
    "free_cash_flow": ("Free Cash Flow", "FreeCashFlow"),
    "stock_based_compensation": ("Stock Based Compensation",
                                 "StockBasedCompensation"),
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


def _frame_rows(frame, rows: dict[str, tuple[str, ...]]) -> list[dict]:
    """One dict per statement column (period), newest first, plain values.

    ``frame`` is a pandas DataFrame with row labels as index and periods as
    columns. Unmatched rows map to None; NaN maps to None.
    """
    if frame is None or getattr(frame, "empty", True):
        return []
    out: list[dict] = []
    for col in frame.columns:
        period = col.date().isoformat() if hasattr(col, "date") else str(col)
        entry: dict = {"period": period}
        for key, labels in rows.items():
            val = None
            for label in labels:
                if label in frame.index:
                    raw = frame.at[label, col]
                    if raw == raw and raw is not None:  # NaN != NaN
                        val = float(raw)
                    break
            entry[key] = val
        out.append(entry)
    return out


def _yf_statements(symbol: str) -> dict:
    """Normalized plain-dict statements (JSON-cacheable) for one symbol."""
    import yfinance as yf  # noqa: PLC0415

    t = yf.Ticker(symbol.upper())
    return {
        "quarterly_income": _frame_rows(t.quarterly_income_stmt, _INCOME_ROWS),
        "quarterly_cashflow": _frame_rows(t.quarterly_cashflow, _CASHFLOW_ROWS),
        "annual_income": _frame_rows(t.income_stmt, _INCOME_ROWS),
    }


def _ttm(entries: list[dict], key: str, *, offset: int = 0) -> float | None:
    """Sum of ``key`` over four consecutive quarters starting at ``offset``
    (entries newest-first). None unless all four quarters carry the value."""
    window = entries[offset:offset + 4]
    if len(window) < 4 or any(e.get(key) is None for e in window):
        return None
    return float(sum(e[key] for e in window))


def _ratio(num: float | None, den: float | None) -> float | None:
    if num is None or den is None or den == 0:
        return None
    return num / den


def _derive(raw: dict, symbol: str) -> dict:
    """Pure derivation of the growth/quality read from normalized statements.

    Every output is nullable; a missing input nulls everything downstream of it
    (never estimated). ``rule_of_40_basis`` pins the variant served — growth +
    FCF margin differs from growth + operating margin by several points, and
    the consumer will quote whichever it's given.
    """
    qi = raw.get("quarterly_income") or []
    qc = raw.get("quarterly_cashflow") or []
    ai = raw.get("annual_income") or []

    revenue_ttm = _ttm(qi, "total_revenue")
    revenue_prior_ttm = _ttm(qi, "total_revenue", offset=4)

    revenue_yoy = None
    revenue_yoy_basis = None
    if revenue_ttm is not None and revenue_prior_ttm not in (None, 0):
        revenue_yoy = revenue_ttm / revenue_prior_ttm - 1.0
        revenue_yoy_basis = "ttm"
    elif len(ai) >= 2:
        latest, prior = ai[0].get("total_revenue"), ai[1].get("total_revenue")
        if latest is not None and prior not in (None, 0):
            revenue_yoy = latest / prior - 1.0
            revenue_yoy_basis = "annual"

    gross_margin = _ratio(_ttm(qi, "gross_profit"), revenue_ttm)
    operating_margin = _ratio(_ttm(qi, "operating_income"), revenue_ttm)

    fcf_ttm = _ttm(qc, "free_cash_flow")
    if fcf_ttm is None:
        ocf = _ttm(qc, "operating_cash_flow")
        capex = _ttm(qc, "capital_expenditure")
        if ocf is not None and capex is not None:
            fcf_ttm = ocf + capex  # capex is reported negative
    fcf_margin = _ratio(fcf_ttm, revenue_ttm)

    sbc_ttm = _ttm(qc, "stock_based_compensation")
    sbc_pct_revenue = _ratio(sbc_ttm, revenue_ttm)

    rule_of_40 = None
    if revenue_yoy is not None and fcf_margin is not None:
        rule_of_40 = revenue_yoy * 100.0 + fcf_margin * 100.0

    return {
        "symbol": symbol.upper(),
        "revenue_ttm": revenue_ttm,
        "revenue_yoy": revenue_yoy,
        "revenue_yoy_basis": revenue_yoy_basis,
        "gross_margin": gross_margin,
        "operating_margin": operating_margin,
        "fcf_ttm": fcf_ttm,
        "fcf_margin": fcf_margin,
        "sbc_ttm": sbc_ttm,
        "sbc_pct_revenue": sbc_pct_revenue,
        "rule_of_40": rule_of_40,
        "rule_of_40_basis": "yoy_growth_plus_fcf_margin" if rule_of_40 is not None else None,
        "period_end": qi[0]["period"] if qi else None,
    }


def growth(
    symbol: str,
    data_dir: str | os.PathLike[str] | None = None,
    *,
    fetch: Callable[[str], dict] | None = None,
    ttl: float | None = None,
    clock: Callable[[], _dt.datetime] | None = None,
) -> dict | None:
    """Growth/quality read for one symbol, disk-cached. None on any failure."""
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

    fetch = fetch or _yf_statements
    try:
        raw = fetch(sym)
    except Exception:
        return None
    if not raw or not any(raw.get(k) for k in
                          ("quarterly_income", "quarterly_cashflow", "annual_income")):
        return None  # ETFs and unknowns: empty statements, no data
    value = _derive(raw, sym)

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
