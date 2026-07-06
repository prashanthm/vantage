"""Pure round-trip reconstruction + labeling tests — the trust surface.

Fully offline and deterministic: canned orders + pnl_history + bars in, labeled
RoundTrips out. Covers a clean win, a loss, an option contract paired by its
DISPLAY symbol (not lumped with a different strike), an unmatched close emitted
with entry_unknown (never dropped/fabricated), and summarize() math on a known
set."""
from __future__ import annotations

import pytest

from vantage_server.ml import roundtrips as rt


def order(symbol, side, qty, price, date, *, kind="equity", state="filled",
          order_id=None):
    return {
        "account": "rh-margin", "broker_account": "...9024", "date": date,
        "kind": kind, "symbol": symbol, "description": "d", "side": side,
        "quantity": qty, "price": price, "amount": 0.0, "state": state,
        "order_id": order_id,
    }


def close(symbol, ts, qty, price, realized, side="sell"):
    return {"timestamp": ts, "symbol": symbol, "side": side,
            "quantity": qty, "price": price, "realized_gain": realized}


def daily(symbol_bars):
    return symbol_bars


# --------------------------------------------------------------- clean win

def test_clean_win_round_trip_with_excursion():
    orders = [order("AAPL", "buy", 10, 100.0, "2026-06-01T15:00:00Z",
                    order_id="open-1")]
    # price ran to 112 high before we sold at 110 -> left a little on the table
    bars = {"AAPL": [
        {"date": f"2026-06-{d:02d}", "open": 100, "high": 100 + d, "low": 99,
         "close": 100 + d, "volume": 1_000}
        for d in range(1, 11)  # high peaks at 110 on 06-10
    ]}
    pnl = [close("AAPL", "2026-06-10T15:00:00Z", 10, 110.0, 100.0)]

    trips = rt.reconstruct(orders, pnl, bars_by_symbol=bars)
    assert len(trips) == 1
    t = trips[0]
    assert t.symbol == "AAPL" and t.kind == "equity"
    assert t.win is True
    assert t.realized_pnl == 100.0
    assert t.open_date == "2026-06-01" and t.close_date == "2026-06-10"
    assert t.holding_days == 9
    assert t.entry_price == 100.0 and t.exit_price == 110.0
    assert t.realized_pct == pytest.approx(0.1)  # 100 / (100*10)
    assert t.entry_unknown is False
    assert t.open_order_id == "open-1"
    assert t.proxy is False
    # MFE: high 110 - entry 100 = 10/share * 10 shares = $100
    assert t.mfe == pytest.approx(100.0)
    assert t.mae == pytest.approx(-10.0)  # low 99 - 100 = -1 * 10
    assert t.mfe_capture == pytest.approx(1.0)  # realized 100 / mfe 100


# ------------------------------------------------------------------- loss

def test_loss_round_trip():
    orders = [order("TSLA", "buy", 5, 200.0, "2026-06-02T15:00:00Z",
                    order_id="open-2")]
    pnl = [close("TSLA", "2026-06-11T15:00:00Z", 5, 180.0, -100.0)]

    trips = rt.reconstruct(orders, pnl, bars_by_symbol={})
    assert len(trips) == 1
    t = trips[0]
    assert t.win is False
    assert t.realized_pnl == -100.0
    assert t.realized_pct == pytest.approx(-0.1)  # -100 / (200*5)
    assert t.entry_unknown is False
    # no bars -> excursion skipped, never fabricated
    assert t.mfe is None and t.mae is None and t.mfe_capture is None


# ----------------------------------------- option paired by DISPLAY symbol

def test_option_paired_by_display_symbol_not_lumped_by_strike():
    """Two SPY contracts of DIFFERENT strikes open; a SPY close must pair to
    the correct contract (oldest open FIFO for the underlying), leaving the
    other contract untouched — never lumping strikes together."""
    orders = [
        order("SPY 2026-07-17 750C", "buy", 1, 2.0, "2026-06-03T15:00:00Z",
              kind="option", order_id="open-750"),
        order("SPY 2026-07-17 800C", "buy", 1, 1.0, "2026-06-04T15:00:00Z",
              kind="option", order_id="open-800"),
    ]
    # one close of SPY -> should pair the OLDEST open (the 750C)
    pnl = [close("SPY", "2026-06-12T15:00:00Z", 1, 3.0, 100.0)]

    trips = rt.reconstruct(orders, pnl, bars_by_symbol={})
    assert len(trips) == 1
    t = trips[0]
    assert t.kind == "option"
    assert t.symbol == "SPY"
    assert t.contracts_or_shares == "contracts"
    # paired to the 750C contract's open (entry = 2.0 * 100 multiplier)
    assert t.open_order_id == "open-750"
    assert t.entry_price == pytest.approx(200.0)
    assert t.open_date == "2026-06-03"
    assert t.proxy is True  # option excursion is an underlying proxy
    assert t.win is True


def test_two_option_closes_consume_both_contracts_in_order():
    """Two SPY closes consume both open contracts (oldest first), each to its
    own contract — a second close does not re-pair the first contract."""
    orders = [
        order("SPY 2026-07-17 750C", "buy", 1, 2.0, "2026-06-03T15:00:00Z",
              kind="option", order_id="open-750"),
        order("SPY 2026-07-17 800C", "buy", 1, 1.0, "2026-06-04T15:00:00Z",
              kind="option", order_id="open-800"),
    ]
    pnl = [
        close("SPY", "2026-06-12T15:00:00Z", 1, 3.0, 100.0),
        close("SPY", "2026-06-13T15:00:00Z", 1, 0.5, -50.0),
    ]
    trips = rt.reconstruct(orders, pnl, bars_by_symbol={})
    assert len(trips) == 2
    # oldest close pairs oldest open (750), next close pairs the 800
    paired = {t.close_date: t.open_order_id for t in trips}
    assert paired["2026-06-12"] == "open-750"
    assert paired["2026-06-13"] == "open-800"


# -------------------------------------------- unmatched close -> entry_unknown

def test_close_with_no_matchable_open_is_emitted_entry_unknown():
    """A realized close whose open predates the fetched history is STILL
    emitted with the realized_gain and entry_unknown=True — never dropped,
    never fabricated."""
    orders = []  # no opens at all
    pnl = [close("NVDA", "2026-06-13T15:00:00Z", 2, 50.0, 40.0)]

    trips = rt.reconstruct(orders, pnl, bars_by_symbol={})
    assert len(trips) == 1
    t = trips[0]
    assert t.symbol == "NVDA"
    assert t.realized_pnl == 40.0 and t.win is True
    assert t.entry_unknown is True
    assert t.open_date is None
    assert t.entry_price is None
    assert t.holding_days is None
    assert t.realized_pct is None  # no cost basis to divide by
    assert t.open_order_id is None
    # exit info from the pnl row is still preserved
    assert t.exit_price == 50.0
    assert t.quantity == 2.0


def test_cancelled_open_is_ignored_leaving_close_unmatched():
    """A cancelled (unfilled) opening order is not a real position — a close
    that would otherwise pair to it is emitted entry_unknown."""
    orders = [order("AMD", "buy", 3, 90.0, "2026-06-01T15:00:00Z",
                    state="cancelled", order_id="cx")]
    pnl = [close("AMD", "2026-06-05T15:00:00Z", 3, 95.0, 15.0)]
    trips = rt.reconstruct(orders, pnl, bars_by_symbol={})
    assert len(trips) == 1
    assert trips[0].entry_unknown is True
    assert trips[0].realized_pnl == 15.0


# -------------------------------------------------------------- summarize

def test_summarize_math_on_known_set():
    """profit_factor / win_rate / avg_holding on a hand-checkable set."""
    orders = [
        order("AAPL", "buy", 10, 100.0, "2026-06-01T00:00:00Z", order_id="o1"),
        order("TSLA", "buy", 5, 200.0, "2026-06-01T00:00:00Z", order_id="o2"),
        order("MSFT", "buy", 4, 300.0, "2026-06-01T00:00:00Z", order_id="o3"),
    ]
    pnl = [
        close("AAPL", "2026-06-11T00:00:00Z", 10, 120.0, 200.0),  # win, hold 10d
        close("MSFT", "2026-06-05T00:00:00Z", 4, 325.0, 100.0),   # win, hold 4d
        close("TSLA", "2026-06-07T00:00:00Z", 5, 180.0, -100.0),  # loss, hold 6d
    ]
    trips = rt.reconstruct(orders, pnl, bars_by_symbol={})
    s = rt.summarize(trips)
    assert s["count"] == 3
    assert s["wins"] == 2 and s["losses"] == 1
    assert s["win_rate"] == pytest.approx(2 / 3, abs=1e-4)
    assert s["avg_win"] == pytest.approx(150.0)   # (200 + 100) / 2
    assert s["avg_loss"] == pytest.approx(-100.0)
    assert s["gross_profit"] == pytest.approx(300.0)
    assert s["gross_loss"] == pytest.approx(100.0)
    assert s["profit_factor"] == pytest.approx(3.0)  # 300 / 100
    assert s["avg_holding_days"] == pytest.approx((10 + 4 + 6) / 3, abs=1e-4)
    assert s["entry_unknown"] == 0
    # all-equity set -> by_kind has only equity
    assert set(s["by_kind"]) == {"equity"}
    assert s["by_kind"]["equity"]["count"] == 3


def test_summarize_profit_factor_none_with_no_losses():
    orders = [order("AAPL", "buy", 1, 10.0, "2026-06-01T00:00:00Z", order_id="o1")]
    pnl = [close("AAPL", "2026-06-02T00:00:00Z", 1, 12.0, 2.0)]
    trips = rt.reconstruct(orders, pnl, bars_by_symbol={})
    s = rt.summarize(trips)
    assert s["losses"] == 0
    assert s["profit_factor"] is None  # undefined ratio, not infinity
    assert s["avg_loss"] is None


def test_summarize_empty():
    s = rt.summarize([])
    assert s["count"] == 0
    assert s["win_rate"] is None
    assert s["profit_factor"] is None
    assert s["by_kind"] == {}


# ------------------------------------------------ summarize_rows (dict form)

def test_summarize_rows_matches_summarize():
    """summarize_rows over serialized dicts equals summarize over dataclasses —
    the API/MCP recompute path stays consistent with the engine."""
    from dataclasses import asdict

    orders = [
        order("AAPL", "buy", 10, 100.0, "2026-06-01T00:00:00Z", order_id="o1"),
        order("TSLA", "buy", 5, 200.0, "2026-06-01T00:00:00Z", order_id="o2"),
    ]
    pnl = [
        close("AAPL", "2026-06-11T00:00:00Z", 10, 120.0, 200.0),
        close("TSLA", "2026-06-07T00:00:00Z", 5, 180.0, -100.0),
    ]
    trips = rt.reconstruct(orders, pnl, bars_by_symbol={})
    rows = [asdict(t) for t in trips]
    assert rt.summarize_rows(rows) == rt.summarize(trips)


# ------------------------------------------------------- short excursion sign

def test_short_option_close_excursion_uses_favorable_direction():
    """A short (sell-to-open) leg's realized close still books under the
    underlying via pnl; with no long open it is entry_unknown, so excursion is
    skipped — the engine never fabricates a short entry it can't see."""
    orders = [order("SPXW 2026-07-02 7490C", "sell", 1, 20.0,
                    "2026-06-30T15:00:00Z", kind="option", order_id="short-open")]
    pnl = [close("SPXW", "2026-07-02T19:59:00Z", 1, 5.0, 1500.0)]
    trips = rt.reconstruct(orders, pnl, bars_by_symbol={})
    assert len(trips) == 1
    # sell-to-open is not treated as a long open, so this close is unmatched
    assert trips[0].entry_unknown is True
    assert trips[0].realized_pnl == 1500.0


# ------------------------------------ build_roundtrips write (I/O layer)

def test_write_roundtrips_merges_by_account_and_backs_up(tmp_path):
    """Merge-by-account + backup, mirroring the importer's write pattern."""
    import datetime as _dt
    from dataclasses import asdict
    import json

    from vantage_server.ml import build_roundtrips as build

    def trip(symbol, pnl, win):
        return rt.RoundTrip(
            symbol=symbol, kind="equity", open_date="2026-06-01",
            close_date="2026-06-10", holding_days=9, entry_price=100.0,
            exit_price=110.0, quantity=1.0, contracts_or_shares="shares",
            realized_pnl=pnl, realized_pct=0.1, win=win, mfe=None, mae=None,
            mfe_pct=None, mae_pct=None, mfe_capture=None, proxy=False,
            entry_unknown=False, open_order_id="o1", close_order_id=None)

    now = _dt.datetime(2026, 7, 5, 12, 0, 0)
    # first build for account A
    path, backup = build.write_roundtrips(
        tmp_path, "rh-margin", [trip("AAPL", 100.0, True)],
        {"count": 1}, as_of="2026-07-05", now=now)
    assert backup is None
    data = json.loads(path.read_text())
    assert data["account"] == "rh-margin"
    assert [r["symbol"] for r in data["roundtrips"]] == ["AAPL"]
    assert data["roundtrips"][0]["account"] == "rh-margin"

    # build for a DIFFERENT account keeps A's rows, backs up
    path, backup = build.write_roundtrips(
        tmp_path, "rh-main", [trip("TSLA", -50.0, False)],
        {"count": 1}, as_of="2026-07-05", now=now)
    assert backup is not None and backup.is_file()
    data = json.loads(path.read_text())
    by_acct = {r["symbol"]: r["account"] for r in data["roundtrips"]}
    assert by_acct == {"AAPL": "rh-margin", "TSLA": "rh-main"}

    # rebuild account A REPLACES its rows, keeps the other account's
    path, _ = build.write_roundtrips(
        tmp_path, "rh-margin", [trip("MSFT", 20.0, True)],
        {"count": 1}, as_of="2026-07-06", now=now)
    data = json.loads(path.read_text())
    by_acct = {r["symbol"]: r["account"] for r in data["roundtrips"]}
    assert by_acct == {"MSFT": "rh-margin", "TSLA": "rh-main"}
    assert "AAPL" not in by_acct  # old rh-margin rows replaced


def test_build_roundtrips_end_to_end_with_stubbed_fetch(tmp_path, monkeypatch):
    """The CLI: history.json -> reconstruct with a stubbed pnl fetch + a bars
    file -> ml/roundtrips.json. Fully offline (no broker)."""
    import json

    from vantage_server import snapshot_bars
    from vantage_server import bars as bars_engine
    from vantage_server.ml import build_roundtrips as build
    from vantage_server.brokers import robinhood

    # a history.json with one filled AAPL buy for rh-margin
    history = [order("AAPL", "buy", 10, 100.0, "2026-06-01T15:00:00Z",
                     order_id="open-1")]
    (tmp_path / "history.json").write_text(json.dumps(history), encoding="utf-8")

    # a bars file for AAPL so excursion is computed
    daily_bars = [
        {"date": f"2026-06-{d:02d}", "open": 100, "high": 100 + d, "low": 99,
         "close": 100 + d, "volume": 1_000}
        for d in range(1, 11)
    ]
    series = {"daily": daily_bars,
              "weekly": bars_engine.resample(daily_bars, "week"),
              "monthly": bars_engine.resample(daily_bars, "month")}
    snapshot_bars.write_bars(tmp_path, "AAPL", series, as_of="2026-07-05",
                             lookback_days=400, backfilled=True)

    # stub the broker pnl fetch (no network)
    def fake_pnl(account_number, *, limit=500):
        assert account_number == "9024"
        return [{"timestamp": "2026-06-10T15:00:00Z", "symbol": "AAPL",
                 "side": "sell", "quantity": 10.0, "price": 110.0,
                 "realized_gain": 100.0}]

    monkeypatch.setattr(robinhood, "fetch_pnl_trade_history", fake_pnl)

    rc = build.main(["--account", "rh-margin", "--broker-account", "9024",
                     "--data-dir", str(tmp_path)])
    assert rc == 0
    data = json.loads((tmp_path / "ml" / "roundtrips.json").read_text())
    assert data["account"] == "rh-margin"
    assert len(data["roundtrips"]) == 1
    t = data["roundtrips"][0]
    assert t["symbol"] == "AAPL" and t["win"] is True
    assert t["realized_pnl"] == 100.0
    assert t["mfe"] == 100.0  # excursion from the bars file
    assert t["entry_unknown"] is False
    assert data["summary"]["win_rate"] == 1.0


def test_build_roundtrips_no_history_errors(tmp_path):
    from vantage_server.ml import build_roundtrips as build
    rc = build.main(["--account", "rh-margin", "--broker-account", "9024",
                     "--data-dir", str(tmp_path)])
    assert rc == 2  # EXIT_USER_ERROR: no order history
