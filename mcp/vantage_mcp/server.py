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
from vantage_server.models import QuoteSnapshot, to_jsonable
from vantage_server.quotes import get_provider
from vantage_server.signals import grade_signals
from vantage_server.store import Store

MCP_HOST = "127.0.0.1"
MCP_PORT = 8640
MCP_PATH = "/mcp"

_READ_ONLY = ToolAnnotations(readOnlyHint=True)


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
        rows = engine.positions(dataset.lots, snap.quotes, account)
        return envelope("positions", snap, account=account, positions=to_jsonable(rows))

    @mcp.tool(
        name="vantage.allocation",
        annotations=_READ_ONLY,
        description="Asset-class allocation (usEquity/intlEquity/bonds/cash values "
                    "and percentages) for one account id or 'all'.",
    )
    def allocation(account: str = "all") -> dict:
        snap = snapshot()
        alloc = engine.allocation(dataset.lots, snap.quotes, account)
        by_class = {
            cls: {"value": v, "pct": (v / alloc.total * 100) if alloc.total else 0.0}
            for cls, v in alloc.by_class.items()
        }
        return envelope("allocation", snap, account=account, total=alloc.total,
                        by_class=by_class)

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
        day = analyze.load_day(store.data_dir, date)
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
        day = analyze.load_day(store.data_dir, None)
        decisions = (day or {}).get("decisions", [])
        if symbol:
            want = symbol.upper()
            decisions = [d for d in decisions
                         if str(d.get("symbol", "")).upper() == want]
        actions = [
            {
                "symbol": d.get("symbol"),
                "conviction": d.get("conviction"),
                "recommendation": d.get("recommendation"),
                "rationale": d.get("rationale"),
                "action_detail": d.get("action_detail"),
            }
            for d in decisions
        ]
        return envelope("position_actions", snap, date=(day or {}).get("as_of"),
                        symbol=symbol, actions=actions)

    return mcp


def main() -> None:
    create_mcp().run(transport="streamable-http")


if __name__ == "__main__":
    main()
