"""MCP tool surface tests: listing, read-only annotations, call round-trips
via the SDK's in-memory client transport, and the provenance block Mira
grounds on."""
from __future__ import annotations

import asyncio
import json

import pytest

from mcp.shared.memory import create_connected_server_and_client_session

from vantage_mcp.server import create_mcp

EXPECTED_TOOLS = {
    "vantage.positions",
    "vantage.allocation",
    "vantage.wash_status",
    "vantage.tlh_candidates",
    "vantage.lots",
    "vantage.quotes",
    "vantage.bars",
    "vantage.fundamentals",
    "vantage.news",
    "vantage.growth",
    "vantage.expectations",
    "vantage.earnings",
    "vantage.ticker_plan",
    "vantage.spx_playbook",
    "vantage.signals",
    "vantage.history",
    "vantage.strategies",
    "vantage.analysis",
    "vantage.position_actions",
    "vantage.roundtrips",
    "vantage.trade_stats",
}


@pytest.fixture(scope="module")
def mcp(data_dir):
    return create_mcp(data_dir)


def run_with_client(mcp, coro_fn):
    """Run an async client interaction against the server in-memory."""

    async def runner():
        async with create_connected_server_and_client_session(
            mcp._mcp_server
        ) as client:
            return await coro_fn(client)

    return asyncio.run(runner())


def tool_payload(result) -> dict:
    assert not result.isError, result.content
    if result.structuredContent:
        return result.structuredContent
    return json.loads(result.content[0].text)


def test_tool_listing_and_read_only_hints(mcp):
    async def interact(client):
        return await client.list_tools()

    listing = run_with_client(mcp, interact)
    by_name = {t.name: t for t in listing.tools}
    assert set(by_name) == EXPECTED_TOOLS
    for name, tool in by_name.items():
        assert tool.annotations is not None, f"{name} missing annotations"
        assert tool.annotations.readOnlyHint is True, f"{name} not read-only"
        assert tool.description


def test_flat_input_schemas(mcp):
    async def interact(client):
        return await client.list_tools()

    listing = run_with_client(mcp, interact)
    by_name = {t.name: t for t in listing.tools}
    pos_props = by_name["vantage.positions"].inputSchema.get("properties", {})
    assert "account" in pos_props
    tlh_props = by_name["vantage.tlh_candidates"].inputSchema.get("properties", {})
    assert {"threshold_usd", "threshold_pct"} <= set(tlh_props)
    # no required params anywhere — every tool is callable with {}
    for tool in listing.tools:
        assert not tool.inputSchema.get("required")


@pytest.mark.parametrize("name", sorted(EXPECTED_TOOLS))
def test_every_tool_result_has_provenance(mcp, name, data_dir):
    async def interact(client):
        return await client.call_tool(name, {})

    payload = tool_payload(run_with_client(mcp, interact))
    prov = payload["provenance"]
    assert prov["source_type"] == "vantage"
    dataset = name.split(".", 1)[1]
    assert prov["source_id"] == f"{data_dir}#{dataset}"
    assert payload["source"] == "fixture"
    assert payload["as_of"] == "2026-07-05T09:30:00-04:00"


def test_positions_round_trip(mcp):
    async def interact(client):
        return await client.call_tool("vantage.positions", {"account": "fid-taxable"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["account"] == "fid-taxable"
    total = sum(p["value"] for p in payload["positions"])
    assert total == pytest.approx(83_627.05)


def test_wash_status_single_symbol(mcp):
    async def interact(client):
        return await client.call_tool("vantage.wash_status", {"symbol": "VOO"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert list(payload["wash"]) == ["VOO"]
    assert payload["wash"]["VOO"]["blocked"] is True
    assert payload["wash"]["VOO"]["clears_on_date"] == "2026-08-01"


def test_wash_status_all_held_symbols(mcp):
    async def interact(client):
        return await client.call_tool("vantage.wash_status", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert "CASH" not in payload["wash"]
    blocked = {s for s, w in payload["wash"].items() if w["blocked"]}
    assert blocked == {"VOO", "SPY", "QQQ", "VTI"}


def test_tlh_candidates_round_trip(mcp):
    async def interact(client):
        return await client.call_tool("vantage.tlh_candidates", {})

    payload = tool_payload(run_with_client(mcp, interact))
    rows = [(c["lot"]["symbol"], c["status"]) for c in payload["candidates"]]
    assert rows == [
        ("IWM", "clear"), ("BND", "na"), ("TSLA", "clear"),
        ("VOO", "blocked"), ("BND", "below"),
    ]


def test_quotes_round_trip(mcp):
    async def interact(client):
        return await client.call_tool("vantage.quotes", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["quotes"]["VOO"]["price"] == pytest.approx(683.20)
    assert payload["quotes"]["CASH"]["price"] == 1


# --- fundamentals / news tools (empty-symbol path: no network) ---


def test_fundamentals_empty_symbol_no_data(mcp):
    async def interact(client):
        return await client.call_tool("vantage.fundamentals", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["fundamentals"] is None
    assert payload["no_data"] is True


def test_news_empty_symbol_no_news(mcp):
    async def interact(client):
        return await client.call_tool("vantage.news", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["news"] is None
    assert payload["no_news"] is True


def test_news_round_trip_with_stub_source(mcp, monkeypatch):
    """Non-empty symbol path: inject a stub NewsSource so the tool runs the
    real pipeline (dedup/sentiment) without touching the network."""
    from vantage_server import news as news_mod

    class _Stub:
        name = "stub"

        def fetch(self, symbol):
            return [news_mod.NewsItem(
                title="ACME surges on record profit", summary="", publisher="Reuters",
                published="2026-07-05T12:00:00Z", url="https://x/1", source="stub")]

    monkeypatch.setattr(news_mod, "get_news_sources", lambda *a, **k: [_Stub()])
    monkeypatch.setenv("VANTAGE_NEWS_TTL", "0")  # don't persist a cache file

    async def interact(client):
        return await client.call_tool("vantage.news", {"symbol": "ACME"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["no_news"] is False
    news = payload["news"]
    assert news["symbol"] == "ACME"
    assert len(news["items"]) == 1
    assert news["sentiment"]["band"] == "positive"
    assert news["sentiment"]["estimated"] is True


# --- history tool ---


def test_history_empty_state_on_fixture_dataset(mcp):
    """The fixture data dir carries no history.json — the tool answers an
    empty list with provenance, never an error."""
    async def interact(client):
        return await client.call_tool("vantage.history", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["history"] == []
    assert payload["account"] == "all"
    assert payload["provenance"]["source_type"] == "vantage"


def test_history_round_trip_with_imported_rows(tmp_path, data_dir):
    """Same shape as GET /api/history: newest first, account filter, limit."""
    rows = [
        {"account": "fid-taxable", "broker_account": "...9024",
         "date": "2026-07-02T19:40:00Z", "kind": "option",
         "symbol": "SPXW 2026-07-02 7465C", "description": "d", "side": "buy",
         "quantity": 1.0, "price": 1.72, "amount": -172.0, "state": "filled"},
        {"account": "wf-robo", "broker_account": "...0427",
         "date": "2026-07-03T10:00:00Z", "kind": "equity", "symbol": "VOO",
         "description": "d", "side": "buy", "quantity": 1.0, "price": 683.0,
         "amount": -683.0, "state": "filled"},
    ]
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(),
                                     encoding="utf-8")
    (tmp_path / "history.json").write_text(json.dumps(rows), encoding="utf-8")
    mcp = create_mcp(tmp_path)

    async def all_rows(client):
        return await client.call_tool("vantage.history", {})

    payload = tool_payload(run_with_client(mcp, all_rows))
    assert [r["symbol"] for r in payload["history"]] == [
        "VOO", "SPXW 2026-07-02 7465C"]  # newest first
    assert payload["provenance"] == {"source_type": "vantage",
                                     "source_id": f"{tmp_path}#history"}

    async def filtered(client):
        return await client.call_tool(
            "vantage.history", {"account": "fid-taxable", "limit": 5})

    payload = tool_payload(run_with_client(mcp, filtered))
    assert [r["kind"] for r in payload["history"]] == ["option"]


# --- strategies tool ---


def test_strategies_empty_state_on_fixture_dataset(mcp):
    """The fixture data dir carries no strategies.json — the tool answers an
    empty roll-up with provenance, never an error."""
    async def interact(client):
        return await client.call_tool("vantage.strategies", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["open"] == [] and payload["closed"] == []
    assert payload["account"] == "all" and payload["status"] == "all"
    assert payload["provenance"]["source_type"] == "vantage"


def test_strategies_round_trip_with_filters(tmp_path, data_dir):
    rollup = {
        "open": [
            {"underlying": "PLTR", "expiration": "2026-08-21",
             "account": "fid-taxable", "kind": "vertical",
             "name": "bull call (debit) spread", "status": "open"},
            {"underlying": "FISV", "expiration": "2026-08-21",
             "account": "wf-robo", "kind": "multi-leg", "status": "open"},
        ],
        "closed": [
            {"order_id": "oo-1", "_vantage_account": "fid-taxable",
             "underlying": "SPXW", "direction": "credit", "cash": 300.0,
             "state": "filled", "filled": True},
        ],
        "by_ticker": [
            {"underlying": "SOXS", "account": "fid-taxable", "net_cost": 250.0,
             "leg_count": 2, "has_short": True, "spans_expiries": True,
             "status": "open"},
            {"underlying": "PLTR", "account": "wf-robo", "net_cost": 1200.0,
             "leg_count": 1, "has_short": False, "spans_expiries": False,
             "status": "open"},
        ],
        "as_of": "2026-07-05",
    }
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(),
                                     encoding="utf-8")
    (tmp_path / "strategies.json").write_text(json.dumps(rollup), encoding="utf-8")
    mcp = create_mcp(tmp_path)

    async def all_rows(client):
        return await client.call_tool("vantage.strategies", {})

    payload = tool_payload(run_with_client(mcp, all_rows))
    assert len(payload["open"]) == 2 and len(payload["closed"]) == 1
    assert payload["strategies_as_of"] == "2026-07-05"
    assert payload["provenance"] == {"source_type": "vantage",
                                     "source_id": f"{tmp_path}#strategies"}

    async def filtered(client):
        return await client.call_tool(
            "vantage.strategies", {"account": "fid-taxable", "status": "open"})

    payload = tool_payload(run_with_client(mcp, filtered))
    assert [s["underlying"] for s in payload["open"]] == ["PLTR"]
    assert payload["closed"] == []  # account filter drops account-less closed rows

    # by='ticker' returns the per-underlying position book instead
    async def by_ticker(client):
        return await client.call_tool("vantage.strategies", {"by": "ticker"})

    payload = tool_payload(run_with_client(mcp, by_ticker))
    assert [b["underlying"] for b in payload["by_ticker"]] == ["SOXS", "PLTR"]
    assert payload["by_ticker"][0]["spans_expiries"] is True
    assert "open" not in payload  # ticker view is distinct from strategy view

    # account filter also narrows the ticker view
    async def by_ticker_filtered(client):
        return await client.call_tool(
            "vantage.strategies", {"by": "ticker", "account": "fid-taxable"})

    payload = tool_payload(run_with_client(mcp, by_ticker_filtered))
    assert [b["underlying"] for b in payload["by_ticker"]] == ["SOXS"]


# --- signals tool round-trips (moved with the vantage-mcp split) ---


def test_mcp_signals_round_trip(data_dir):
    mcp = create_mcp(data_dir)

    async def all_signals(client):
        return await client.call_tool("vantage.signals", {})

    payload = tool_payload(run_with_client(mcp, all_signals))
    assert payload["provenance"] == {"source_type": "vantage",
                                     "source_id": f"{data_dir}#signals"}
    assert len(payload["signals"]) == 8

    async def filtered(client):
        return await client.call_tool("vantage.signals", {"symbol": "pltr"})

    payload = tool_payload(run_with_client(mcp, filtered))
    assert [s["signal"]["sym"] for s in payload["signals"]] == ["PLTR"]
    assert payload["signals"][0]["status"] == "unquoted"


# --- analysis + position_actions tools (the nightly decision journal) ---


def _seed_analysis_dir(tmp_path, data_dir):
    """A data dir with the fixture files + a two-day analysis journal."""
    from vantage_server import analyze, income
    import datetime as _dt

    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")

    def dec(sym, rec, detail=None):
        return income.PositionDecision(
            symbol=sym, as_of="2026-07-05", current_price=100.0,
            conviction=income.ConvictionView(label="strong", score=0.9),
            recommendation=rec, rule="r", rationale=f"{sym} rationale",
            evidence={"per_tf": {"daily": {}}}, action_detail=detail)

    analyze.write_journal(tmp_path, "2026-07-04", [dec("PLTR", "MONITOR")],
                          now=_dt.datetime(2026, 7, 4, 21, 0, 0))
    analyze.write_journal(
        tmp_path, "2026-07-05",
        [dec("PLTR", "CLOSE_AND_BOOK_LOSS", {"kind": "close", "wash_blocked": False}),
         dec("SOXS", "MONITOR")],
        now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    return tmp_path


def test_analysis_empty_state_on_fixture(data_dir):
    """Fixture data dir has no analysis/ dir — empty decisions, with provenance."""
    mcp = create_mcp(data_dir)

    async def interact(client):
        return await client.call_tool("vantage.analysis", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["decisions"] == []
    assert payload["provenance"]["source_type"] == "vantage"


def test_analysis_latest_date_and_symbol(tmp_path, data_dir):
    mcp = create_mcp(_seed_analysis_dir(tmp_path, data_dir))

    async def latest(client):
        return await client.call_tool("vantage.analysis", {})

    payload = tool_payload(run_with_client(mcp, latest))
    assert payload["date"] == "2026-07-05"
    assert {d["symbol"] for d in payload["decisions"]} == {"PLTR", "SOXS"}

    async def specific(client):
        return await client.call_tool("vantage.analysis", {"date": "2026-07-04"})

    payload = tool_payload(run_with_client(mcp, specific))
    assert [d["symbol"] for d in payload["decisions"]] == ["PLTR"]

    async def filtered(client):
        return await client.call_tool("vantage.analysis", {"symbol": "pltr"})

    payload = tool_payload(run_with_client(mcp, filtered))
    assert [d["symbol"] for d in payload["decisions"]] == ["PLTR"]
    assert payload["decisions"][0]["recommendation"] == "CLOSE_AND_BOOK_LOSS"


def test_position_actions_is_compact(tmp_path, data_dir):
    mcp = create_mcp(_seed_analysis_dir(tmp_path, data_dir))

    async def interact(client):
        return await client.call_tool("vantage.position_actions", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["date"] == "2026-07-05"
    actions = {a["symbol"]: a for a in payload["actions"]}
    assert set(actions) == {"PLTR", "SOXS"}
    # compact: recommendation + action_detail present, NO evidence block
    assert actions["PLTR"]["recommendation"] == "CLOSE_AND_BOOK_LOSS"
    assert "action_detail" in actions["PLTR"]
    assert "evidence" not in actions["PLTR"]
    assert actions["PLTR"]["conviction"]["label"] == "strong"


# --- roundtrips tool (labeled closed round-trips) ---


def test_roundtrips_empty_state_on_fixture(mcp):
    """Fixture data dir has no ml/roundtrips.json — empty state, provenance."""
    async def interact(client):
        return await client.call_tool("vantage.roundtrips", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["roundtrips"] == []
    assert payload["summary"]["count"] == 0
    assert payload["roundtrips_as_of"] is None
    assert payload["provenance"]["source_type"] == "vantage"


def test_roundtrips_round_trip_with_filters(tmp_path, data_dir):
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(),
                                     encoding="utf-8")
    (tmp_path / "ml").mkdir()
    rows = [
        {"account": "fid-taxable", "symbol": "AAPL", "kind": "equity",
         "close_date": "2026-06-10", "realized_pnl": 100.0, "win": True,
         "entry_unknown": False},
        {"account": "fid-taxable", "symbol": "TSLA", "kind": "equity",
         "close_date": "2026-06-11", "realized_pnl": -40.0, "win": False,
         "entry_unknown": False},
        {"account": "wf-robo", "symbol": "SPY", "kind": "option",
         "close_date": "2026-06-12", "realized_pnl": 200.0, "win": True,
         "entry_unknown": False},
    ]
    (tmp_path / "ml" / "roundtrips.json").write_text(
        json.dumps({"as_of": "2026-07-05", "account": "fid-taxable",
                    "roundtrips": rows, "summary": {}}), encoding="utf-8")
    mcp = create_mcp(tmp_path)

    async def all_rows(client):
        return await client.call_tool("vantage.roundtrips", {})

    payload = tool_payload(run_with_client(mcp, all_rows))
    assert len(payload["roundtrips"]) == 3
    assert payload["summary"]["count"] == 3
    assert payload["summary"]["wins"] == 2
    assert payload["roundtrips_as_of"] == "2026-07-05"
    assert payload["provenance"] == {"source_type": "vantage",
                                     "source_id": f"{tmp_path}#roundtrips"}

    async def filtered(client):
        return await client.call_tool(
            "vantage.roundtrips", {"account": "fid-taxable"})

    payload = tool_payload(run_with_client(mcp, filtered))
    assert {r["symbol"] for r in payload["roundtrips"]} == {"AAPL", "TSLA"}
    # summary recomputed over the subset
    assert payload["summary"]["count"] == 2
    assert payload["summary"]["profit_factor"] == pytest.approx(2.5)

    async def by_symbol(client):
        return await client.call_tool("vantage.roundtrips", {"symbol": "spy"})

    payload = tool_payload(run_with_client(mcp, by_symbol))
    assert [r["symbol"] for r in payload["roundtrips"]] == ["SPY"]
    assert payload["summary"]["count"] == 1


# --- trade_stats tool (entry-condition Bayesian buckets) ---


def test_trade_stats_empty_state_on_fixture(mcp):
    """Fixture data dir has no ml/trade_stats.json — empty state, provenance."""
    async def interact(client):
        return await client.call_tool("vantage.trade_stats", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["notable"] == []
    assert payload["baseline_win_rate"] is None
    assert payload["trade_stats_as_of"] is None
    assert payload["provenance"] == {
        "source_type": "vantage",
        "source_id": f"{payload['provenance']['source_id'].split('#')[0]}#trade_stats"}


def test_trade_stats_compact_returns_baseline_and_notable(tmp_path, data_dir):
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(),
                                     encoding="utf-8")
    (tmp_path / "ml").mkdir()
    notable = [
        {"dimension": "dte_band", "value": "0dte", "n": 8, "win_rate": 0.12,
         "ci_low": 0.02, "ci_high": 0.35, "kind": "leak", "edge": -0.38,
         "significant": True},
    ]
    block = {"baseline_win_rate": 0.5, "featured": [], "buckets": [],
             "notable": notable}
    payload_json = {"as_of": "2026-07-05", "account": "fid-taxable",
                    "baseline_win_rate": 0.5, "featured": [], "buckets": [],
                    "notable": notable, "by_account": {"fid-taxable": block}}
    (tmp_path / "ml" / "trade_stats.json").write_text(
        json.dumps(payload_json), encoding="utf-8")
    mcp = create_mcp(tmp_path)

    async def call_all(client):
        return await client.call_tool("vantage.trade_stats", {})

    payload = tool_payload(run_with_client(mcp, call_all))
    assert payload["baseline_win_rate"] == pytest.approx(0.5)
    assert len(payload["notable"]) == 1
    assert payload["notable"][0]["kind"] == "leak"
    assert payload["trade_stats_as_of"] == "2026-07-05"
    # compact: the tool surfaces baseline + notable only (no full buckets dump)
    assert "buckets" not in payload

    async def call_account(client):
        return await client.call_tool(
            "vantage.trade_stats", {"account": "fid-taxable"})

    payload = tool_payload(run_with_client(mcp, call_account))
    assert payload["baseline_win_rate"] == pytest.approx(0.5)


# --- bars tool (deep OHLCV + computed levels) ---


def _seed_bars_dir(tmp_path, data_dir, symbol="PLTR"):
    """Fixture files + a bars/<SYMBOL>.json with enough bars for S/R pivots."""
    from vantage_server import bars as bars_engine, snapshot_bars

    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")

    daily = []
    for i in range(120):
        px = 100 + (i % 20) - (i % 7) * 2
        day = 1 + i
        daily.append({
            "date": f"2026-{(day // 28) + 1:02d}-{(day % 28) + 1:02d}",
            "open": px, "high": px + 3, "low": px - 3, "close": px + 1,
            "volume": 1_000_000 + i,
        })
    series = {"daily": daily, "weekly": bars_engine.resample(daily, "week"),
              "monthly": bars_engine.resample(daily, "month")}
    snapshot_bars.write_bars(tmp_path, symbol, series, as_of="2026-07-05",
                             lookback_days=400, backfilled=True)
    return tmp_path


def test_bars_tool_returns_bars_and_serialized_levels(tmp_path, data_dir):
    mcp = create_mcp(_seed_bars_dir(tmp_path, data_dir))

    async def interact(client):
        return await client.call_tool("vantage.bars", {"symbol": "PLTR"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["symbol"] == "PLTR"
    assert payload["timeframe"] == "daily"
    assert payload["no_bars"] is False
    assert payload["bar_count"] == len(payload["bars"]) > 0
    for side in ("support", "resistance"):
        for lv in payload["levels"][side]:
            assert set(lv) == {"price", "strength", "kind"}
    # provenance block Mira grounds on
    assert payload["provenance"]["source_id"].endswith("#bars")


def test_bars_tool_weekly_timeframe(tmp_path, data_dir):
    mcp = create_mcp(_seed_bars_dir(tmp_path, data_dir))

    async def interact(client):
        return await client.call_tool(
            "vantage.bars", {"symbol": "PLTR", "timeframe": "weekly"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["timeframe"] == "weekly"
    assert payload["bar_count"] > 0


def test_bars_tool_no_bars_flag_for_unknown_symbol(tmp_path, data_dir):
    mcp = create_mcp(_seed_bars_dir(tmp_path, data_dir))

    async def interact(client):
        return await client.call_tool("vantage.bars", {"symbol": "ZZZZ"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["no_bars"] is True
    assert payload["bars"] == []


def test_bars_tool_empty_state_on_fixture(data_dir):
    """The fixture data dir has no bars/ dir — no_bars=true, never an error."""
    mcp = create_mcp(data_dir)

    async def interact(client):
        return await client.call_tool("vantage.bars", {"symbol": "PLTR"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["no_bars"] is True
    assert payload["provenance"]["source_type"] == "vantage"


# ------------------------------------------------------------ analyst tools
# Engine math is covered by server/tests (test_growth, test_expectations,
# test_ml_events); these round-trips pin the TOOL wiring — envelope, symbol
# threading, no_data semantics — with the engine monkeypatched.

_GROWTH = {
    "symbol": "PLTR", "revenue_ttm": 3_800e6, "revenue_yoy": 0.33,
    "revenue_yoy_basis": "ttm", "gross_margin": 0.80, "operating_margin": 0.14,
    "fcf_ttm": 1_200e6, "fcf_margin": 0.32, "sbc_ttm": 600e6,
    "sbc_pct_revenue": 0.16, "rule_of_40": 65.0,
    "rule_of_40_basis": "yoy_growth_plus_fcf_margin", "period_end": "2026-03-31",
}
_FUND = {
    "symbol": "PLTR", "market_cap": 300_000e6, "enterprise_value": 296_000e6,
    "shares_outstanding": 2_400e6,
}


def test_growth_tool_round_trip(mcp, monkeypatch):
    import vantage_server.growth as growth_mod

    monkeypatch.setattr(growth_mod, "growth", lambda sym, dd: dict(_GROWTH, symbol=sym))

    async def interact(client):
        return await client.call_tool("vantage.growth", {"symbol": "pltr"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["symbol"] == "PLTR"
    assert payload["no_data"] is False
    assert payload["growth"]["rule_of_40"] == 65.0
    assert payload["growth"]["rule_of_40_basis"] == "yoy_growth_plus_fcf_margin"
    assert payload["provenance"]["source_id"].endswith("#growth")


def test_growth_tool_no_data_for_etf(mcp, monkeypatch):
    import vantage_server.growth as growth_mod

    monkeypatch.setattr(growth_mod, "growth", lambda sym, dd: None)

    async def interact(client):
        return await client.call_tool("vantage.growth", {"symbol": "VOO"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["no_data"] is True
    assert payload["growth"] is None


def test_expectations_tool_round_trip(mcp, monkeypatch):
    import vantage_server.fundamentals as fund_mod
    import vantage_server.growth as growth_mod

    monkeypatch.setattr(fund_mod, "fundamentals", lambda sym, dd: dict(_FUND))
    monkeypatch.setattr(growth_mod, "growth", lambda sym, dd: dict(_GROWTH))

    async def interact(client):
        return await client.call_tool("vantage.expectations", {"symbol": "PLTR"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["no_data"] is False
    assert payload["inputs"]["value_basis"] == "enterprise_value"
    assert payload["implied"]["status"] == "ok"
    assert payload["implied"]["fcf_growth_10y"] is not None
    assert payload["assumptions"]["model"] == "two_stage_fcf_reverse_dcf"
    assert [s["growth"] for s in payload["scenarios"]] == [0.0, 0.10, 0.20, 0.30]
    assert payload["provenance"]["source_id"].endswith("#expectations")


def test_expectations_tool_negative_fcf_is_undefined(mcp, monkeypatch):
    import vantage_server.fundamentals as fund_mod
    import vantage_server.growth as growth_mod

    monkeypatch.setattr(fund_mod, "fundamentals", lambda sym, dd: dict(_FUND))
    monkeypatch.setattr(growth_mod, "growth",
                        lambda sym, dd: dict(_GROWTH, fcf_ttm=-100e6))

    async def interact(client):
        return await client.call_tool("vantage.expectations", {"symbol": "PLTR"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["no_data"] is True
    assert payload["implied"]["status"] == "negative_fcf"
    assert payload["implied"]["fcf_growth_10y"] is None


def test_earnings_tool_forward_calendar(mcp, monkeypatch):
    import vantage_server.ml.fetch_earnings as fe

    # fixture snapshot as_of is 2026-07-05 -> 2026-07-08 is 3 days out
    monkeypatch.setattr(fe, "load_cached", lambda dd, sym: {
        "symbol": "PLTR", "as_of": "2026-07-04",
        "earnings": [
            {"date": "2026-05-05", "eps_estimate": 0.08, "eps_actual": 0.10},
            {"date": "2026-07-08", "eps_estimate": 0.09, "eps_actual": None},
        ],
        "dates": ["2026-05-05", "2026-07-08"],
    })

    async def interact(client):
        return await client.call_tool("vantage.earnings", {"symbol": "PLTR"})

    payload = tool_payload(run_with_client(mcp, interact))
    e = payload["earnings"]
    assert e["next_date"] == "2026-07-08"
    assert e["days_until"] == 3
    assert e["future_date_known"] is True
    assert e["recent"][0]["date"] == "2026-07-08"
    assert e["dates_as_of"] == "2026-07-04"


def test_earnings_tool_stale_cache_is_not_no_earnings(mcp, monkeypatch):
    import vantage_server.ml.fetch_earnings as fe

    monkeypatch.setattr(fe, "load_cached", lambda dd, sym: {
        "symbol": "PLTR", "as_of": "2026-05-06",
        "earnings": [{"date": "2026-05-05", "eps_estimate": 0.08, "eps_actual": 0.10}],
        "dates": ["2026-05-05"],
    })

    async def interact(client):
        return await client.call_tool("vantage.earnings", {"symbol": "PLTR"})

    payload = tool_payload(run_with_client(mcp, interact))
    e = payload["earnings"]
    assert e["next_date"] is None
    assert e["future_date_known"] is False  # stale cache, NOT "no earnings"
    assert e["last_date"] == "2026-05-05"


def test_ticker_plan_no_plan_shape_on_fixture(mcp):
    """JSON fixture backend has no ticker_plan table — graceful has_plan=false."""
    async def interact(client):
        return await client.call_tool("vantage.ticker_plan", {"symbol": "PLTR"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["has_plan"] is False
    assert payload["plan"] is None
    assert payload["journal"] == []
    assert payload["provenance"]["source_id"].endswith("#ticker_plan")
