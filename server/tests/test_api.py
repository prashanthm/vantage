"""REST contract tests: payload shape, provenance envelope, read-only
guarantee (no method but GET works — ADR-010), and CORS for the SPA origin."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

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


# ------------------------------------------------- read-only guarantee

@pytest.mark.parametrize("route", ALL_GET_ROUTES)
@pytest.mark.parametrize("method", ["post", "put", "delete", "patch"])
def test_no_mutating_method_exists(client, route, method):
    r = getattr(client, method)(route)
    assert r.status_code == 405, f"{method.upper()} {route} must be rejected"


def test_no_mutating_routes_registered(client):
    app = client.app
    for route in app.routes:
        methods = getattr(route, "methods", None) or set()
        assert not (methods - {"GET", "HEAD", "OPTIONS"}), (
            f"mutating route found: {route.path} {methods} (violates ADR-010)"
        )


# ----------------------------------------------------------------- CORS

def test_cors_allows_spa_origin(client):
    r = client.get("/api/positions", headers={"Origin": "http://localhost:8642"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:8642"


def test_cors_preflight_get_only(client):
    r = client.options(
        "/api/positions",
        headers={
            "Origin": "http://localhost:8642",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code == 200
    r_post = client.options(
        "/api/positions",
        headers={
            "Origin": "http://localhost:8642",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r_post.status_code == 400  # POST is not an allowed method

def test_cors_rejects_foreign_origin(client):
    r = client.get("/api/positions", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in r.headers
