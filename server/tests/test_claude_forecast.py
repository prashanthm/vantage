"""Claude forecast analyst — the enriched prompt + the SSE endpoint contract.

The Anthropic API is never called from tests: available() is False without an
ANTHROPIC_API_KEY, so the endpoint's graceful-degradation path (503 → the SPA
falls back to Mira) is what's exercised. The prompt builder is pure."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from vantage_server import claude_forecast as cf
from vantage_server.api import create_app

SNAPSHOT = {
    "symbol": "SPX", "day": "2026-07-24", "as_of": "2026-07-24T10:30:00-04:00",
    "price": 6321.5,
    "technicals": {"vwap": 6318.2, "vs_vwap_pt": 3.3, "rsi": 61, "atr": 4.2},
    "regime": {"gamma": "suppress", "vwap_regime": "above VWAP (buyers in control, +3.3pt)"},
    "ict_htf": {"present": False},
    "bars_5m": [{"time": i, "open": 1, "high": 2, "low": 0, "close": 1}
                for i in range(200)],
}


@pytest.fixture(scope="module")
def client(data_dir):
    return TestClient(create_app(data_dir))


# ---------------------------------------------------------------- prompt

def test_prompt_inlines_the_snapshot_facts():
    p = cf.build_prompt("SPX", SNAPSHOT)
    assert "vs_vwap_pt" in p and "6321.5" in p          # deterministic facts inline
    assert "DISCIPLINE (hard rules)" in p                # post-mortem rules kept


def test_prompt_carries_the_output_contract():
    p = cf.build_prompt("QQQ", SNAPSHOT)
    # the machine-parsed shape: mira-render sections + the scoreable plot object
    for key in ('"headline"', '"plot"', '"bias"', '"target"', '"invalidation"',
                '"confidence"', '"path"', '"sections"'):
        assert key in p
    assert "QQQ" in p


def test_prompt_trims_the_candle_series():
    p = cf.build_prompt("SPX", SNAPSHOT)
    assert "bars_5m_tail" in p
    # full 200-bar series must not travel; only the tail does
    start = p.index("SNAPSHOT")
    snap = json.loads(p[p.index("{", start):])
    assert "bars_5m" not in snap
    assert len(snap["bars_5m_tail"]) == cf._BARS_TAIL


def test_prompt_survives_a_snapshot_without_bars():
    slim = {k: v for k, v in SNAPSHOT.items() if k != "bars_5m"}
    p = cf.build_prompt("SPX", slim)
    assert "bars_5m_tail" not in p


# ---------------------------------------------------------------- availability

def test_unavailable_without_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    ok, note = cf.available()
    assert not ok and "ANTHROPIC_API_KEY" in note


def test_stream_emits_one_terminal_error_frame_when_unconfigured(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    frames = list(cf.stream_forecast_sse("SPX", SNAPSHOT))
    assert len(frames) == 1
    assert frames[0].startswith("event: error\n")
    data = json.loads(frames[0].split("data: ", 1)[1].strip())
    assert data["code"] == "unavailable"


# ---------------------------------------------------------------- endpoint

def test_endpoint_answers_503_when_unconfigured(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post("/api/spx/forecast/claude",
                    json={"symbol": "SPX", "snapshot": SNAPSHOT})
    assert r.status_code == 503
    body = r.json()
    assert body["available"] is False
    assert "ANTHROPIC_API_KEY" in body["note"]


def test_endpoint_model_default():
    assert cf.model_name() == cf.DEFAULT_MODEL
