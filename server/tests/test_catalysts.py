"""Forward catalyst path: ordered fusion, horizon, no fabrication."""
from __future__ import annotations

import datetime as dt

from vantage_server.catalysts import catalyst_path


def test_orders_earnings_exdiv_opex_by_date():
    out = catalyst_path(
        "2026-07-12",
        earnings_dates=["2026-05-05", "2026-08-04"],  # only the future one
        ex_dividend="2026-07-20",
        opex={"next_opex": "2026-07-17", "next_opex_quarterly": False},
    )
    kinds = [(e["kind"], e["date"]) for e in out["events"]]
    assert kinds == [
        ("opex", "2026-07-17"),
        ("ex_dividend", "2026-07-20"),
        ("earnings", "2026-08-04"),
    ]
    assert out["next"]["kind"] == "opex"  # nearest is the gate
    assert out["next"]["days_until"] == 5


def test_triple_witching_labeled():
    out = catalyst_path(
        "2026-09-01",
        opex={"next_opex": "2026-09-18", "next_opex_quarterly": True},
    )
    assert out["events"][0]["kind"] == "triple_witching"
    assert "triple-witching" in out["events"][0]["note"]


def test_past_and_out_of_horizon_dropped():
    out = catalyst_path(
        "2026-07-12",
        earnings_dates=["2026-01-01"],           # past
        ex_dividend="2026-12-25",                # beyond 90d
        opex={"next_opex": "2026-07-17", "next_opex_quarterly": False},
    )
    assert [e["kind"] for e in out["events"]] == ["opex"]


def test_missing_sources_contribute_nothing():
    out = catalyst_path("2026-07-12")
    assert out["events"] == [] and out["next"] is None


def test_only_next_earnings_kept():
    out = catalyst_path(
        "2026-07-12",
        earnings_dates=["2026-08-04", "2026-11-03", "2027-02-02"],
    )
    earnings = [e for e in out["events"] if e["kind"] == "earnings"]
    assert len(earnings) == 1 and earnings[0]["date"] == "2026-08-04"


def test_horizon_is_configurable():
    out = catalyst_path("2026-07-12", ex_dividend="2026-10-01", horizon_days=30)
    assert out["events"] == []
    out2 = catalyst_path("2026-07-12", ex_dividend="2026-10-01", horizon_days=120)
    assert len(out2["events"]) == 1
