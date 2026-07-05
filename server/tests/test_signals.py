"""Signals grading: rule matrix (hit/stop/open in both directions, grade
bands, unquoted), seed loading (statuses may never be authored), the REST
contract, and the MCP round-trip."""
from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from mcp.shared.memory import create_connected_server_and_client_session

from vantage_server.api import create_app
from vantage_server.mcp_server import create_mcp
from vantage_server.models import Quote
from vantage_server.signals import Signal, grade_signal, grade_signals, load_signals
from vantage_server.store import StoreError


def q(symbol: str, price: float) -> dict[str, Quote]:
    return {symbol: Quote(symbol=symbol, name=symbol, price=price,
                          day_pct=0.0, asset_class="usEquity")}


LONG = Signal(id=1, sym="LNG", pattern="Breakout", entry=100.0, target=110.0, stop=95.0)
SHORT = Signal(id=2, sym="SHT", pattern="Breakdown", entry=100.0, target=90.0, stop=105.0)


# ------------------------------------------------------------ status matrix

@pytest.mark.parametrize("signal,price,status", [
    (LONG, 110.00, "hit_target"),   # at target
    (LONG, 115.00, "hit_target"),   # beyond target
    (LONG, 95.00, "stopped"),       # at stop
    (LONG, 90.00, "stopped"),       # through stop
    (LONG, 105.00, "open"),         # between
    (SHORT, 90.00, "hit_target"),   # at target (downward)
    (SHORT, 85.00, "hit_target"),   # beyond target
    (SHORT, 105.00, "stopped"),     # at stop (upward)
    (SHORT, 108.00, "stopped"),
    (SHORT, 97.00, "open"),
])
def test_status_matrix(signal, price, status):
    graded = grade_signal(signal, q(signal.sym, price))
    assert graded.status == status
    assert graded.price == price


def test_direction_implied_by_target_vs_entry():
    assert LONG.direction == "long" and SHORT.direction == "short"
    assert grade_signal(LONG, q("LNG", 100)).direction == "long"
    assert grade_signal(SHORT, q("SHT", 100)).direction == "short"


# ------------------------------------------------------------- pnl signing

def test_pnl_pct_signed_by_direction():
    assert grade_signal(LONG, q("LNG", 110)).pnl_pct == pytest.approx(10.0)
    assert grade_signal(LONG, q("LNG", 95)).pnl_pct == pytest.approx(-5.0)
    # short: falling price is favorable, so pnl is positive
    assert grade_signal(SHORT, q("SHT", 90)).pnl_pct == pytest.approx(10.0)
    assert grade_signal(SHORT, q("SHT", 105)).pnl_pct == pytest.approx(-5.0)


# -------------------------------------------------------------- grade bands

@pytest.mark.parametrize("signal,price,grade", [
    # long: entry 100, target 110 (move +10), stop 95 (adverse -5)
    (LONG, 110.00, "A"),   # 100% of move (hit target)
    (LONG, 107.50, "A"),   # exactly 75%
    (LONG, 106.00, "B"),   # 60%
    (LONG, 105.00, "B"),   # exactly 50%
    (LONG, 102.50, "C"),   # 25%
    (LONG, 100.00, "C"),   # flat-positive boundary
    (LONG, 99.00, "D"),    # negative, 20% of the way to the stop
    (LONG, 97.50, "F"),    # exactly halfway to stop
    (LONG, 95.00, "F"),    # stopped
    # short: entry 100, target 90, stop 105
    (SHORT, 90.00, "A"),
    (SHORT, 92.50, "A"),   # 75% of the downward move captured
    (SHORT, 95.00, "B"),
    (SHORT, 97.50, "C"),
    (SHORT, 100.00, "C"),
    (SHORT, 101.00, "D"),  # negative but above halfway-to-stop
    (SHORT, 102.50, "F"),  # halfway to stop
    (SHORT, 105.00, "F"),  # stopped
])
def test_progress_grade_bands(signal, price, grade):
    assert grade_signal(signal, q(signal.sym, price)).progress_grade == grade


def test_missing_quote_is_unquoted_with_null_grade():
    graded = grade_signal(LONG, {})
    assert graded.status == "unquoted"
    assert graded.price is None
    assert graded.pnl_pct is None
    assert graded.progress_grade is None


def test_grade_signals_preserves_order_and_is_pure():
    graded = grade_signals([LONG, SHORT], q("LNG", 105) | q("SHT", 97))
    assert [g.signal.id for g in graded] == [1, 2]
    assert [g.status for g in graded] == ["open", "open"]


# ------------------------------------------------------------------ loading

def test_load_fixture_signals(data_dir):
    signals = load_signals(data_dir)
    assert [s.id for s in signals] == [1, 2, 3, 4, 5, 6, 7, 8]
    by_sym = {s.sym: s for s in signals}
    assert by_sym["PLTR"].direction == "long"
    assert by_sym["AMD"].direction == "short"  # target 141 < entry 148.20
    assert by_sym["PLTR"].entry == pytest.approx(168.40)
    assert by_sym["META"].created_at == "Jun 30"
    assert not any(hasattr(s, "status") for s in signals)  # no authored status field


def test_missing_signals_file_is_empty_tuple(tmp_path):
    assert load_signals(tmp_path) == ()


def test_authored_status_is_rejected(tmp_path):
    (tmp_path / "signals.json").write_text(json.dumps([{
        "id": 1, "sym": "X", "pattern": "P", "entry": 1.0, "target": 2.0,
        "stop": 0.5, "status": "hit-target",
    }]), encoding="utf-8")
    with pytest.raises(StoreError, match="never authored"):
        load_signals(tmp_path)


def test_degenerate_levels_rejected(tmp_path):
    (tmp_path / "signals.json").write_text(json.dumps([{
        "id": 1, "sym": "X", "pattern": "P", "entry": 1.0, "target": 1.0, "stop": 0.5,
    }]), encoding="utf-8")
    with pytest.raises(StoreError, match="target != entry"):
        load_signals(tmp_path)


# --------------------------------------------------------------------- REST

@pytest.fixture(scope="module")
def client(data_dir):
    return TestClient(create_app(data_dir))


def test_api_signals_contract(client):
    body = client.get("/api/signals").json()
    assert body["as_of"] == "2026-07-05T09:30:00-04:00"
    assert body["source"] == "fixture"
    rows = body["signals"]
    assert len(rows) == 8
    # signal symbols are not in the fixture quote table: computed-not-authored
    # means they honestly report unquoted rather than the SPA's authored labels
    assert {r["status"] for r in rows} == {"unquoted"}
    assert all(r["progress_grade"] is None and r["pnl_pct"] is None for r in rows)
    first = rows[0]["signal"]
    assert first["sym"] == "PLTR" and first["entry"] == pytest.approx(168.40)


def test_api_signals_grades_when_quotes_exist(tmp_path, data_dir):
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    quotes = json.loads((data_dir / "quotes.json").read_text())
    quotes["quotes"]["PLTR"] = {"name": "Palantir", "price": 177.20, "day_pct": 0,
                                "asset_class": "usEquity"}
    quotes["quotes"]["META"] = {"name": "Meta", "price": 581.00, "day_pct": 0,
                                "asset_class": "usEquity"}
    (tmp_path / "quotes.json").write_text(json.dumps(quotes), encoding="utf-8")
    (tmp_path / "signals.json").write_text((data_dir / "signals.json").read_text(),
                                           encoding="utf-8")
    body = TestClient(create_app(tmp_path)).get("/api/signals").json()
    by_sym = {r["signal"]["sym"]: r for r in body["signals"]}
    pltr = by_sym["PLTR"]  # long 168.40 -> 177.20: at target
    assert pltr["status"] == "hit_target"
    assert pltr["progress_grade"] == "A"
    assert pltr["pnl_pct"] == pytest.approx((177.20 - 168.40) / 168.40 * 100, abs=1e-3)
    meta = by_sym["META"]  # long 588 -> 581: open, exactly halfway to the 574 stop
    assert meta["status"] == "open"
    assert meta["progress_grade"] == "F"
    assert by_sym["SMCI"]["status"] == "unquoted"


# ---------------------------------------------------------------------- MCP

def run_with_client(mcp, coro_fn):
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
