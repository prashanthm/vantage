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
        name="vantage.quotes",
        annotations=_READ_ONLY,
        description="Current quote snapshot (price, day %, asset class) for every "
                    "known symbol, with source and staleness flags.",
    )
    def quotes() -> dict:
        snap = snapshot()
        return envelope("quotes", snap, quotes=to_jsonable(snap.quotes))

    return mcp


def main() -> None:
    create_mcp().run(transport="streamable-http")


if __name__ == "__main__":
    main()
