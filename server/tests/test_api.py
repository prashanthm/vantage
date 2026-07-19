"""REST contract tests: payload shape, provenance envelope, read-only
guarantee (no method but GET works — ADR-010), and CORS for the SPA origin."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from vantage_server import income
from vantage_server.api import create_app

FIXTURE_AS_OF = "2026-07-05T09:30:00-04:00"


@pytest.fixture(scope="module")
def client(data_dir):
    return TestClient(create_app(data_dir))


ALL_GET_ROUTES = [
    "/api/health",
    "/api/accounts",
    "/api/positions",
    "/api/allocation",
    "/api/lots",
    "/api/tax/wash",
    "/api/tax/tlh",
    "/api/quotes",
    "/api/signals",
    "/api/history",
    "/api/strategies",
    "/api/analysis",
    "/api/ml/roundtrips",
    "/api/ml/trade_stats",
]


# ------------------------------------------------------------- envelope

@pytest.mark.parametrize("route", ALL_GET_ROUTES)
def test_every_payload_carries_as_of_and_source(client, route):
    r = client.get(route)
    assert r.status_code == 200
    body = r.json()
    assert body["as_of"] == FIXTURE_AS_OF  # fixture marker
    assert body["source"] == "fixture"
    assert body["stale"] is False


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["accounts"] == 4 and body["lots"] == 18


# ------------------------------------------------------------- content

def test_accounts_with_values(client):
    body = client.get("/api/accounts").json()
    by_id = {a["id"]: a for a in body["accounts"]}
    assert set(by_id) == {"fid-taxable", "schwab-roth", "vg-401k", "wf-robo"}
    assert by_id["fid-taxable"]["value"] == pytest.approx(83_627.05)
    assert by_id["schwab-roth"]["taxable"] is False


def test_positions_consolidated_and_filtered(client):
    all_pos = client.get("/api/positions").json()
    assert all_pos["account"] == "all"
    assert len(all_pos["positions"]) == 12
    assert all_pos["positions"][0]["symbol"] == "VTI"
    fid = client.get("/api/positions", params={"account": "fid-taxable"}).json()
    assert {p["symbol"] for p in fid["positions"]} == {
        "VOO", "NVDA", "IWM", "AAPL", "BND", "CASH"
    }


def test_unknown_account_404(client):
    for route in ("/api/positions", "/api/allocation", "/api/lots"):
        assert client.get(route, params={"account": "etrade"}).status_code == 404


def test_allocation(client):
    body = client.get("/api/allocation").json()
    assert body["total"] == pytest.approx(234_461.07)
    assert body["by_class"]["usEquity"]["pct"] == pytest.approx(77.6556, abs=1e-3)


def test_lots_filter(client):
    body = client.get("/api/lots", params={"account": "wf-robo"}).json()
    assert len(body["lots"]) == 4
    assert all(l["account"] == "wf-robo" for l in body["lots"])


def test_tax_wash(client):
    body = client.get("/api/tax/wash").json()
    assert body["window_days"] == 30
    assert body["wash"]["VOO"]["blocked"] is True
    assert body["wash"]["VOO"]["clears_on_date"] == "2026-08-01"
    assert body["wash"]["SPY"]["blocked"] is True  # family sibling
    assert body["wash"]["IWM"]["blocked"] is False
    assert "CASH" not in body["wash"]


def test_tax_tlh_default_thresholds(client):
    body = client.get("/api/tax/tlh").json()
    assert body["threshold_usd"] == 200 and body["threshold_pct"] == 3
    rows = [(c["lot"]["symbol"], c["status"]) for c in body["candidates"]]
    assert rows == [
        ("IWM", "clear"), ("BND", "na"), ("TSLA", "clear"),
        ("VOO", "blocked"), ("BND", "below"),
    ]


def test_tax_tlh_custom_thresholds(client):
    body = client.get("/api/tax/tlh",
                      params={"thresholdUsd": 300, "thresholdPct": 5}).json()
    by_sym = {(c["lot"]["symbol"], c["lot"]["account"]): c["status"]
              for c in body["candidates"]}
    assert by_sym[("VOO", "fid-taxable")] == "below"   # 267.60<300 and 3.16%<5%
    assert by_sym[("TSLA", "wf-robo")] == "clear"      # 10.92% >= 5% (OR)


def test_quotes(client):
    body = client.get("/api/quotes").json()
    assert body["quotes"]["VOO"]["price"] == pytest.approx(683.20)
    assert body["quotes"]["VXUS"]["asset_class"] == "intlEquity"


# ---------------------------------------------------------------- history

def test_history_empty_state_when_never_imported(client):
    """The fixture data dir has no history.json — the route serves an empty
    list (the SPA shows an empty state), never an error."""
    body = client.get("/api/history").json()
    assert body["history"] == []
    assert body["account"] == "all"


HISTORY_ROWS = [
    {"account": "fid-taxable", "broker_account": "...9024",
     "date": "2026-07-02T19:40:00Z", "kind": "option",
     "symbol": "SPXW 2026-07-02 7465C", "description": "long_call_spread open (debit)",
     "side": "buy", "quantity": 1.0, "price": 1.72, "amount": -172.0,
     "state": "filled"},
    {"account": "wf-robo", "broker_account": "...0427",
     "date": "2026-07-03T10:00:00Z", "kind": "equity", "symbol": "VOO",
     "description": "market buy 1 VOO", "side": "buy", "quantity": 1.0,
     "price": 683.0, "amount": -683.0, "state": "filled"},
    {"account": "fid-taxable", "broker_account": "...9024",
     "date": "2026-06-30T14:36:38Z", "kind": "equity", "symbol": "IMSR",
     "description": "market sell 200 IMSR", "side": "sell", "quantity": 200.0,
     "price": 7.07, "amount": 1414.0, "state": "filled"},
]


@pytest.fixture()
def history_client(tmp_path, data_dir):
    import json
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    (tmp_path / "history.json").write_text(json.dumps(HISTORY_ROWS), encoding="utf-8")
    return TestClient(create_app(tmp_path))


def test_history_newest_first_with_account_filter_and_limit(history_client):
    body = history_client.get("/api/history").json()
    assert [r["symbol"] for r in body["history"]] == [
        "VOO", "SPXW 2026-07-02 7465C", "IMSR"]  # newest first
    fid = history_client.get("/api/history", params={"account": "fid-taxable"}).json()
    assert [r["symbol"] for r in fid["history"]] == ["SPXW 2026-07-02 7465C", "IMSR"]
    limited = history_client.get("/api/history", params={"limit": 1}).json()
    assert len(limited["history"]) == 1 and limited["history"][0]["symbol"] == "VOO"


def test_history_unknown_account_404(history_client):
    assert history_client.get(
        "/api/history", params={"account": "etrade"}).status_code == 404


def test_history_reads_per_request_no_restart_needed(tmp_path, data_dir):
    import json
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/history").json()["history"] == []
    (tmp_path / "history.json").write_text(json.dumps(HISTORY_ROWS), encoding="utf-8")
    assert len(client.get("/api/history").json()["history"]) == 3


# ----------------------------------------------------------- strategies

STRATEGY_ROLLUP = {
    "open": [
        {"underlying": "PLTR", "expiration": "2026-08-21", "account": "fid-taxable",
         "kind": "vertical", "name": "bull call (debit) spread", "net_cost": 400.0,
         "current_value": 450.0, "unrealized": 50.0, "status": "open"},
        {"underlying": "FISV", "expiration": "2026-08-21", "account": "wf-robo",
         "kind": "multi-leg", "name": "multi-leg (call)", "status": "open"},
    ],
    "closed": [
        {"order_id": "oo-1", "_vantage_account": "fid-taxable", "underlying": "SPXW",
         "direction": "credit", "cash": 300.0, "state": "filled", "filled": True},
        {"order_id": "oo-2", "_vantage_account": "fid-taxable", "underlying": "SNK",
         "direction": "credit", "cash": 0.0, "state": "cancelled", "filled": False},
    ],
    "by_ticker": [
        {"underlying": "SOXS", "account": "fid-taxable", "net_cost": 250.0,
         "current_value": 400.0, "unrealized": 150.0, "leg_count": 2,
         "has_short": True, "spans_expiries": True, "status": "open"},
        {"underlying": "PLTR", "account": "wf-robo", "net_cost": 1200.0,
         "leg_count": 1, "has_short": False, "spans_expiries": False,
         "status": "open"},
    ],
    "as_of": "2026-07-05",
}


def test_strategies_empty_state_on_fixture_dataset(client):
    body = client.get("/api/strategies").json()
    assert body["open"] == [] and body["closed"] == []
    assert body["strategies_as_of"] is None
    assert body["account"] == "all" and body["status"] == "all"


def test_strategies_contract_filters_and_per_request(tmp_path, data_dir):
    import json
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/strategies").json()["open"] == []  # no file yet
    (tmp_path / "strategies.json").write_text(json.dumps(STRATEGY_ROLLUP),
                                              encoding="utf-8")
    body = client.get("/api/strategies").json()  # read per request, no restart
    assert len(body["open"]) == 2 and len(body["closed"]) == 2
    assert body["strategies_as_of"] == "2026-07-05"

    # status filter
    only_open = client.get("/api/strategies", params={"status": "open"}).json()
    assert only_open["open"] and only_open["closed"] == []
    only_closed = client.get("/api/strategies", params={"status": "closed"}).json()
    assert only_closed["closed"] and only_closed["open"] == []

    # account filter narrows open rows; closed rows (no vantage account) dropped
    fid = client.get("/api/strategies", params={"account": "fid-taxable"}).json()
    assert [s["underlying"] for s in fid["open"]] == ["PLTR"]
    assert fid["closed"] == []


def test_strategies_by_ticker_view(tmp_path, data_dir):
    import json
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    client = TestClient(create_app(tmp_path))
    # no file yet -> empty by_ticker view
    empty = client.get("/api/strategies", params={"by": "ticker"}).json()
    assert empty["by_ticker"] == [] and "open" not in empty
    (tmp_path / "strategies.json").write_text(json.dumps(STRATEGY_ROLLUP),
                                              encoding="utf-8")
    body = client.get("/api/strategies", params={"by": "ticker"}).json()
    assert [b["underlying"] for b in body["by_ticker"]] == ["SOXS", "PLTR"]
    soxs = body["by_ticker"][0]
    assert soxs["net_cost"] == 250.0 and soxs["spans_expiries"] is True
    assert body["strategies_as_of"] == "2026-07-05"
    # account filter narrows by_ticker rows to that vantage account
    fid = client.get("/api/strategies",
                     params={"by": "ticker", "account": "fid-taxable"}).json()
    assert [b["underlying"] for b in fid["by_ticker"]] == ["SOXS"]


def test_strategies_unknown_account_404(client):
    assert client.get("/api/strategies",
                      params={"account": "etrade"}).status_code == 404


def test_strategies_bad_status_422(client):
    assert client.get("/api/strategies",
                      params={"status": "nope"}).status_code == 422


def test_strategies_bad_by_422(client):
    assert client.get("/api/strategies",
                      params={"by": "nope"}).status_code == 422


# ------------------------------------------------- ml/roundtrips endpoint

def test_roundtrips_empty_state_on_fixture(client):
    """The fixture data dir has no ml/roundtrips.json — empty state, not 500."""
    body = client.get("/api/ml/roundtrips").json()
    assert body["roundtrips"] == []
    assert body["summary"]["count"] == 0
    assert body["roundtrips_as_of"] is None


def test_roundtrips_round_trip_with_filters(tmp_path, data_dir):
    import json as _json

    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
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
        _json.dumps({"as_of": "2026-07-05", "account": "fid-taxable",
                     "roundtrips": rows, "summary": {}}), encoding="utf-8")
    c = TestClient(create_app(tmp_path))

    body = c.get("/api/ml/roundtrips").json()
    assert len(body["roundtrips"]) == 3
    assert body["summary"]["count"] == 3
    assert body["summary"]["wins"] == 2
    assert body["roundtrips_as_of"] == "2026-07-05"

    # account filter + recomputed summary over the subset
    body = c.get("/api/ml/roundtrips", params={"account": "fid-taxable"}).json()
    assert {r["symbol"] for r in body["roundtrips"]} == {"AAPL", "TSLA"}
    assert body["summary"]["count"] == 2
    assert body["summary"]["profit_factor"] == pytest.approx(2.5)  # 100 / 40

    # symbol filter
    body = c.get("/api/ml/roundtrips", params={"symbol": "spy"}).json()
    assert [r["symbol"] for r in body["roundtrips"]] == ["SPY"]
    assert body["summary"]["count"] == 1


def test_roundtrips_unknown_account_404(client):
    assert client.get("/api/ml/roundtrips",
                      params={"account": "nope"}).status_code == 404


# ------------------------------------------------- ml/trade_stats endpoint

def test_trade_stats_empty_state_on_fixture(client):
    """The fixture data dir has no ml/trade_stats.json — empty state, not 500."""
    body = client.get("/api/ml/trade_stats").json()
    assert body["buckets"] == []
    assert body["notable"] == []
    assert body["baseline_win_rate"] is None
    assert body["trade_stats_as_of"] is None


def _seed_fixture_dir(tmp_path, data_dir):
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    (tmp_path / "ml").mkdir()


def test_trade_stats_round_trip_with_filters(tmp_path, data_dir):
    import json as _json

    _seed_fixture_dir(tmp_path, data_dir)
    buckets = [
        {"dimension": "__baseline__", "value": "all_trades", "n": 20,
         "win_rate": 0.5, "ci_low": 0.3, "ci_high": 0.7},
        {"dimension": "daily_trend", "value": "up", "n": 10, "win_rate": 0.9,
         "ci_low": 0.6, "ci_high": 0.99},
        {"dimension": "dte_band", "value": "0dte", "n": 8, "win_rate": 0.1,
         "ci_low": 0.01, "ci_high": 0.3},
    ]
    notable = [
        {"dimension": "daily_trend", "value": "up", "n": 10, "win_rate": 0.9,
         "ci_low": 0.6, "ci_high": 0.99, "kind": "edge", "edge": 0.4,
         "significant": True},
    ]
    block = {"baseline_win_rate": 0.5, "featured": [], "buckets": buckets,
             "notable": notable}
    payload = {"as_of": "2026-07-05", "account": "fid-taxable",
               "baseline_win_rate": 0.5, "featured": [], "buckets": buckets,
               "notable": notable, "by_account": {"fid-taxable": block}}
    (tmp_path / "ml" / "trade_stats.json").write_text(
        _json.dumps(payload), encoding="utf-8")
    c = TestClient(create_app(tmp_path))

    body = c.get("/api/ml/trade_stats").json()
    assert body["baseline_win_rate"] == pytest.approx(0.5)
    assert len(body["buckets"]) == 3
    assert len(body["notable"]) == 1
    assert body["trade_stats_as_of"] == "2026-07-05"

    # account selection
    body = c.get("/api/ml/trade_stats", params={"account": "fid-taxable"}).json()
    assert body["baseline_win_rate"] == pytest.approx(0.5)

    # dimension filter keeps the baseline row + the requested dimension only
    body = c.get("/api/ml/trade_stats",
                 params={"dimension": "dte_band"}).json()
    dims = {b["dimension"] for b in body["buckets"]}
    assert dims == {"__baseline__", "dte_band"}
    # notable is always returned in full
    assert len(body["notable"]) == 1


def test_trade_stats_unknown_account_from_by_account_is_empty(tmp_path, data_dir):
    import json as _json

    _seed_fixture_dir(tmp_path, data_dir)
    payload = {"as_of": "2026-07-05", "account": "fid-taxable",
               "baseline_win_rate": 0.5, "featured": [], "buckets": [],
               "notable": [], "by_account": {"fid-taxable": {
                   "baseline_win_rate": 0.5, "buckets": [], "notable": []}}}
    (tmp_path / "ml" / "trade_stats.json").write_text(
        _json.dumps(payload), encoding="utf-8")
    c = TestClient(create_app(tmp_path))
    # a KNOWN account with no block -> empty, not error
    body = c.get("/api/ml/trade_stats", params={"account": "wf-robo"}).json()
    assert body["baseline_win_rate"] is None and body["buckets"] == []


def test_trade_stats_unknown_account_404(client):
    assert client.get("/api/ml/trade_stats",
                      params={"account": "nope"}).status_code == 404


# ------------------------------------------------- read-only guarantee
# Policy shift (productization): /api/refresh is a DELIBERATE operator WRITE.
# Every OTHER route stays read-only; refresh writes to OUR store only and calls
# ONLY read broker tools (no order/fund mutation — enforced by the connectors).

@pytest.mark.parametrize("route", ALL_GET_ROUTES)
@pytest.mark.parametrize("method", ["post", "put", "delete", "patch"])
def test_no_mutating_method_exists(client, route, method):
    # A GET route that ALSO has a deliberate write (e.g. POST /api/accounts is
    # both the list read and the create write) is exempt — its write is in the
    # ADR-010 allowlist below.
    if method == "post" and route in ALLOWED_WRITE_ROUTES:
        return
    r = getattr(client, method)(route)
    assert r.status_code == 405, f"{method.upper()} {route} must be rejected"


#: The deliberate mutating routes (productization writes) — every other route
#: must remain read-only. All write to OUR SQLite only, EXCEPT the single
#: ADR-010 v2 carve-out /api/ticket/execute (reclaim ticket → Robinhood,
#: dry-run default, VANTAGE_LIVE_OK-gated — see test_robinhood_execution.py).
ALLOWED_WRITE_ROUTES = {
    "/api/refresh",
    # THE execution carve-out (ADR-010 v2): server-recomputed reclaim ticket
    # submitted via brokers/robinhood_execution.py's three-tool allowlist.
    "/api/ticket/execute",
    # Exits-only automation (ADR-010 v3): one monitor pass (reduce/close
    # carve-out positions only) + releasing a position from management.
    "/api/exits/tick",
    "/api/exits/{pos_id}/disarm",
    # Signal-bot pass — arms/settles NO-MONEY paper trades in our own SQLite
    # and sends an outbound Telegram message; no broker path (ADR-010 holds).
    "/api/reclaim-bot/poll",
    # Telegram credentials into OUR meta table (+ optional test message).
    "/api/reclaim-bot/config",
    # Nightly digest push — reads our store, sends one outbound message.
    "/api/reclaim-bot/nightly-report",
    # Nightly pipeline snapshot into our own SQLite (posted by nightly-docker.sh).
    "/api/nightly/record",
    # Persist a trade's DNA snapshot + Mira read into our store.
    "/api/journal/trade-analysis",
    # Store one Journal Analysis run (aggregate self-assessment) — writes only
    # our own SQLite so the periodic analysis compounds; no broker/order path.
    "/api/journal/analysis",
    "/api/ticker/{symbol}/plan",
    "/api/ticker/{symbol}/note",
    # Regenerates the SPX playbook on demand — writes only our own store (the
    # scaffold), no broker / fund-moving path (ADR-010 read-only doctrine holds).
    "/api/spx/playbook/recompute",
    # Imports the user's own AMP futures CSV export into our SQLite — reads local
    # files, writes only our store; no broker contact / order path (ADR-010 holds).
    "/api/futures/import",
    # Paper-trading simulation — logs/settles/closes NO-MONEY paper trades in our
    # own SQLite. Explicitly not a real order path (ADR-010 read-only doctrine).
    "/api/accounts",
    "/api/accounts/{account_id}/edit",
    "/api/accounts/{account_id}/delete",
    "/api/accounts/{account_id}/sync",
    "/api/paper/open",
    "/api/paper/settle",
    "/api/paper/close",
    # Chart-snapshot journal — saves an image + forecast + score to our own store/
    # disk. Journal/analysis only; no broker or order path (ADR-010 holds).
    "/api/journal/upload",
    "/api/journal/score",
    "/api/journal/delete",
    "/api/journal/entry",
    "/api/journal/ensure_today",
    # Coach webhook secret into OUR meta table; and the inbound TradingView
    # webhook that forwards a coach alert to Telegram. Both write only our store /
    # send one outbound Telegram message — no broker / order path (ADR-010 holds).
    "/api/reclaim-bot/webhook-secret",
    "/webhook/tradingview",
    # forecast-analyst forecasts — persist a 'what will price do' read + score it later.
    # Writes only our own SQLite; no broker/order path (ADR-010 holds).
    "/api/spx/forecast",
    "/api/spx/forecast/{fid}/score",
    # On-demand playbook-level compute + 1m seed for the forecast screen. Writes
    # only our own store (scaffold + bars); no broker/order path (ADR-010 holds).
    "/api/spx/prepare",
    # Light intraday 1m refresh (today, force). Writes only our own store
    # (intraday bars); no broker/order path (ADR-010 holds).
    "/api/spx/refresh",
    # Replay Forecast (ticker-neutral): plan primes 1m bars + enumerates steps;
    # score grades every forecast in the run with CODE (score_forecast); calibration
    # persists the code-computed hit-rates. Writes only our own SQLite (forecasts,
    # intraday bars, calibration); no broker/order path (ADR-010 holds).
    "/api/replay/plan",
    "/api/replay/{run_id}/score",
    "/api/replay/{run_id}/calibration",
    # ICT scanner: seed 60m bars for the universe + run the validated htf detector,
    # and edit the manual ad-hoc ticker list. Writes only our own SQLite (universe,
    # 60m bars, scanner_result); no broker/order path (ADR-010 holds).
    "/api/scanner/refresh",
    "/api/scanner/tickers",
    # Manual chart refresh: force-refetch the source bars (1m/60m) for a symbol so
    # new candles appear. Writes only our own SQLite (intraday bars); no broker/order
    # path (ADR-010 holds).
    "/api/chart/{symbol}/refresh",
    # Chart drawings — upsert/delete user-drawn annotations (client-generated id →
    # idempotent). POST-only per convention ({delete:id} removes). Writes only our
    # own SQLite (chart_drawings); no broker/order path (ADR-010 holds).
    "/api/chart/{symbol}/drawings",
    # ADR-015 strategy lifecycle. promote/pause/resume write only our own SQLite
    # (the lifecycle stage machine) — no broker path. The tick route drives the
    # autonomous order path (alpaca_execution) but is DRY-RUN unless the operator
    # has armed VANTAGE_LIVE_OK + VANTAGE_AUTONOMOUS_OK + cleared the kill switch;
    # its four gates + refusal tests live in test_alpaca_execution.py /
    # test_lifecycle.py. Every autonomous decision is audited (gate 4).
    "/api/lifecycle/{sid}/promote",
    "/api/lifecycle/{sid}/pause",
    "/api/lifecycle/{sid}/resume",
    "/api/lifecycle/tick",
}


def test_only_refresh_route_mutates(client):
    app = client.app
    for route in app.routes:
        methods = getattr(route, "methods", None) or set()
        extra = methods - {"GET", "HEAD", "OPTIONS"}
        if not extra:
            continue
        assert getattr(route, "path", None) in ALLOWED_WRITE_ROUTES, (
            f"unexpected mutating route: {route.path} {methods}"
        )
        assert extra == {"POST"}, (
            f"{route.path} may only add POST, found {extra}"
        )


# ----------------------------------------------------------------- CORS

def test_cors_allows_spa_origin(client):
    r = client.get("/api/positions", headers={"Origin": "http://localhost:8642"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:8642"


def test_cors_preflight_allows_get_and_post(client):
    # GET (every read route) and POST (the deliberate /api/refresh write) are
    # the only allowed methods after the policy shift.
    for method in ("GET", "POST"):
        r = client.options(
            "/api/positions",
            headers={
                "Origin": "http://localhost:8642",
                "Access-Control-Request-Method": method,
            },
        )
        assert r.status_code == 200, f"{method} preflight should be allowed"
    r_delete = client.options(
        "/api/positions",
        headers={
            "Origin": "http://localhost:8642",
            "Access-Control-Request-Method": "DELETE",
        },
    )
    assert r_delete.status_code == 400  # DELETE is still not an allowed method

def test_cors_rejects_foreign_origin(client):
    r = client.get("/api/positions", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in r.headers


# ----------------------------------------------------- analysis journal routes

def test_analysis_empty_when_no_journal(client):
    """The fixture data dir has no analysis/ dir — the route is a clean empty
    state, never a 500."""
    r = client.get("/api/analysis")
    assert r.status_code == 200
    body = r.json()
    assert body["decisions"] == []


def _seed_journal(tmp_path, src):
    """A minimal data dir: fixture files copied in + a two-day analysis journal."""
    import shutil
    from vantage_server import analyze, income

    for name in ("accounts.json", "lots.json", "recent_buys.json", "auto_buys.json",
                 "partner_map.json", "quotes.json", "signals.json"):
        shutil.copy(src / name, tmp_path / name)

    def dec(sym, rec):
        return income.PositionDecision(
            symbol=sym, as_of="2026-07-05", current_price=100.0,
            conviction=income.ConvictionView(label="strong", score=0.9),
            recommendation=rec, rule="r", rationale="why",
            evidence={"per_tf": {"daily": {}}}, action_detail={"kind": "close"})

    import datetime as _dt
    analyze.write_journal(tmp_path, "2026-07-04", [dec("PLTR", income.MONITOR)],
                          now=_dt.datetime(2026, 7, 4, 21, 0, 0))
    analyze.write_journal(tmp_path, "2026-07-05",
                          [dec("PLTR", income.CLOSE_AND_BOOK_LOSS), dec("SOXS", income.MONITOR)],
                          now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    return tmp_path


def test_analysis_latest_and_date_and_symbol_filter(tmp_path, data_dir):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app

    seeded = _seed_journal(tmp_path, data_dir)
    c = TestClient(create_app(seeded))

    # latest day
    body = c.get("/api/analysis").json()
    assert body["date"] == "2026-07-05"
    assert {d["symbol"] for d in body["decisions"]} == {"PLTR", "SOXS"}

    # specific older day
    body4 = c.get("/api/analysis", params={"date": "2026-07-04"}).json()
    assert body4["date"] == "2026-07-04"
    assert [d["symbol"] for d in body4["decisions"]] == ["PLTR"]

    # symbol filter
    only = c.get("/api/analysis", params={"symbol": "pltr"}).json()
    assert [d["symbol"] for d in only["decisions"]] == ["PLTR"]
    assert only["decisions"][0]["recommendation"] == income.CLOSE_AND_BOOK_LOSS


def test_analysis_history_trail(tmp_path, data_dir):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app

    seeded = _seed_journal(tmp_path, data_dir)
    c = TestClient(create_app(seeded))

    body = c.get("/api/analysis/history", params={"symbol": "PLTR"}).json()
    assert body["symbol"] == "PLTR"
    assert [r["as_of"] for r in body["history"]] == ["2026-07-05", "2026-07-04"]
    # required symbol param -> 422 without it
    assert c.get("/api/analysis/history").status_code == 422


def test_analysis_routes_reject_mutation(client):
    for route in ("/api/analysis", "/api/analysis/history?symbol=PLTR"):
        for method in ("post", "put", "delete", "patch"):
            assert getattr(client, method)(route).status_code == 405


# ------------------------------------------------------------- /api/bars

def _make_daily(n: int, start_day: int = 1, base: float = 100.0) -> list[dict]:
    """A synthetic upward-then-wavy daily series with enough bars for pivots."""
    bars = []
    for i in range(n):
        px = base + (i % 20) - (i % 7) * 2  # some swings so S/R has pivots
        day = start_day + i
        bars.append({
            "date": f"2026-{(day // 28) + 1:02d}-{(day % 28) + 1:02d}",
            "open": px, "high": px + 3, "low": px - 3, "close": px + 1,
            "volume": 1_000_000 + i,
        })
    return bars


def _seed_bars_dir(tmp_path, src, symbol="PLTR"):
    """A data dir with fixture files + a bars/<SYMBOL>.json + a journal for it."""
    import shutil
    from vantage_server import analyze, bars as bars_engine, income, snapshot_bars

    for name in ("accounts.json", "lots.json", "recent_buys.json", "auto_buys.json",
                 "partner_map.json", "quotes.json", "signals.json"):
        shutil.copy(src / name, tmp_path / name)

    daily = _make_daily(120)
    series = {"daily": daily, "weekly": bars_engine.resample(daily, "week"),
              "monthly": bars_engine.resample(daily, "month")}
    snapshot_bars.write_bars(tmp_path, symbol, series, as_of="2026-07-05",
                             lookback_days=400, backfilled=True)

    import datetime as _dt
    dec = income.PositionDecision(
        symbol=symbol, as_of="2026-07-05", current_price=float(daily[-1]["close"]),
        conviction=income.ConvictionView(label="strong", score=0.9),
        recommendation=income.HOLD_AND_SELL_CALL, rule="strong_at_support",
        rationale="reads strong at support",
        evidence={"per_tf": {"daily": {}}},
        action_detail={"kind": "sell_call", "suggested_strike": 135.0,
                       "est_credit": 250.0})
    analyze.write_journal(tmp_path, "2026-07-05", [dec],
                          now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    return tmp_path


def _bars_client(tmp_path, data_dir):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app
    return TestClient(create_app(_seed_bars_dir(tmp_path, data_dir)))


@pytest.mark.parametrize("tf", ["daily", "weekly", "monthly"])
def test_bars_timeframes_with_serialized_levels(tmp_path, data_dir, tf):
    c = _bars_client(tmp_path, data_dir)
    r = c.get("/api/bars", params={"symbol": "PLTR", "timeframe": tf})
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "PLTR"
    assert body["timeframe"] == tf
    assert body["bar_count"] == len(body["bars"]) > 0
    assert body["first_bar"] and body["last_bar"]
    # levels serialized to {price, strength, kind} — Level objects are not
    # subscriptable, so a JSON round-trip proves serialization happened.
    levels = body["levels"]
    assert set(levels) == {"support", "resistance"}
    for side in ("support", "resistance"):
        for lv in levels[side]:
            assert set(lv) == {"price", "strength", "kind"}
            assert isinstance(lv["price"], (int, float))


def test_bars_defaults_to_daily(tmp_path, data_dir):
    c = _bars_client(tmp_path, data_dir)
    body = c.get("/api/bars", params={"symbol": "PLTR"}).json()
    assert body["timeframe"] == "daily"


def test_bars_404_when_no_bars_for_symbol(tmp_path, data_dir):
    c = _bars_client(tmp_path, data_dir)
    r = c.get("/api/bars", params={"symbol": "ZZZZ"})
    assert r.status_code == 404
    assert r.json()["detail"] == {"error": "no_bars_for_symbol"}


def test_bars_bad_timeframe_422(tmp_path, data_dir):
    c = _bars_client(tmp_path, data_dir)
    assert c.get("/api/bars",
                 params={"symbol": "PLTR", "timeframe": "quarter"}).status_code == 422


def test_bars_missing_symbol_422(tmp_path, data_dir):
    c = _bars_client(tmp_path, data_dir)
    assert c.get("/api/bars").status_code == 422


def test_bars_carries_envelope(tmp_path, data_dir):
    c = _bars_client(tmp_path, data_dir)
    body = c.get("/api/bars", params={"symbol": "PLTR"}).json()
    assert "as_of" in body and "source" in body and "stale" in body


@pytest.mark.parametrize("method", ["post", "put", "delete", "patch"])
def test_bars_routes_reject_mutation(tmp_path, data_dir, method):
    c = _bars_client(tmp_path, data_dir)
    assert getattr(c, method)("/api/bars?symbol=PLTR").status_code == 405
    assert getattr(c, method)("/api/bars/overlay?symbol=PLTR").status_code == 405


# ------------------------------------------------------- /api/bars/overlay

def test_bars_overlay_bundle(tmp_path, data_dir):
    c = _bars_client(tmp_path, data_dir)
    r = c.get("/api/bars/overlay", params={"symbol": "PLTR"})
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "PLTR"
    assert isinstance(body["current_price"], (int, float))

    # levels for every timeframe, serialized
    assert set(body["levels"]) == {"daily", "weekly", "monthly"}
    for tf in ("daily", "weekly", "monthly"):
        assert set(body["levels"][tf]) == {"support", "resistance"}

    # the latest journal decision for this symbol is bundled
    analysis = body["analysis"]
    assert analysis["symbol"] == "PLTR"
    assert analysis["recommendation"] == "HOLD_AND_SELL_CALL"
    assert analysis["action_detail"]["suggested_strike"] == 135.0

    # cost_basis from the underlying's lots (fixture has no PLTR lot -> None here)
    assert "cost_basis" in body


def test_bars_overlay_cost_basis_from_lots(tmp_path, data_dir):
    # NVDA is a plain-equity holding in the fixture lots -> cost_basis.equity set.
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app

    seeded = _seed_bars_dir(tmp_path, data_dir, symbol="NVDA")
    c = TestClient(create_app(seeded))
    body = c.get("/api/bars/overlay", params={"symbol": "NVDA"}).json()
    cb = body["cost_basis"]
    assert cb is not None and cb["equity"] is not None
    assert cb["equity"]["shares"] == 60          # fixture NVDA lot
    assert cb["equity"]["avg_cost"] == 121.4


def test_bars_overlay_404_when_no_bars(tmp_path, data_dir):
    c = _bars_client(tmp_path, data_dir)
    r = c.get("/api/bars/overlay", params={"symbol": "ZZZZ"})
    assert r.status_code == 404
    assert r.json()["detail"] == {"error": "no_bars_for_symbol"}


def test_bars_endpoints_absent_gracefully_on_fixture(client):
    """The fixture data dir has no bars/ directory -> clean 404, never a 500."""
    assert client.get("/api/bars", params={"symbol": "PLTR"}).status_code == 404
    assert client.get("/api/bars/overlay", params={"symbol": "PLTR"}).status_code == 404


# ── account management (settings-page write surface) ────────────────────────


@pytest.fixture()
def mgmt_client(tmp_path, data_dir):
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    return TestClient(create_app(tmp_path))


def test_create_account_with_currency_and_jurisdiction(mgmt_client):
    r = mgmt_client.post("/api/accounts", json={
        "id": "zerodha", "name": "Zerodha", "currency": "inr",
        "jurisdiction": "in", "broker": "zerodha"})
    assert r.status_code == 200
    acct = r.json()["account"]
    assert acct["currency"] == "INR" and acct["jurisdiction"] == "IN"
    # it now appears in the accounts list
    accts = mgmt_client.get("/api/accounts").json()["accounts"]
    z = next(a for a in accts if a["id"] == "zerodha")
    assert z["currency"] == "INR" and z["broker"] == "zerodha"
    # auth status + a host-side (no-secret) command are surfaced
    assert z["auth_status"] is not None
    assert "--broker zerodha --auth" in z["auth_hint"]


def test_create_account_requires_id_and_name(mgmt_client):
    assert mgmt_client.post("/api/accounts", json={"name": "x"}).status_code == 400
    assert mgmt_client.post("/api/accounts", json={"id": "x"}).status_code == 400


def test_create_duplicate_id_conflicts(mgmt_client):
    mgmt_client.post("/api/accounts", json={"id": "dup", "name": "A"})
    assert mgmt_client.post("/api/accounts", json={"id": "dup", "name": "B"}).status_code == 409


def test_edit_account_fields(mgmt_client):
    mgmt_client.post("/api/accounts", json={"id": "e1", "name": "Old", "currency": "USD"})
    r = mgmt_client.post("/api/accounts/e1/edit",
                         json={"name": "New", "currency": "EUR", "taxable": False})
    assert r.status_code == 200
    a = next(x for x in mgmt_client.get("/api/accounts").json()["accounts"] if x["id"] == "e1")
    assert a["name"] == "New" and a["currency"] == "EUR" and a["taxable"] is False


def test_delete_account_removes_it(mgmt_client):
    mgmt_client.post("/api/accounts", json={"id": "gone", "name": "Gone"})
    assert mgmt_client.post("/api/accounts/gone/delete").json()["removed"] is True
    ids = {a["id"] for a in mgmt_client.get("/api/accounts").json()["accounts"]}
    assert "gone" not in ids


def test_edit_and_delete_unknown_account_404(mgmt_client):
    assert mgmt_client.post("/api/accounts/nope/edit", json={"name": "x"}).status_code == 404
    assert mgmt_client.post("/api/accounts/nope/delete").status_code == 404


def test_us_account_has_no_auth_hint(mgmt_client):
    # a manual/CSV account (no API broker) exposes no auth command
    accts = mgmt_client.get("/api/accounts").json()["accounts"]
    manual = [a for a in accts if not a.get("refreshable")]
    assert manual and all(a["auth_hint"] is None for a in manual)


# ── Kite one-click re-auth endpoints ─────────────────────────────────────────


def test_kite_login_url_surfaces_setup_error_without_secrets(mgmt_client, monkeypatch):
    # no KITE_API_KEY/SECRET -> a 400 with a setup message, never a 500/secret
    monkeypatch.delenv("KITE_API_KEY", raising=False)
    monkeypatch.delenv("KITE_API_SECRET", raising=False)
    r = mgmt_client.get("/api/kite/login-url")
    # a setup error (missing SDK or missing keys) is a 400 with a message —
    # never a 500 and never a secret value.
    assert r.status_code == 400
    assert r.json()["error"]  # non-empty setup message


def test_kite_login_url_returns_url(mgmt_client, monkeypatch):
    from vantage_server.brokers import zerodha
    monkeypatch.setattr(zerodha.ZerodhaConnection, "login_url",
                        lambda self: "https://kite.zerodha.com/connect/login?api_key=x")
    body = mgmt_client.get("/api/kite/login-url").json()
    assert body["login_url"].startswith("https://kite.zerodha.com/connect/login")


def test_kite_callback_exchanges_and_saves(mgmt_client, monkeypatch):
    from vantage_server.brokers import zerodha
    calls = {}
    monkeypatch.setattr(zerodha.ZerodhaConnection, "exchange_request_token",
                        lambda self, tok: calls.setdefault("tok", tok) or {"saved": True})
    r = mgmt_client.get("/api/kite/callback", params={"request_token": "abc123"})
    assert r.status_code == 200
    assert "connected" in r.text.lower()
    assert calls["tok"] == "abc123"


def test_kite_callback_no_token_is_error_page(mgmt_client):
    r = mgmt_client.get("/api/kite/callback")
    assert r.status_code == 400 and "failed" in r.text.lower()


def test_kite_callback_invalid_token_shows_error(mgmt_client, monkeypatch):
    from vantage_server.brokers import zerodha
    def boom(self, tok):
        raise zerodha.BrokerConnectionError("Token is invalid or has expired.")
    monkeypatch.setattr(zerodha.ZerodhaConnection, "exchange_request_token", boom)
    r = mgmt_client.get("/api/kite/callback", params={"request_token": "bad"})
    assert r.status_code == 400 and "invalid or has expired" in r.text


def test_root_forwards_kite_redirect(mgmt_client, monkeypatch):
    from vantage_server.brokers import zerodha
    monkeypatch.setattr(zerodha.ZerodhaConnection, "exchange_request_token",
                        lambda self, tok: {"saved": True})
    # the Kite app's redirect can be the backend root -> forwards to callback
    r = mgmt_client.get("/", params={"request_token": "xyz"})
    assert r.status_code == 200 and "connected" in r.text.lower()
    # bare GET / is a liveness line, not the callback
    assert mgmt_client.get("/").json()["ok"] is True
