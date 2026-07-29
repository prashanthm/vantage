"""MCP tool surface for Mira — the SAME engine, exposed as typed read-only tools.

Mira (the AI side, :8080) performs no portfolio math: it calls these tools and
grounds its answers on the results. Every tool result is a JSON-safe dict and
carries a provenance block

    {"source_type": "vantage", "source_id": "<data-dir>#<dataset>"}

so the AI side can attribute every number it repeats. All tools declare
readOnlyHint — there is nothing to mutate (ADR-010).

Transport: streamable HTTP on 127.0.0.1:8640, path /mcp (`make -C mcp run`).

This is its own project (vantage-mcp): the AI-facing tool surface, depending on
the vantage-server engine package but with an independent lifecycle.
"""
from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from vantage_server import analyze
from vantage_server import bars_view
from vantage_server import engine
from vantage_server.ml.roundtrips import summarize_rows as ml_summarize
from vantage_server.models import QuoteSnapshot, to_jsonable
from vantage_server.quotes import get_provider
from vantage_server.signals import grade_signals
from vantage_server.store import Store

MCP_HOST = os.environ.get("MCP_HOST", "127.0.0.1")
MCP_PORT = int(os.environ.get("MCP_PORT", "8640"))
MCP_PATH = os.environ.get("MCP_PATH", "/mcp")

_READ_ONLY = ToolAnnotations(readOnlyHint=True)


class PlaybookUnavailable(RuntimeError):
    """No intraday playbook row exists — the ~15m recompute has not landed one.
    Surfaced to the caller (Mira) as a hard tool error, never a quiet empty."""


class PlaybookStale(RuntimeError):
    """The freshest intraday playbook row is for the wrong (older) session —
    the recompute wrote a wrong-dated row. Surfaced, never silently served."""


def _current_session_et() -> str:
    """Today's ET trading date (the day an intraday map must be labelled for).
    Matches the UI's freshness key (api.py `/api/spx/snapshot`): the intraday
    row's ``date`` must equal this."""
    import datetime as _dt
    from zoneinfo import ZoneInfo
    return _dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def create_mcp(data_dir: str | os.PathLike[str] | None = None) -> FastMCP:
    store = Store(data_dir)
    dataset = store.load_dataset()

    mcp = FastMCP(
        name="vantage",
        instructions=(
            "Read-only deterministic portfolio engine for the Vantage household "
            "accounts. All portfolio math (positions, allocation, wash-sale "
            "windows, TLH candidates) happens here — never recompute it."
        ),
        host=MCP_HOST,
        port=MCP_PORT,
        streamable_http_path=MCP_PATH,
    )

    def provenance(name: str) -> dict:
        return {"source_type": "vantage", "source_id": f"{store.data_dir}#{name}"}

    def snapshot() -> QuoteSnapshot:
        return get_provider(store.data_dir).snapshot()

    def envelope(name: str, snap: QuoteSnapshot, **data) -> dict:
        return {
            "as_of": snap.as_of,
            "source": snap.source,
            "stale": snap.stale,
            # SQLite-only datasets read as empty on a JSON data dir; the flag
            # lets a consumer tell "no data" from "wrong backend".
            "backend": "sqlite" if store.uses_sqlite else "json",
            **data,
            "provenance": provenance(name),
        }

    @mcp.tool(
        name="vantage.positions",
        annotations=_READ_ONLY,
        description="Consolidated positions (shares, value, cost, unrealized P/L, "
                    "weight, overlap flags) for one account id or 'all'.",
    )
    def positions(account: str = "all") -> dict:
        snap = snapshot()
        rows = engine.positions(dataset.lots, snap.quotes, account, accounts=dataset.accounts)
        return envelope("positions", snap, account=account, positions=to_jsonable(rows))

    @mcp.tool(
        name="vantage.allocation",
        annotations=_READ_ONLY,
        description="Asset-class allocation (usEquity/intlEquity/bonds/cash values "
                    "and percentages) for one account id or 'all'.",
    )
    def allocation(account: str = "all") -> dict:
        snap = snapshot()
        alloc = engine.allocation(dataset.lots, snap.quotes, account, accounts=dataset.accounts)
        by_class = {
            cls: {"value": v, "pct": (v / alloc.total * 100) if alloc.total else 0.0}
            for cls, v in alloc.by_class.items()
        }
        return envelope("allocation", snap, account=account, total=alloc.total,
                        by_class=by_class)

    @mcp.tool(
        name="vantage.portfolio_snapshot",
        annotations=_READ_ONLY,
        description="The whole 'portfolio DNA' for one account id or 'all': per-currency "
                    "diversification/concentration (HHI), projected dividend income, "
                    "value-weighted beta/PE (character), and risk (annualized vol, Sharpe, "
                    "Sortino, max-drawdown — data-gated with coverage_pct); plus "
                    "winners/losers by gain %, per-account concentration, and allocation "
                    "drift vs the model targets. Currencies are NEVER cross-summed. This "
                    "is the input a portfolio analyst reasons over to produce actions.",
    )
    def portfolio_snapshot(account: str = "all") -> dict:
        from vantage_server import portfolio as _pf  # noqa: PLC0415
        from vantage_server import fundamentals as _fund  # noqa: PLC0415
        snap = snapshot()
        rows = engine.positions(dataset.lots, snap.quotes, account, accounts=dataset.accounts)
        positions = to_jsonable(rows)

        _fc: dict[str, dict | None] = {}
        def fund_of(sym: str):
            s = (sym or "").upper()
            if s not in _fc:
                try:
                    _fc[s] = _fund.fundamentals(s, store.data_dir)
                except Exception:  # noqa: BLE001
                    _fc[s] = None
            return _fc[s]

        _cc: dict[str, list[float] | None] = {}
        def closes_of(sym: str):
            s = (sym or "").upper()
            if s not in _cc:
                data = store.load_bars(s) or {}
                daily = data.get("daily") if isinstance(data, dict) else None
                _cc[s] = [float(b["close"]) for b in daily
                          if isinstance(b, dict) and b.get("close") is not None] if daily else None
            return _cc[s]

        ameta = {a.id: {"name": a.name, "broker": store.get_meta(f"broker:{a.id}"),
                        "currency": a.currency, "taxable": a.taxable, "type": a.type}
                 for a in dataset.accounts}
        targets = {"usEquity": 70.0, "intlEquity": 10.0, "bonds": 15.0, "cash": 5.0}
        alloc = engine.allocation(dataset.lots, snap.quotes, account, accounts=dataset.accounts)
        by_class = {cls: {"value": v, "pct": (v / alloc.total * 100) if alloc.total else 0.0}
                    for cls, v in alloc.by_class.items()}
        dna = _pf.snapshot(positions, fund_of, closes_of, ameta.get,
                           by_class, targets, alloc.total)
        return envelope("portfolio_snapshot", snap, account=account, **dna)

    @mcp.tool(
        name="vantage.wash_status",
        annotations=_READ_ONLY,
        description="Cross-account wash-sale status (30-day window, substantially-"
                    "identical families, auto-buy look-ahead) for one symbol, or "
                    "every held symbol when omitted.",
    )
    def wash_status(symbol: str | None = None) -> dict:
        snap = snapshot()
        today = engine.parse_as_of(snap.as_of)
        symbols = (
            [symbol]
            if symbol
            else sorted({l.symbol for l in dataset.lots if l.symbol != "CASH"})
        )
        statuses = {
            sym: to_jsonable(
                engine.wash_status(
                    sym,
                    accounts=dataset.accounts,
                    recent_buys=dataset.recent_buys,
                    auto_buys=dataset.auto_buys,
                    today=today,
                    lots=dataset.lots,
                )
            )
            for sym in symbols
        }
        return envelope("wash_status", snap, window_days=engine.WASH_WINDOW_DAYS,
                        wash=statuses)

    @mcp.tool(
        name="vantage.tlh_candidates",
        annotations=_READ_ONLY,
        description="Tax-loss-harvest candidates per lot: status na/below/blocked/"
                    "clear, wash detail, and partner-map replacement. Thresholds "
                    "default to $200 / 3% (either one qualifies a loss).",
    )
    def tlh_candidates(
        threshold_usd: float = engine.DEFAULT_THRESHOLD_USD,
        threshold_pct: float = engine.DEFAULT_THRESHOLD_PCT,
    ) -> dict:
        snap = snapshot()
        today = engine.parse_as_of(snap.as_of)
        cands = engine.tlh_candidates(
            dataset.lots,
            snap.quotes,
            accounts=dataset.accounts,
            recent_buys=dataset.recent_buys,
            auto_buys=dataset.auto_buys,
            partner_map=dataset.partner_map,
            today=today,
            threshold_usd=threshold_usd,
            threshold_pct=threshold_pct,
        )
        return envelope("tlh_candidates", snap, threshold_usd=threshold_usd,
                        threshold_pct=threshold_pct, candidates=to_jsonable(cands))

    @mcp.tool(
        name="vantage.lots",
        annotations=_READ_ONLY,
        description="Raw tax lots (account, symbol, purchase date, shares, cost "
                    "per share) for one account id or 'all'.",
    )
    def lots(account: str = "all") -> dict:
        snap = snapshot()
        return envelope("lots", snap, account=account,
                        lots=to_jsonable(engine.select_lots(dataset.lots, account)))

    signal_seed = store.load_signals()

    @mcp.tool(
        name="vantage.signals",
        annotations=_READ_ONLY,
        description="Trade signals graded against the current quote snapshot: "
                    "status open/hit_target/stopped (or unquoted), signed P/L % "
                    "vs entry, and progress grade A-F. Statuses are computed "
                    "from quotes, never authored. Optional symbol filter.",
    )
    def signals(symbol: str | None = None) -> dict:
        snap = snapshot()
        graded = grade_signals(signal_seed, snap.quotes)
        if symbol:
            graded = [g for g in graded if g.signal.sym == symbol.upper()]
        return envelope("signals", snap, symbol=symbol, signals=to_jsonable(graded))

    @mcp.tool(
        name="vantage.history",
        annotations=_READ_ONLY,
        description="Imported broker transaction history (equity + option "
                    "orders, newest first): date, kind equity/option/other, "
                    "symbol (options use the compact 'UND YYYY-MM-DD 750C' "
                    "form), side, quantity, price, signed amount (buys "
                    "negative), state. Optional account filter and limit. "
                    "Empty when no history has been imported.",
    )
    def history(account: str = "all", limit: int = 200) -> dict:
        snap = snapshot()
        # Read per call: history.json appears/changes when the operator
        # imports with --with-history; a missing file is an empty list.
        rows = store.load_history()
        if account != "all":
            rows = [r for r in rows if r.get("account") == account]
        return envelope("history", snap, account=account,
                        history=to_jsonable(rows[:max(int(limit), 0)]))

    @mcp.tool(
        name="vantage.strategies",
        annotations=_READ_ONLY,
        description="Options STRATEGY roll-up (importer --with-strategies). "
                    "by='strategy' (default): OPEN strategies grouped from "
                    "current option positions "
                    "(single/vertical/butterfly/iron/calendar/multi-leg/complex, "
                    "with net_cost, current_value, unrealized, max_profit/loss, "
                    "dte) — SHORT LEGS INCLUDED and netted, unlike the lots view "
                    "— plus CLOSED per-order rows from option order history "
                    "(one row per spread order: direction, signed cash moved, "
                    "state; realize only 'filled'). by='ticker': the per-"
                    "underlying POSITION BOOK — EVERY option leg of a ticker "
                    "combined into one row regardless of expiry/strike (netting "
                    "a diagonal's short credit into the long's cost): net_cost "
                    "(signed debit), current_value, unrealized, first/last "
                    "opened, leg_count, has_short, spans_expiries. Optional "
                    "account filter (open + by_ticker rows; closed rows carry no "
                    "vantage account) and status open|closed|all. Empty when "
                    "nothing imported.",
    )
    def strategies(account: str = "all", status: str = "all",
                   by: str = "strategy") -> dict:
        snap = snapshot()
        # Read per call: strategies.json appears/changes on import.
        rollup = store.load_strategies()
        if by == "ticker":
            by_ticker_rows = rollup["by_ticker"]
            if account != "all":
                by_ticker_rows = [r for r in by_ticker_rows
                                  if r.get("account") == account]
            return envelope("strategies", snap, account=account, by=by,
                            strategies_as_of=rollup["as_of"],
                            by_ticker=to_jsonable(by_ticker_rows))
        open_rows = rollup["open"]
        closed_rows = rollup["closed"]
        if account != "all":
            open_rows = [r for r in open_rows if r.get("account") == account]
            closed_rows = []  # closed rows have no vantage account id
        if status == "open":
            closed_rows = []
        elif status == "closed":
            open_rows = []
        return envelope("strategies", snap, account=account, status=status,
                        strategies_as_of=rollup["as_of"],
                        open=to_jsonable(open_rows), closed=to_jsonable(closed_rows))

    @mcp.tool(
        name="vantage.quotes",
        annotations=_READ_ONLY,
        description="Current quote snapshot (price, day %, asset class) for every "
                    "known symbol, with source and staleness flags.",
    )
    def quotes() -> dict:
        snap = snapshot()
        return envelope("quotes", snap, quotes=to_jsonable(snap.quotes))

    @mcp.tool(
        name="vantage.bars",
        annotations=_READ_ONLY,
        description="Deep OHLCV bars + computed support/resistance levels for one "
                    "ticker (written by snapshot_bars; ~10yr daily backfill). "
                    "timeframe daily|weekly|monthly (default daily). Returns "
                    "{symbol, as_of, timeframe, bars:[{date,open,high,low,close,"
                    "volume}], levels:{support:[{price,strength,kind}], "
                    "resistance:[...]}, first_bar, last_bar, bar_count}. Levels "
                    "are technicals.support_resistance at the last close — never "
                    "recompute them. Empty {bars:[]} with no_bars=true when the "
                    "ticker has no bars file (or no symbol given).",
    )
    def bars(symbol: str = "", timeframe: str = "daily") -> dict:
        snap = snapshot()
        if not symbol.strip():
            return envelope("bars", snap, symbol="", timeframe=timeframe,
                            bars=[], levels={"support": [], "resistance": []},
                            no_bars=True)
        try:
            payload = bars_view.bars_payload(store.data_dir, symbol, timeframe)
        except ValueError:
            return envelope("bars", snap, symbol=symbol.upper(), timeframe=timeframe,
                            error="unknown timeframe (want daily|weekly|monthly)",
                            bars=[], levels={"support": [], "resistance": []},
                            no_bars=True)
        except bars_view.BarsNotFound:
            return envelope("bars", snap, symbol=symbol.upper(), timeframe=timeframe,
                            bars=[], levels={"support": [], "resistance": []},
                            no_bars=True)
        return envelope("bars", snap, no_bars=False, **payload)

    @mcp.tool(
        name="vantage.fundamentals",
        annotations=_READ_ONLY,
        description="Slow-moving valuation context for one ticker from yfinance "
                    "(disk-cached ~6h). Returns {symbol, name, sector, market_cap, "
                    "pe, forward_pe, week52_low, week52_high, target_mean, "
                    "dividend_yield, beta} with null for any field the source "
                    "omits (ETFs return mostly nulls — no single P/E or target). "
                    "no_data=true when yfinance yields nothing (never fabricate "
                    "numbers).",
    )
    def fundamentals(symbol: str = "") -> dict:
        from vantage_server import fundamentals as fund  # noqa: PLC0415
        snap = snapshot()
        if not symbol.strip():
            return envelope("fundamentals", snap, symbol="", fundamentals=None,
                            no_data=True)
        data = fund.fundamentals(symbol.upper(), store.data_dir)
        return envelope("fundamentals", snap, symbol=symbol.upper(),
                        fundamentals=data, no_data=data is None)

    @mcp.tool(
        name="vantage.news",
        annotations=_READ_ONLY,
        description="Recent news for one ticker — aggregated across the configured "
                    "sources (yfinance today; pluggable), deduped, newest-first, "
                    "with a headline SENTIMENT LEAN. Returns {symbol, items:[{title,"
                    "summary,publisher,published,url,source}], sentiment:{score,"
                    "band(negative|neutral|positive),n_headlines,method,estimated}}. "
                    "sentiment.estimated is ALWAYS true (a lexicon lean over titles, "
                    "not ground truth) — cite it as such. no_news=true when no "
                    "source yields items (never fabricate headlines).",
    )
    def news(symbol: str = "") -> dict:
        from vantage_server import news as news_mod  # noqa: PLC0415
        snap = snapshot()
        if not symbol.strip():
            return envelope("news", snap, symbol="", news=None, no_news=True)
        data = news_mod.news(symbol.upper(), store.data_dir)
        return envelope("news", snap, symbol=symbol.upper(), news=data,
                        no_news=data is None)

    @mcp.tool(
        name="vantage.growth",
        annotations=_READ_ONLY,
        description="GROWTH/QUALITY read for one ticker from its financial "
                    "statements (yfinance, cached ~weekly): revenue_ttm, "
                    "revenue_yoy (+basis ttm|annual), gross/operating margin, "
                    "fcf_ttm, fcf_margin, sbc_ttm, sbc_pct_revenue, rule_of_40 "
                    "(+basis, growth+FCF-margin variant). The complement to "
                    "vantage.fundamentals: ratios say what the market pays, this "
                    "says what the business is doing. Every field nullable — "
                    "ETFs have no statements (no_data=true); never fabricated.",
    )
    def growth(symbol: str = "") -> dict:
        from vantage_server import growth as growth_mod  # noqa: PLC0415
        snap = snapshot()
        if not symbol.strip():
            return envelope("growth", snap, symbol="", growth=None, no_data=True)
        data = growth_mod.growth(symbol.upper(), store.data_dir)
        return envelope("growth", snap, symbol=symbol.upper(), growth=data,
                        no_data=data is None)

    @mcp.tool(
        name="vantage.expectations",
        annotations=_READ_ONLY,
        description="REVERSE DCF for one ticker — what 10y FCF growth the "
                    "current price already implies (compare against "
                    "vantage.growth revenue_yoy to see if the bar is realistic). "
                    "Two-stage model; assumptions echoed in the payload "
                    "(discount_rate, terminal_growth, horizon) — always cite "
                    "them when quoting implied growth. implied.status explains "
                    "any null: negative_fcf means implied growth is undefined "
                    "(say so, don't guess); scenarios[] shows fair value at "
                    "0/10/20/30% growth vs the current price. Model-derived "
                    "context, not a price target.",
    )
    def expectations(symbol: str = "") -> dict:
        from vantage_server import expectations as exp_mod  # noqa: PLC0415
        from vantage_server import fundamentals as fund  # noqa: PLC0415
        from vantage_server import growth as growth_mod  # noqa: PLC0415
        snap = snapshot()
        if not symbol.strip():
            return envelope("expectations", snap, symbol="", inputs=None,
                            assumptions=None, implied=None, scenarios=[],
                            no_data=True)
        from vantage_server.relative_strength import is_us_symbol  # noqa: PLC0415
        sym = symbol.upper()
        if not is_us_symbol(sym):
            # US cost-of-capital / US-GDP terminal growth don't hold for a
            # foreign-listed name; a reverse DCF under those assumptions is
            # invalid, so gate it off rather than emit a wrong implied growth.
            return envelope("expectations", snap, symbol=sym, inputs=None,
                            assumptions=None, implied=None, scenarios=[],
                            no_data=True,
                            reason="non-US listing — US-cost-of-capital DCF inapplicable")
        quote = snap.quotes.get(sym)
        price = quote.price if quote else None
        data = exp_mod.expectations(
            fund.fundamentals(sym, store.data_dir),
            growth_mod.growth(sym, store.data_dir),
            price,
        )
        data["symbol"] = sym
        return envelope("expectations", snap,
                        no_data=data["implied"]["status"] != "ok", **data)

    @mcp.tool(
        name="vantage.earnings",
        annotations=_READ_ONLY,
        description="CATALYST PATH for one ticker: the next earnings date "
                    "(cached broker dates) PLUS the forward calendar — "
                    "ex-dividend and monthly/quarterly OpEx — fused into "
                    "catalyst_path.events (ordered, days_until each) with "
                    "next_catalyst as the nearest. An 'act now' recommendation "
                    "should be conditional on next_catalyst.days_until<=7. "
                    "future_date_known=false means the earnings cache has no "
                    "upcoming date (may be stale) — NEVER 'no earnings'. Every "
                    "event has a real date; nothing is fabricated. no_data=true "
                    "only when NO dated event (not even OpEx) is in the window.",
    )
    def earnings(symbol: str = "") -> dict:
        from vantage_server.engine import parse_as_of  # noqa: PLC0415
        from vantage_server.ml import events as events_mod  # noqa: PLC0415
        snap = snapshot()
        if not symbol.strip():
            return envelope("earnings", snap, symbol="", earnings=None,
                            no_data=True)
        sym = symbol.upper()
        record = store.load_earnings(sym) or {}
        if not (record.get("dates") or record.get("earnings")):
            # No earnings cache yet — but OpEx (and any ex-div) are still a real
            # forward path, so serve those rather than a blank no_data.
            from vantage_server import catalysts as cat_mod  # noqa: PLC0415
            from vantage_server import fundamentals as fund_mod  # noqa: PLC0415
            from vantage_server.spx_playbook import opex_layer  # noqa: PLC0415
            today = parse_as_of(snap.as_of).date()
            fund = fund_mod.fundamentals(sym, store.data_dir) or {}
            path = cat_mod.catalyst_path(
                today, ex_dividend=fund.get("ex_dividend_date"),
                opex=opex_layer(today))
            has_any = bool(path["events"])
            return envelope("earnings", snap, symbol=sym, no_data=not has_any,
                            earnings={
                                "next_date": None, "days_until": None,
                                "last_date": None, "days_since": None,
                                "recent": [], "dates_as_of": None,
                                "future_date_known": False,
                                "catalyst_path": path,
                                "next_catalyst": path["next"],
                            } if has_any else None)
        from vantage_server import catalysts as cat_mod  # noqa: PLC0415
        from vantage_server import fundamentals as fund_mod  # noqa: PLC0415
        from vantage_server.spx_playbook import opex_layer  # noqa: PLC0415
        today = parse_as_of(snap.as_of).date()
        calendar = events_mod.next_earnings(record.get("dates") or [], today)
        rows = sorted(
            (e for e in (record.get("earnings") or []) if e.get("date")),
            key=lambda e: str(e["date"]), reverse=True,
        )[:8]
        # Forward catalyst PATH beyond earnings: ex-dividend (yfinance) + the
        # monthly/quarterly OpEx (deterministic), fused into one ordered
        # timeline. Nothing fabricated — a source without a date drops out.
        fund = fund_mod.fundamentals(sym, store.data_dir) or {}
        path = cat_mod.catalyst_path(
            today,
            earnings_dates=record.get("dates") or [],
            ex_dividend=fund.get("ex_dividend_date"),
            opex=opex_layer(today),
        )
        return envelope("earnings", snap, symbol=sym, no_data=False, earnings={
            **calendar,
            "recent": [{"date": str(e.get("date"))[:10],
                        "eps_estimate": e.get("eps_estimate"),
                        "eps_actual": e.get("eps_actual")} for e in rows],
            "dates_as_of": record.get("as_of"),
            "future_date_known": calendar["next_date"] is not None,
            "catalyst_path": path,          # ordered forward events (V5)
            "next_catalyst": path["next"],  # the nearest — the act-now gate
        })

    @mcp.tool(
        name="vantage.ticker_plan",
        annotations=_READ_ONLY,
        description="The operator's stored THESIS for one ticker — why the "
                    "position is held, price target, stop/invalidation level, "
                    "notes, plus recent journal entries AND the computed "
                    "risk_reward (upside/downside/rr_ratio at the current "
                    "price; status stop_breached/target_reached when outside "
                    "the band). Weigh any sell/close recommendation against "
                    "this before endorsing it: a technical signal that "
                    "contradicts an intact thesis needs the stronger case "
                    "stated, and the R:R math is the bet's geometry. "
                    "has_plan=false means no thesis is on file (say so — "
                    "never invent one). Written only via the Vantage UI; "
                    "this surface is read-only.",
    )
    def ticker_plan(symbol: str = "", journal_limit: int = 5) -> dict:
        from vantage_server.risk_reward import risk_reward as rr  # noqa: PLC0415
        snap = snapshot()
        if not symbol.strip():
            return envelope("ticker_plan", snap, symbol="", has_plan=False,
                            plan=None, journal=[], risk_reward=None)
        sym = symbol.upper()
        plan = store.load_ticker_plan(sym)
        journal = store.load_ticker_journal(sym, limit=max(0, int(journal_limit)))
        # Underlying price: live quote when the snapshot has it; otherwise the
        # last synced daily close (an options-only position quotes the option
        # symbol, never the bare underlying).
        quote = snap.quotes.get(sym)
        price, price_source = (quote.price, "quote") if quote else (None, None)
        if price is None:
            bars = store.load_bars(sym)
            daily = bars.get("daily") if isinstance(bars, dict) else None
            if isinstance(daily, list) and daily and daily[-1].get("close"):
                price, price_source = float(daily[-1]["close"]), "last_close"
        geometry = rr(plan, price)
        if isinstance(geometry, dict):
            geometry["price_source"] = price_source
        return envelope("ticker_plan", snap, symbol=sym,
                        has_plan=plan is not None, plan=plan,
                        journal=to_jsonable(journal),
                        risk_reward=geometry)

    @mcp.tool(
        name="vantage.relative_strength",
        annotations=_READ_ONLY,
        description="FACTOR DECOMPOSITION for one ticker from the synced "
                    "bars: trailing returns (1w/1m/3m) for the name vs SPY vs "
                    "its sector ETF, beta vs SPY, and idio_r_1m (the move "
                    "beta can't explain). Use it to distinguish 'the NAME is "
                    "breaking down' from 'its sector/the market is selling "
                    "off' before endorsing any technical signal. Benchmarks "
                    "null when their bars aren't synced (benchmark_available) "
                    "— never fabricated. no_data=true when the name has no "
                    "bars.",
    )
    def relative_strength(symbol: str = "") -> dict:
        from vantage_server import relative_strength as rs_mod  # noqa: PLC0415
        snap = snapshot()
        if not symbol.strip():
            return envelope("relative_strength", snap, symbol="",
                            relative_strength=None, no_data=True)
        data = rs_mod.relative_strength(symbol.upper(), store.data_dir)
        return envelope("relative_strength", snap, symbol=symbol.upper(),
                        relative_strength=data, no_data=data is None)

    @mcp.tool(
        name="vantage.rec_scorecard",
        annotations=_READ_ONLY,
        description="The decision journal's OWN TRACK RECORD: every past "
                    "recommendation scored against subsequent bars (+5d/+20d "
                    "forward returns, per-rule hit rate under the pinned "
                    "hit_basis). Weigh a firing rule's signal BY its record — "
                    "a 50% rule is a coin flip, not a mandate. n_pending "
                    "counts decisions too young to score (never "
                    "extrapolated). no_data=true when nothing journaled yet.",
    )
    def rec_scorecard() -> dict:
        from vantage_server import rec_scorecard as sc_mod  # noqa: PLC0415
        snap = snapshot()
        data = sc_mod.rec_scorecard(store.data_dir)
        return envelope("rec_scorecard", snap, scorecard=data,
                        no_data=data is None)

    @mcp.tool(
        name="vantage.spx_playbook",
        annotations=_READ_ONLY,
        description="The daily 0DTE PLAYBOOK for an index (`symbol`: SPX default, "
                    "or QQQ / IWM; written nightly by `python -m "
                    "vantage_server.spx_playbook --symbol`; fuses that underlying's "
                    "dealer-gamma GEX with its 15m chart dimensions). "
                    "Returns {available, session, scaffold:{regime, level_ladder:"
                    "[{price,kind,source}], setups:[{trigger,bias,structure,levels}], "
                    "catalysts, opex, edges, caveats}, narrative}. Every setup is "
                    "CONDITIONAL on a real level. Context, not a signal (ADR-008); "
                    "the GEX read is 0DTE-blind. Serves the LIVE intraday map "
                    "(`SPX:intraday`, rebuilt every ~15m at live spot) — NOT the "
                    "overnight plan; raises PlaybookStale if the freshest stored "
                    "session isn't the current one (never silently serves "
                    "yesterday's levels).",
    )
    def spx_playbook(date: str | None = None, symbol: str = "SPX") -> dict:
        snap = snapshot()
        sym = (symbol or "SPX").upper()
        # Intraday-ONLY read. No fallback to the overnight `SPX` key — a fallback
        # would silently serve yesterday's plan on exactly the days the intraday
        # write is broken (the stale-label bug), which is what we must surface.
        row = store.load_spx_playbook(date, symbol=f"{sym}:intraday")
        if row is None:
            raise PlaybookUnavailable(
                f"no intraday playbook stored for {sym}"
                + (f" on {date}" if date else "")
                + " — the ~15m recompute has not landed a row")
        # Freshness gate keyed on the row's `date` (the day the map is FOR) —
        # same key the UI uses (api.py /api/spx/snapshot). Must equal the caller's
        # explicit date, or today's ET session when date is omitted.
        served = str(row.get("date") or "")
        want = date or _current_session_et()
        if served != want:
            raise PlaybookStale(
                f"{sym} intraday playbook is stale: served date {served!r}, "
                f"expected {want!r} — recompute wrote a wrong-dated row")
        return envelope("spx_playbook", snap, available=True,
                        playbook=row, no_playbook=False)

    @mcp.tool(
        name="vantage.analysis",
        annotations=_READ_ONLY,
        description="The nightly covered-call / cost-reduction DECISION JOURNAL "
                    "(written by `python -m vantage_server.analyze`). Each "
                    "position's recommendation "
                    "(HOLD_AND_SELL_CALL/CLOSE_AND_BOOK_LOSS/HOLD_WASH_BLOCKED/"
                    "MONITOR), rationale, full evidence (per-timeframe trend/"
                    "momentum, support/resistance, conviction score+label, which "
                    "rule fired), and action_detail (strike/credit/basis math for "
                    "holds, loss + wash status for closes). Optional date "
                    "(YYYY-MM-DD; latest when omitted) and symbol filter. Empty "
                    "when nothing has been journaled. Read this — never recompute "
                    "the playbook.",
    )
    def analysis(date: str | None = None, symbol: str | None = None) -> dict:
        snap = snapshot()
        # SQLite-aware read (see position_actions note) — not analyze.load_day.
        day = store.load_analysis_day(date)
        decisions = (day or {}).get("decisions", [])
        if symbol:
            want = symbol.upper()
            decisions = [d for d in decisions
                         if str(d.get("symbol", "")).upper() == want]
        return envelope("analysis", snap, date=(day or {}).get("as_of", date),
                        generated_at=(day or {}).get("generated_at"),
                        symbol=symbol, decisions=decisions)

    @mcp.tool(
        name="vantage.position_actions",
        annotations=_READ_ONLY,
        description="COMPACT per-symbol actions from the latest nightly journal — "
                    "just {symbol, conviction, recommendation, action_detail} for "
                    "each position, stripped of the full evidence block. The "
                    "advisor-facing view: what to do per position, without the "
                    "underlying technical read. Optional symbol filter. Empty when "
                    "nothing has been journaled.",
    )
    def position_actions(symbol: str | None = None) -> dict:
        snap = snapshot()
        # Read through the store (SQLite-aware) — analyze.load_day only reads
        # JSON files, so on a SQLite-backed data dir it returns nothing and every
        # symbol's actions come back empty. store.load_analysis_day delegates to
        # analyze.load_day on JSON, so both backends work.
        day = store.load_analysis_day()
        decisions = (day or {}).get("decisions", [])
        if symbol:
            want = symbol.upper()
            decisions = [d for d in decisions
                         if str(d.get("symbol", "")).upper() == want]
        # Position context (analyst sizing read): weight vs book, multiple of
        # the median position, value — from the same engine positions the
        # /positions tool serves. Sizing is decision-critical for add/close
        # calls, so it rides every action row.
        rows = engine.positions(dataset.lots, snap.quotes, "all")
        by_symbol = {p.symbol: p for p in rows}
        values = sorted(p.value for p in rows if p.value > 0)
        median_value = values[len(values) // 2] if values else None

        def _context(sym: str) -> dict | None:
            pos = by_symbol.get(str(sym or "").upper())
            if pos is None:
                return None
            return {
                "weight_pct": round(pos.weight, 2),  # engine weight is 0-100
                "value": round(pos.value, 2),
                "x_median_position": (round(pos.value / median_value, 1)
                                      if median_value else None),
            }

        actions = [
            {
                "symbol": d.get("symbol"),
                "conviction": d.get("conviction"),
                "recommendation": d.get("recommendation"),
                "rationale": d.get("rationale"),
                "action_detail": d.get("action_detail"),
                "position_context": _context(d.get("symbol")),
            }
            for d in decisions
        ]
        return envelope("position_actions", snap, date=(day or {}).get("as_of"),
                        symbol=symbol, actions=actions)

    @mcp.tool(
        name="vantage.roundtrips",
        annotations=_READ_ONLY,
        description="Labeled CLOSED round-trips (written by "
                    "vantage_server.ml.build_roundtrips). Each is a matched "
                    "open->close trade carrying the AUTHORITATIVE signed "
                    "realized P/L (from Robinhood's per-close realized_gain — "
                    "never recomputed), win/loss flag, realized_pct vs entry "
                    "cost basis, holding_days, and MFE/MAE excursion in $ and "
                    "pct measured from the underlying's daily bars between open "
                    "and close (for options MFE/MAE is a proxy: proxy=true, the "
                    "underlying's bars, not the contract's marks) plus "
                    "mfe_capture (realized/mfe — money left on the table). When "
                    "a close could not be paired to an open, the round-trip is "
                    "still returned with entry_unknown=true and null entry "
                    "fields (never dropped, never fabricated). Optional account "
                    "and symbol (underlying) filters; the returned summary "
                    "(count, win_rate, avg_win/loss, profit_factor, "
                    "avg_holding_days, avg_mfe_capture, by_kind) is recomputed "
                    "over the filtered set. Empty when nothing has been built.",
    )
    def roundtrips(account: str = "all", symbol: str | None = None) -> dict:
        snap = snapshot()
        # Read per call: ml/roundtrips.json appears/changes on build.
        data = store.load_roundtrips()
        rows = data["roundtrips"]
        if account != "all":
            rows = [r for r in rows if r.get("account") == account]
        if symbol:
            want = symbol.upper()
            rows = [r for r in rows if str(r.get("symbol", "")).upper() == want]
        return envelope("roundtrips", snap, account=account, symbol=symbol,
                        roundtrips_as_of=data["as_of"],
                        roundtrips=to_jsonable(rows),
                        summary=ml_summarize(rows))

    @mcp.tool(
        name="vantage.trade_stats",
        annotations=_READ_ONLY,
        description="Entry-condition trade statistics (written by "
                    "vantage_server.ml.build_features): under what conditions "
                    "the account wins vs loses, with Bayesian credible "
                    "intervals. COMPACT for the advisor — returns the overall "
                    "baseline_win_rate and only the NOTABLE buckets: conditions "
                    "whose 90% credible interval clearly separates from the "
                    "baseline AND have enough trips (n>=min_n) to be "
                    "statistically defensible. Each notable bucket carries "
                    "{dimension (e.g. dte_band, moneyness, daily_trend, "
                    "near_support), value, n, wins, losses, win_rate, mean, "
                    "ci_low, ci_high (the posterior win-rate + interval), "
                    "avg_pnl, total_pnl, kind ('edge' good | 'leak' bad), edge "
                    "(win_rate - baseline), significant}. Buckets that separate "
                    "but are too thin are returned with significant=false. "
                    "Everything NOT notable is 'not enough data' — with a few "
                    "dozen trades most conditions are too thin to trust, and "
                    "that is the point. Optional account filter ('all' = the "
                    "last-built account). Empty when nothing has been built.",
    )
    def trade_stats(account: str = "all") -> dict:
        snap = snapshot()
        # Read per call: ml/trade_stats.json appears/changes on build.
        data = store.load_trade_stats()
        block = data
        if account != "all":
            per = data.get("by_account", {}).get(account)
            block = per if isinstance(per, dict) else {
                "baseline_win_rate": None, "notable": []}
        return envelope("trade_stats", snap, account=account,
                        trade_stats_as_of=data["as_of"],
                        baseline_win_rate=block.get("baseline_win_rate"),
                        notable=to_jsonable(list(block.get("notable") or [])))

    @mcp.tool(
        name="vantage.trade_dna",
        annotations=_READ_ONLY,
        description="The full DNA of ONE executed trade for review: the ±5-bar "
                    "price action around entry AND exit with volume (1-minute "
                    "for a 0DTE, 15-minute for a swing), the technicals at each "
                    "fill (session VWAP + vs-VWAP, ATR, RSI, relative volume), a "
                    "fill-quality read (points moved before/after, fill vs "
                    "prior volume), and how the entry/exit price correlated to "
                    "the session's forecast levels + GEX anchors. Args: day "
                    "(YYYY-MM-DD), trade (integer index into that day's trade "
                    "list), underlying (default SPX — catches SPXW). This is the "
                    "data a trade-analyst reasons over; it does no judging.",
    )
    def trade_dna(day: str, trade: int, underlying: str = "SPX") -> dict:
        from vantage_server import session_activity as _sa
        from vantage_server import trade_dna as _dna
        snap = snapshot()
        sess = _sa.session(store, day, underlying or "SPX")
        trades = sess.get("trades") or []
        if trade < 0 or trade >= len(trades):
            return envelope("trade_dna", snap, available=False,
                            note=f"trade {trade} out of range ({len(trades)} trades)")
        dna = _dna.build(store, day, trades[trade],
                         sess.get("forecast_levels") or [],
                         sess.get("gex_anchors") or [], underlying or "SPX")
        return envelope("trade_dna", snap, available=True, dna=dna)

    @mcp.tool(
        name="vantage.spx_snapshot",
        annotations=_READ_ONLY,
        description="The chart-centric SNAPSHOT the SPX-analyst reasons over to "
                    "answer 'what will price do?': current price + session shape, "
                    "the coach's playbook levels, live technicals (VWAP + "
                    "vs-VWAP, RSI, relative volume, ATR), and the ICT structures "
                    "— unswept liquidity (BSL above / SSL below), active order "
                    "blocks, fresh FVGs, and the level-based DRAW (the nearer "
                    "opposing playbook level; NOT a 1m FVG). From the persisted "
                    "1m bars. Args: day (YYYY-MM-DD; default the latest stored "
                    "session), as_of (ISO time to truncate mid-session), "
                    "underlying (default SPX). Data only — it does no judging.",
    )
    def spx_snapshot(day: str | None = None, as_of: str | None = None,
                     underlying: str = "SPX") -> dict:
        from vantage_server import spx_snapshot as _snap
        snap = snapshot()
        sym = (underlying or "SPX").upper()
        d = day
        if d is None:
            bar_sym = "^GSPC" if sym == "SPX" else sym
            d = store.latest_intraday_day(bar_sym, "1m") if getattr(
                store, "uses_sqlite", False) else None
        out = _snap.build_snapshot(store, d, symbol=sym, as_of=as_of) if d else None
        if out is None:
            return envelope("spx_snapshot", snap, available=False,
                            note="No persisted 1m bars for the session.")
        return envelope("spx_snapshot", snap, available=True, snapshot=out)

    @mcp.tool(
        name="vantage.journal_analysis",
        annotations=_READ_ONLY,
        description="The DETERMINISTIC bundle for a JOURNAL ANALYSIS — an "
                    "aggregate self-assessment of the desk over a date window. "
                    "Returns rubric scores (0-100 per dimension: entry/exit "
                    "discipline, risk & sizing, plan adherence, emotional "
                    "control), a pattern census (each recurring mistake's flag "
                    "count + the trades that evidence it), per-day discipline, "
                    "the per-trade review excerpts it's built from, and the "
                    "PRIOR analysis (so knowledge compounds). Args: window_from, "
                    "window_to (YYYY-MM-DD), underlying (default SPX). A "
                    "journal-analyst reasons over this to write the SWOT + read; "
                    "this tool does no judging.",
    )
    def journal_analysis(window_from: str, window_to: str,
                         underlying: str = "SPX") -> dict:
        from vantage_server import journal_analysis as _ja
        snap = snapshot()
        bundle = _ja.gather(store, window_from, window_to, underlying or "SPX")
        return envelope("journal_analysis", snap, available=True, bundle=bundle,
                        prompt=_ja.build_prompt(bundle))

    @mcp.tool(
        name="vantage.replay_forecasts",
        annotations=_READ_ONLY,
        description="The graded-run bundle for a REPLAY FORECAST — the sequence of "
                    "'what will price do?' forecasts fired at each interval step "
                    "through a chosen day, WITH their CODE-COMPUTED accuracy "
                    "scores. Returns the deterministic calibration (hit-rate "
                    "overall + bucketed by time-of-day / called bias / hourly "
                    "tier; small buckets are flagged insufficient, never a "
                    "fabricated rate), a per-step digest (bias/target/verdict/"
                    "hit), and the PRIOR calibration (so grading compounds). The "
                    "scores are authoritative and code-computed — a forecast-"
                    "grader READS and narrates them; this tool does NO judging "
                    "and invents no numbers. Args: run_id (required).",
    )
    def replay_forecasts(run_id: str) -> dict:
        from vantage_server import replay_forecast as _rf
        snap = snapshot()
        bundle = _rf.gather_grade_bundle(store, run_id)
        if bundle is None:
            return envelope("replay_forecasts", snap, available=False,
                            note=f"run {run_id} has no forecasts")
        return envelope("replay_forecasts", snap, available=True, bundle=bundle,
                        prompt=_rf.build_grade_prompt(bundle))

    @mcp.tool(
        name="vantage.desk_state",
        annotations=_READ_ONLY,
        description=(
            "The DESK STATE — the strategy pipeline at a glance: per-strategy "
            "lifecycle stage + promotion gate (paper WR vs frozen baseline, "
            "PF floor, the gate's own reason string), the scanner paper book "
            "by strategy (WR/PF/net, taken-live), current A+/B setup counts, "
            "the telegram-channel paper records, armed level alerts, and open "
            "paper risk. Answers operational questions like 'which strategy "
            "is closest to promotion?' or 'how is channel X's record?'. "
            "Read-only roll-up; each number's canonical surface is the desk."
        ),
    )
    def desk_state() -> dict:
        from vantage_server import level_alerts as _la
        from vantage_server import lifecycle as _lc
        from vantage_server import telegram_signals as _tg
        from vantage_server.paper import build_spread_book
        from vantage_server.strategy import STRATEGIES
        snap = snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope("desk_state", snap, available=False,
                            note="desk state needs the SQLite backend")
        gates = []
        for sid in sorted(STRATEGIES):
            try:
                g = _lc.evaluate_gate(store, sid)          # pure — no writes
                row = _lc._row(store, sid)                 # noqa: SLF001 — read-only default row
                gates.append({"strategy": sid, "stage": row.get("stage"),
                              "paper_win_rate": g.get("paper_win_rate"),
                              "paper_n": g.get("paper_n"),
                              "baseline_win_rate": g.get("baseline_win_rate"),
                              "passes": g.get("passes"), "reason": g.get("reason")})
            except Exception:  # noqa: BLE001 — one strategy never blanks the read
                gates.append({"strategy": sid, "error": "gate unavailable"})
        book = build_spread_book(store)
        scans = {}
        for fam in ("ict_htf", "breakout_hold", "rsi2_mr"):
            row = store.load_scanner_result(fam) or {}
            hits = (row.get("result") or {}).get("hits") or row.get("hits") or []
            scans[fam] = {"a_plus": sum(1 for h in hits if h.get("tier") == "A+"),
                          "b": sum(1 for h in hits if h.get("tier") != "A+"),
                          "ran_at": row.get("ran_at")}
        tg_book = _tg.build_book(store)
        return envelope(
            "desk_state", snap, available=True,
            lifecycle=gates,
            spread_book={"by_strategy": book.get("by_strategy"),
                         "open_n": len(book.get("open") or []),
                         "stats": book.get("stats")},
            scans=scans,
            telegram={"channels": _tg.channels(store),
                      "by_channel": tg_book.get("by_channel"),
                      "open_n": len(tg_book.get("open") or [])},
            alerts=[a for a in _la.list_alerts(store) if not a.get("fired_at")],
        )

    return mcp


def main() -> None:
    create_mcp().run(transport="streamable-http")


if __name__ == "__main__":
    main()
