"""Portfolio-analyzer compute — pure functions over the already-computed position
book + per-ticker fundamentals. No I/O (the caller passes positions + a fundamentals
lookup); no clock, no network. Mirrors engine.py's style.

The analyzer answers the questions a per-ticker notebook can't: how diversified am I,
what income do I throw off, how concentrated, what's my portfolio beta, and how far
have I drifted from a target allocation. Returns/equity-curve live elsewhere (they
need a value-history time series); everything here is point-in-time from holdings.
"""
from __future__ import annotations

from typing import Any, Callable, Sequence


def _get(p: Any, key: str, default=None):
    return p.get(key, default) if isinstance(p, dict) else getattr(p, key, default)


def _held(positions: Sequence[Any], currency: str | None = None) -> list[Any]:
    """Real equity/cash holdings with a positive value (skip zero/sleeve rows).
    When `currency` is given, keep ONLY that currency's positions — the "never
    cross-sum" rule: metrics are computed within one currency bucket, never mixed."""
    out = []
    for p in positions:
        v = _num(_get(p, "value"))
        if not (v and v > 0):
            continue
        if currency is not None and str(_get(p, "currency") or "USD") != currency:
            continue
        out.append(p)
    return out


def currencies(positions: Sequence[Any]) -> list[str]:
    """The distinct currencies present in the book, largest-value bucket first."""
    tot: dict[str, float] = {}
    for p in _held(positions):
        ccy = str(_get(p, "currency") or "USD")
        tot[ccy] = tot.get(ccy, 0.0) + (_num(_get(p, "value")) or 0.0)
    return [c for c, _ in sorted(tot.items(), key=lambda kv: -kv[1])]


def _num(v) -> float | None:
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def diversification(positions: Sequence[Any], fund_of: Callable[[str], dict | None],
                    currency: str | None = None) -> dict:
    """Sector + single-name weights and concentration metrics. `fund_of(sym)` returns
    the ticker's fundamentals ({sector, ...}) or None. Weights are % of the (optionally
    currency-scoped) total — never mixing currencies."""
    held = _held(positions, currency)
    total = sum(_num(_get(p, "value")) or 0.0 for p in held)
    if total <= 0:
        return {"total": 0.0, "by_sector": {}, "top_holdings": [], "concentration": {}}

    by_sector: dict[str, float] = {}
    names: list[tuple[str, float]] = []
    for p in held:
        sym = str(_get(p, "symbol") or "")
        v = _num(_get(p, "value")) or 0.0
        w = v / total * 100.0
        if sym.upper() == "CASH":
            sector = "Cash"
        else:
            f = fund_of(sym) or {}
            sector = (f.get("sector") if isinstance(f, dict) else None) or "Unknown"
        by_sector[sector] = by_sector.get(sector, 0.0) + w
        names.append((sym, w))

    names.sort(key=lambda x: x[1], reverse=True)
    top5 = sum(w for _, w in names[:5])
    top_name = names[0] if names else ("", 0.0)
    top_sector = max(by_sector.items(), key=lambda kv: kv[1]) if by_sector else ("", 0.0)
    # Herfindahl-Hirschman Index over holding weights (fractions) → 0..1.
    hhi = sum((w / 100.0) ** 2 for _, w in names)
    band = ("concentrated" if hhi >= 0.25 else "moderate" if hhi >= 0.15 else "diversified")

    return {
        "total": round(total, 2),
        "by_sector": {k: round(v, 2) for k, v in sorted(by_sector.items(), key=lambda kv: -kv[1])},
        "top_holdings": [{"symbol": s, "weight": round(w, 2)} for s, w in names[:10]],
        "concentration": {
            "hhi": round(hhi, 4), "band": band,
            "top5_weight": round(top5, 2),
            "top_name": {"symbol": top_name[0], "weight": round(top_name[1], 2)},
            "top_sector": {"sector": top_sector[0], "weight": round(top_sector[1], 2)},
            # single-name flags at the same >7% the UI already uses.
            "single_name_flags": [{"symbol": s, "weight": round(w, 2)}
                                  for s, w in names if w > 7.0],
        },
    }


def income(positions: Sequence[Any], fund_of: Callable[[str], dict | None],
           currency: str | None = None) -> dict:
    """Projected annual dividend income, portfolio yield, yield-on-cost, and the
    per-holding contribution list. `dividend_yield` from yfinance is a PERCENT number
    (2.18 = 2.18%), so income = value × yield/100. Currency-scoped: income is in that
    bucket's currency (never summing INR + USD dividends)."""
    held = _held(positions, currency)
    total_val = sum(_num(_get(p, "value")) or 0.0 for p in held)
    total_cost = sum(_num(_get(p, "cost")) or 0.0 for p in held)
    rows = []
    annual = 0.0
    for p in held:
        sym = str(_get(p, "symbol") or "")
        if sym.upper() == "CASH":
            continue
        v = _num(_get(p, "value")) or 0.0
        f = fund_of(sym) or {}
        y = _num(f.get("dividend_yield")) if isinstance(f, dict) else None
        if not y or y <= 0:
            continue
        inc = v * (y / 100.0)   # value already reflects shares × price; y is a percent
        annual += inc
        rows.append({"symbol": sym, "yield": round(y, 2), "annual_income": round(inc, 2)})
    rows.sort(key=lambda r: r["annual_income"], reverse=True)
    return {
        "annual_income": round(annual, 2),
        "portfolio_yield": round(annual / total_val * 100, 2) if total_val else 0.0,
        "yield_on_cost": round(annual / total_cost * 100, 2) if total_cost else 0.0,
        "contributors": rows,
    }


def character(positions: Sequence[Any], fund_of: Callable[[str], dict | None],
              currency: str | None = None) -> dict:
    """Weighted-average portfolio beta + blended P/E (value-weighted over holdings
    that have the metric; weights renormalized to those with data). Currency-scoped."""
    held = [p for p in _held(positions, currency) if str(_get(p, "symbol") or "").upper() != "CASH"]
    total = sum(_num(_get(p, "value")) or 0.0 for p in held)
    if total <= 0:
        return {"beta": None, "pe": None}

    def _wavg(field: str) -> float | None:
        num = den = 0.0
        for p in held:
            v = _num(_get(p, "value")) or 0.0
            f = fund_of(str(_get(p, "symbol") or "")) or {}
            m = _num(f.get(field)) if isinstance(f, dict) else None
            if m is not None and m == m:
                num += v * m
                den += v
        return round(num / den, 2) if den > 0 else None

    return {"beta": _wavg("beta"), "pe": _wavg("pe"),
            "covered_pct": round(sum(
                _num(_get(p, "value")) or 0.0 for p in held
                if isinstance(fund_of(str(_get(p, "symbol") or "")) or {}, dict)
                and _num((fund_of(str(_get(p, "symbol") or "")) or {}).get("beta")) is not None
            ) / total * 100, 1) if total else 0.0}


def winners_losers(positions: Sequence[Any], currency: str | None = None, n: int = 5) -> dict:
    """Rank holdings by unrealized GAIN % (unrealized/cost), not just $. Returns the
    top/bottom N by % plus the same by $. Currency-scoped (each holding's gain is in
    its own currency; % is currency-agnostic so cross-currency % ranking is meaningful,
    but $ ranking stays within a bucket)."""
    rows = []
    for p in _held(positions, currency):
        sym = str(_get(p, "symbol") or "")
        if sym.upper() == "CASH":
            continue
        v = _num(_get(p, "value")) or 0.0
        cost = _num(_get(p, "cost")) or 0.0
        unrl = _num(_get(p, "unrealized"))
        if unrl is None:
            unrl = v - cost
        pct = (unrl / cost * 100.0) if cost > 0 else None
        rows.append({"symbol": sym, "value": round(v, 2), "cost": round(cost, 2),
                     "unrealized": round(unrl, 2),
                     "gain_pct": round(pct, 2) if pct is not None else None,
                     "currency": str(_get(p, "currency") or "USD")})
    by_pct = [r for r in rows if r["gain_pct"] is not None]
    by_pct.sort(key=lambda r: r["gain_pct"], reverse=True)
    by_usd = sorted(rows, key=lambda r: r["unrealized"], reverse=True)
    return {
        "winners_pct": by_pct[:n],
        "losers_pct": list(reversed(by_pct[-n:])) if by_pct else [],
        "winners_usd": [r for r in by_usd if r["unrealized"] > 0][:n],
        "losers_usd": [r for r in reversed(by_usd) if r["unrealized"] < 0][:n],
    }


def _returns(closes: Sequence[float]) -> list[float]:
    """Close-to-close simple daily returns from a price series."""
    out = []
    for a, b in zip(closes, closes[1:]):
        if a and a > 0:
            out.append(b / a - 1.0)
    return out


def risk(positions: Sequence[Any], closes_of: Callable[[str], list[float] | None],
         currency: str | None = None, rf_annual: float = 0.0) -> dict:
    """Portfolio volatility, Sharpe, Sortino, and max drawdown from a value-weighted
    daily return series. `closes_of(sym)` returns a daily close list (oldest→newest) or
    None. Data-gated: only holdings WITH bars contribute; `coverage_pct` is the % of the
    (currency-scoped) book that had data, so a thin series is surfaced honestly, never
    fabricated. Annualized with 252 trading days."""
    held = [p for p in _held(positions, currency) if str(_get(p, "symbol") or "").upper() != "CASH"]
    series: list[tuple[float, list[float]]] = []  # (weight-value, returns)
    covered = total = 0.0
    for p in held:
        v = _num(_get(p, "value")) or 0.0
        total += v
        closes = closes_of(str(_get(p, "symbol") or ""))
        rets = _returns(closes) if closes else []
        if len(rets) >= 20:  # need a meaningful window
            series.append((v, rets))
            covered += v
    if not series:
        return {"available": False, "coverage_pct": 0.0,
                "note": "No stored daily bars for these holdings — seed them to compute risk."}

    # align to the shortest common length (most recent N days), value-weight per day.
    m = min(len(r) for _, r in series)
    wsum = sum(w for w, _ in series)
    port = []
    for i in range(-m, 0):
        port.append(sum(w * r[i] for w, r in series) / wsum)

    def _pstdev(xs: list[float]) -> float:
        # population stdev, computed directly to avoid statistics.pstdev's exact-
        # fraction path (which raises on plain floats on some CPython builds).
        if len(xs) < 2:
            return 0.0
        mu = sum(xs) / len(xs)
        return (sum((x - mu) ** 2 for x in xs) / len(xs)) ** 0.5

    mean = sum(port) / len(port)
    sd = _pstdev(port)
    downside = [r for r in port if r < 0]
    dsd = _pstdev(downside)
    ann = 252 ** 0.5
    rf_daily = rf_annual / 252.0
    vol_ann = sd * ann
    sharpe = ((mean - rf_daily) / sd * ann) if sd > 0 else None
    sortino = ((mean - rf_daily) / dsd * ann) if dsd > 0 else None
    # max drawdown on the compounded equity curve of the weighted series.
    eq, peak, mdd = 1.0, 1.0, 0.0
    for r in port:
        eq *= (1.0 + r)
        peak = max(peak, eq)
        mdd = min(mdd, eq / peak - 1.0)
    return {
        "available": True, "days": m,
        "coverage_pct": round(covered / total * 100, 1) if total else 0.0,
        "vol_annual_pct": round(vol_ann * 100, 2),
        "sharpe": round(sharpe, 2) if sharpe is not None else None,
        "sortino": round(sortino, 2) if sortino is not None else None,
        "max_drawdown_pct": round(mdd * 100, 2),
    }


def by_account(positions: Sequence[Any], acct_meta: Callable[[str], dict | None]) -> dict:
    """Per-account value + concentration, grouped by currency (never cross-summed).
    `acct_meta(id)` returns {name, broker, currency, taxable, type} or None. Surfaces
    single-account / single-broker concentration."""
    # sum value per (account, currency)
    acc: dict[str, dict] = {}
    for p in _held(positions):
        alist = list(_get(p, "accounts") or [])
        if not alist:
            continue
        v = _num(_get(p, "value")) or 0.0
        ccy = str(_get(p, "currency") or "USD")
        # a position may span accounts; attribute its value evenly (lots are the true
        # source but positions are consolidated — even split is the honest approximation
        # at the position grain).
        # ponytail: even split across a position's accounts; use lot-level attribution if per-account $ must be exact
        share = v / len(alist)
        for a in alist:
            aid = str(a)
            d = acc.setdefault(aid, {"account": aid, "by_currency": {}})
            d["by_currency"][ccy] = d["by_currency"].get(ccy, 0.0) + share
    rows = []
    for aid, d in acc.items():
        meta = acct_meta(aid) or {}
        rows.append({"account": aid, "name": meta.get("name") or aid,
                     "broker": meta.get("broker"), "taxable": meta.get("taxable"),
                     "by_currency": {k: round(v, 2) for k, v in d["by_currency"].items()}})
    # concentration per currency: top account's share of that currency's total.
    conc: dict[str, dict] = {}
    for ccy in {c for r in rows for c in r["by_currency"]}:
        vals = [(r["account"], r["by_currency"].get(ccy, 0.0)) for r in rows]
        tot = sum(v for _, v in vals)
        top = max(vals, key=lambda x: x[1]) if vals else ("", 0.0)
        conc[ccy] = {"top_account": top[0], "top_pct": round(top[1] / tot * 100, 1) if tot else 0.0,
                     "n_accounts": sum(1 for _, v in vals if v > 0)}
    rows.sort(key=lambda r: -sum(r["by_currency"].values()))
    return {"accounts": rows, "concentration": conc}


def realized_gains(history: Sequence[dict], year: int | None = None,
                   st_rate: float = 0.0, lt_rate: float = 0.0) -> dict:
    """Realized capital gains from imported EQUITY history via FIFO lot-matching.
    Each sell consumes the oldest buy lots of that symbol; gain = proceeds - matched
    cost; a matched lot held >365 days is long-term. Sells whose symbol has no prior
    buy in the history (bought before the import window) go to a `cost_unknown` bucket
    with proceeds only. `st_rate`/`lt_rate` are decimals (0.24 = 24%) for an estimate.
    Filter to `year` (by sell date) when given. Options are excluded (trading side)."""
    import datetime as _dt

    def _d(s):  # parse an ISO date (date or datetime) to a date, or None
        try:
            return _dt.date.fromisoformat(str(s)[:10])
        except (TypeError, ValueError):
            return None

    # per-symbol FIFO queues of buy lots: [remaining_shares, cost_per_share, buy_date]
    buys: dict[str, list[list]] = {}
    # process chronologically so FIFO is correct
    eq = [r for r in history if str(r.get("kind", "")).lower() == "equity"]
    eq.sort(key=lambda r: str(r.get("date") or ""))
    st_gain = lt_gain = unknown_proceeds = 0.0
    st_lots: list[dict] = []
    lt_lots: list[dict] = []
    unknown: list[dict] = []

    for r in eq:
        sym = str(r.get("symbol") or "").upper()
        side = str(r.get("side") or "").lower()
        qty = _num(r.get("quantity")) or 0.0
        price = _num(r.get("price")) or 0.0
        d = _d(r.get("date"))
        if side == "buy" and qty > 0:
            buys.setdefault(sym, []).append([qty, price, d])
        elif side == "sell" and qty > 0:
            if year is not None and (d is None or d.year != year):
                # still consume lots so later same-year sells match correctly,
                # but don't count this sell's gain toward the requested year.
                _consume(buys.get(sym, []), qty)
                continue
            remaining = qty
            q = buys.get(sym, [])
            while remaining > 1e-9 and q:
                lot = q[0]
                take = min(remaining, lot[0])
                cost = take * lot[1]
                proceeds = take * price
                gain = proceeds - cost
                held_days = (d - lot[2]).days if (d and lot[2]) else None
                is_lt = held_days is not None and held_days > 365
                rec = {"symbol": sym, "date": str(r.get("date"))[:10], "shares": round(take, 4),
                       "proceeds": round(proceeds, 2), "cost": round(cost, 2),
                       "gain": round(gain, 2), "held_days": held_days,
                       "term": "long" if is_lt else "short"}
                if is_lt:
                    lt_gain += gain; lt_lots.append(rec)
                else:
                    st_gain += gain; st_lots.append(rec)
                lot[0] -= take
                remaining -= take
                if lot[0] <= 1e-9:
                    q.pop(0)
            if remaining > 1e-9:  # no matching buy lots left → cost basis unknown
                p = remaining * price
                unknown_proceeds += p
                unknown.append({"symbol": sym, "date": str(r.get("date"))[:10],
                                "shares": round(remaining, 4), "proceeds": round(p, 2)})

    total = st_gain + lt_gain
    est_tax = st_gain * st_rate * (st_gain > 0) + lt_gain * lt_rate * (lt_gain > 0)
    return {
        "year": year, "total_gain": round(total, 2),
        "short_term": {"gain": round(st_gain, 2), "n": len(st_lots)},
        "long_term": {"gain": round(lt_gain, 2), "n": len(lt_lots)},
        "estimated_tax": round(est_tax, 2),
        "cost_unknown": {"proceeds": round(unknown_proceeds, 2), "rows": unknown},
        "lots": sorted(st_lots + lt_lots, key=lambda x: x["date"], reverse=True),
    }


def _consume(q: list[list], qty: float) -> None:
    """FIFO-consume `qty` shares from a buy-lot queue in place (used for out-of-year
    sells so later same-year matching stays correct)."""
    remaining = qty
    while remaining > 1e-9 and q:
        lot = q[0]
        take = min(remaining, lot[0])
        lot[0] -= take
        remaining -= take
        if lot[0] <= 1e-9:
            q.pop(0)


def rebalance(alloc_by_class: dict[str, dict], targets: dict[str, float], total: float) -> dict:
    """Drift vs target per asset class + cash-neutral trade suggestions to close the
    largest drifts. `alloc_by_class` = {cls: {value, pct}}; `targets` = {cls: pct}."""
    rows = []
    for cls, tgt in targets.items():
        cur = (alloc_by_class.get(cls) or {}).get("pct", 0.0)
        drift = round(cur - tgt, 2)
        dollars = round((drift / 100.0) * total, 2) if total else 0.0  # + = overweight
        rows.append({"asset_class": cls, "current_pct": round(cur, 2), "target_pct": tgt,
                     "drift_pct": drift, "trade_usd": -dollars,   # trade to correct: sell if over
                     "action": "trim" if dollars > 0 else "add" if dollars < 0 else "hold"})
    rows.sort(key=lambda r: abs(r["drift_pct"]), reverse=True)
    max_drift = max((abs(r["drift_pct"]) for r in rows), default=0.0)
    return {"rows": rows, "max_drift_pct": round(max_drift, 2),
            "in_band": max_drift < 3.0}   # 3% band, same as the existing UI nudge


def snapshot(positions: Sequence[Any], fund_of: Callable[[str], dict | None],
             closes_of: Callable[[str], list[float] | None],
             acct_meta: Callable[[str], dict | None],
             alloc_by_class: dict[str, dict], targets: dict[str, float],
             alloc_total: float) -> dict:
    """The whole 'portfolio DNA' bundle — one object the Mira portfolio analyst reasons
    over to produce actions. Per-currency where it matters (diversification/income/
    character/risk), currency-agnostic where it's a %, plus cross-account concentration.
    Pure compute; the caller wires fund_of/closes_of/acct_meta/alloc."""
    ccys = currencies(positions)
    per_ccy = {
        c: {
            "diversification": diversification(positions, fund_of, currency=c),
            "income": income(positions, fund_of, currency=c),
            "character": character(positions, fund_of, currency=c),
            "risk": risk(positions, closes_of, currency=c),
        }
        for c in ccys
    }
    return {
        "currencies": ccys,
        "by_currency": per_ccy,
        "winners_losers": winners_losers(positions),
        "by_account": by_account(positions, acct_meta),
        "rebalance": rebalance(alloc_by_class, targets, alloc_total),
    }


def _demo() -> None:
    """assert-based self-check for the analyzer math (run: python -m vantage_server.portfolio)."""
    class P:
        def __init__(self, symbol, value, cost=0.0, currency="USD", unrealized=None, accounts=()):
            self.symbol, self.value, self.cost, self.currency = symbol, value, cost, currency
            self.unrealized = value - cost if unrealized is None else unrealized
            self.accounts = accounts
    pos = [P("AAPL", 6000, 4000), P("MSFT", 3000, 2000), P("CASH", 1000, 1000)]
    # dividend_yield is a PERCENT number (0.5 = 0.5%), matching yfinance.
    fund = {"AAPL": {"sector": "Tech", "beta": 1.2, "dividend_yield": 0.5, "pe": 30},
            "MSFT": {"sector": "Tech", "beta": 0.9, "dividend_yield": 0.8, "pe": 35}}
    d = diversification(pos, lambda s: fund.get(s))
    assert abs(d["by_sector"]["Tech"] - 90.0) < 0.01, d["by_sector"]      # 9000/10000
    assert abs(d["by_sector"]["Cash"] - 10.0) < 0.01
    assert d["concentration"]["top_name"]["symbol"] == "AAPL"
    assert d["concentration"]["hhi"] > 0.15   # concentrated 2-name book
    inc = income(pos, lambda s: fund.get(s))
    # AAPL 6000*.005=30, MSFT 3000*.008=24 → 54; yield 54/10000=0.54%
    assert abs(inc["annual_income"] - 54.0) < 0.01, inc
    assert abs(inc["portfolio_yield"] - 0.54) < 0.01
    ch = character(pos, lambda s: fund.get(s))
    # beta over AAPL+MSFT (9000): (6000*1.2 + 3000*0.9)/9000 = 1.1
    assert abs(ch["beta"] - 1.1) < 0.01, ch
    rb = rebalance({"usEquity": {"pct": 90}, "cash": {"pct": 10}},
                   {"usEquity": 70, "cash": 5}, 10000)
    over = next(r for r in rb["rows"] if r["asset_class"] == "usEquity")
    assert over["drift_pct"] == 20.0 and over["trade_usd"] == -2000.0, over   # trim $2000
    assert not rb["in_band"]

    # realized gains — FIFO + ST/LT split + unmatched sell
    hist = [
        {"kind": "equity", "symbol": "X", "side": "buy",  "date": "2024-01-10", "quantity": 10, "price": 100},
        {"kind": "equity", "symbol": "X", "side": "buy",  "date": "2026-06-01", "quantity": 10, "price": 120},
        # sell 15 @ 130 on 2026-07-01: 10 from the 2024 lot (LT, held ~2.5y, gain 10*30=300),
        # 5 from the 2026 lot (ST, held ~1mo, gain 5*10=50)
        {"kind": "equity", "symbol": "X", "side": "sell", "date": "2026-07-01", "quantity": 15, "price": 130},
        # a sell with no prior buy → cost unknown, proceeds only
        {"kind": "equity", "symbol": "Y", "side": "sell", "date": "2026-07-02", "quantity": 4, "price": 50},
        {"kind": "option", "symbol": "SPXW C", "side": "sell", "date": "2026-07-02", "quantity": 1, "price": 5},  # excluded
    ]
    rg = realized_gains(hist, year=2026, st_rate=0.24, lt_rate=0.15)
    assert rg["long_term"]["gain"] == 300.0, rg["long_term"]
    assert rg["short_term"]["gain"] == 50.0, rg["short_term"]
    assert rg["total_gain"] == 350.0
    assert rg["cost_unknown"]["proceeds"] == 200.0, rg["cost_unknown"]   # 4*50
    # tax: 300*.15 + 50*.24 = 45 + 12 = 57
    assert rg["estimated_tax"] == 57.0, rg["estimated_tax"]

    # --- currency scoping: a mixed INR+USD book must NEVER cross-sum ---
    mixed = [P("AAPL", 6000, 4000, "USD", accounts=("us",)),
             P("RELIANCE.NS", 160000, 100000, "INR", accounts=("zerodha",))]
    assert currencies(mixed) == ["INR", "USD"], currencies(mixed)  # INR bucket bigger
    dz_usd = diversification(mixed, lambda s: {"sector": "Tech"}, currency="USD")
    assert dz_usd["total"] == 6000.0, dz_usd["total"]  # USD scope only, NOT 166000
    assert abs(dz_usd["by_sector"]["Tech"] - 100.0) < 0.01  # AAPL is 100% of the USD book
    dz_inr = diversification(mixed, lambda s: {"sector": "Energy"}, currency="INR")
    assert dz_inr["total"] == 160000.0  # INR scope only

    # winners/losers by gain % (currency-agnostic %)
    wl = winners_losers(mixed)
    top = wl["winners_pct"][0]
    assert top["symbol"] == "RELIANCE.NS" and top["gain_pct"] == 60.0, top  # 60000/100000
    assert wl["winners_pct"][1]["symbol"] == "AAPL"  # 2000/4000 = 50%

    # per-account concentration (never cross-summing currencies)
    ba = by_account(mixed, lambda a: {"name": a.title(), "broker": a})
    assert ba["concentration"]["USD"]["top_account"] == "us"
    assert ba["concentration"]["INR"]["top_pct"] == 100.0  # zerodha holds all INR

    # risk: value-weighted returns, Sharpe/vol/drawdown; data-gated
    up = [100, 101, 102, 101, 103, 104, 103, 105, 106, 107, 106, 108, 109,
          110, 109, 111, 112, 113, 112, 114, 115]  # 21 closes → 20 returns
    rk = risk([P("AAPL", 6000, 4000)], lambda s: up)
    assert rk["available"] and rk["days"] == 20, rk
    assert rk["vol_annual_pct"] > 0 and rk["max_drawdown_pct"] <= 0, rk
    rk0 = risk([P("AAPL", 6000, 4000)], lambda s: None)  # no bars → honest empty
    assert rk0["available"] is False, rk0
    print("ok — portfolio analyzer self-check passed")


if __name__ == "__main__":
    _demo()
