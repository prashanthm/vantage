"""Staged order tickets: compute everything, place nothing (ADR-010)."""
from __future__ import annotations

import pytest

from vantage_server import order_ticket as ot, reclaim_strategy as spec


# ── sizing ───────────────────────────────────────────────────────────────────


def test_size_for_risk_floors_never_rounds_up():
    # $100 risk, $0.77 per-share risk -> 129.8… -> 129 shares (never 130)
    assert ot.size_for_risk(385.10, 384.33, 100.0) == 129
    # can't afford one share -> 0, not a fraction
    assert ot.size_for_risk(7500.0, 7485.0, 10.0) == 0
    # degenerate stops -> 0
    assert ot.size_for_risk(100.0, 100.0, 100.0) == 0
    assert ot.size_for_risk(100.0, 99.0, 0.0) == 0


def test_split_across_targets_even_with_remainder_on_t1():
    assert ot.split_across_targets(100, 3) == [34, 33, 33]
    assert ot.split_across_targets(2, 3) == [2]        # zero legs dropped
    assert ot.split_across_targets(0, 3) == []
    assert ot.split_across_targets(10, 0) == []


# ── ticket geometry is the shared spec ───────────────────────────────────────


def test_ticket_uses_spec_geometry():
    sups, ress = [95.0, 92.0], [105.0, 110.0, 120.0]
    t = ot.build_ticket("MSFT", "long", 95.0, sups, ress, risk_amount=100.0)
    assert t["orders"]["entry"]["price"] == 95.0
    assert t["orders"]["entry"]["action"] == "BUY"
    assert t["orders"]["stop"]["price"] == round(spec.stop_for(95.0, "long"), 2)
    # target ladder = spec's next-3-opposing-levels, nearest first
    assert [x["price"] for x in t["orders"]["targets"]] == [105.0, 110.0, 120.0]
    assert t["risk"]["stop_pad_pct"] == spec.STOP_PAD_PCT
    # qty sized so a stop-out costs <= the requested risk
    assert t["risk"]["max_loss_at_stop"] <= 100.0
    assert t["sized"] is True


def test_short_ticket_actions_invert():
    t = ot.build_ticket("MSFT", "short", 105.0, [95.0, 92.0], [110.0])
    assert t["orders"]["entry"]["action"] == "SELL"
    assert t["orders"]["stop"]["action"] == "BUY"
    assert [x["price"] for x in t["orders"]["targets"]] == [95.0, 92.0]


def test_ticket_rejects_nonsense():
    with pytest.raises(ValueError):
        ot.build_ticket("X", "sideways", 100.0, [], [])
    with pytest.raises(ValueError):
        ot.build_ticket("X", "long", 0.0, [], [])


def test_unsized_ticket_is_honest():
    # risk too small for one share: qty 0, flagged, no fake legs
    t = ot.build_ticket("SPX", "long", 7500.0, [], [7550.0], risk_amount=1.0)
    assert t["sized"] is False
    assert t["orders"]["entry"]["qty"] == 0
    assert t["orders"]["targets"] == []          # no legs when nothing to split


# ── indexes aren't buyable: proxy mapping ────────────────────────────────────


def test_indexes_map_to_tradeable_proxies():
    assert ot.proxy_for("SPX") == "SPY"
    assert ot.proxy_for("spx") == "SPY"
    assert ot.proxy_for("NDX") == "QQQ"
    assert ot.proxy_for("RUT") == "IWM"
    assert ot.proxy_for("XSP") == "SPY"
    # tradeable instruments pass through untouched
    assert ot.proxy_for("SPY") is None
    assert ot.proxy_for("MSFT") is None
    assert ot.proxy_for("QQQ") is None


def test_rescale_applies_ratio():
    assert ot.rescale([7500.0, 7481.0], 0.1) == [750.0, 748.1]
    assert ot.rescale([], 0.1) == []


def test_derived_from_carried_and_rendered():
    df = {"index": "SPX", "index_level": 7481.0, "ratio": 0.1,
          "proxy_last": 748.1, "index_spot": 7481.0}
    t = ot.build_ticket("SPY", "long", 748.1, [745.0], [755.0],
                        risk_amount=200.0, derived_from=df)
    assert t["derived_from"] == df
    txt = ot.render_ticket(t)
    assert "from SPX 7481.0 @ ratio 0.1" in txt
    assert "SPX is an index" in txt
    # a direct ticket renders no provenance line
    plain = ot.render_ticket(ot.build_ticket("MSFT", "long", 95.0, [92.0], [105.0]))
    assert "is an index" not in plain


# ── the ADR-010 boundary ──────────────────────────────────────────────────────


def test_module_is_pure_no_broker_or_network_imports():
    # the ticket layer must never be able to place an order: no broker
    # connectors, no HTTP, no kite/robinhood imports anywhere in the module.
    import inspect
    src = inspect.getsource(ot)
    for forbidden in ("brokers", "kiteconnect", "robin_stocks", "requests",
                      "httpx", "urllib", "place_order"):
        assert forbidden not in src, f"order_ticket must not reference {forbidden}"
    assert "STAGED ONLY" in ot.build_ticket("A", "long", 10.0, [], [])["note"]


def test_render_ticket_copy_paste_block():
    t = ot.build_ticket("MSFT", "long", 95.0, [92.0], [105.0], risk_amount=100.0)
    txt = ot.render_ticket(t)
    assert "LONG MSFT" in txt and "staged" in txt
    assert "entry  BUY" in txt and "@ 95.0 limit" in txt
    assert "stop   SELL" in txt
    assert "T1" in txt and "R:R" in txt
