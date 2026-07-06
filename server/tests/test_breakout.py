"""Options breakout, crypto/futures sleeves, and transaction history:
normalizers against canned payloads copied from a LIVE read-only inspection
(2026-07-05, shapes documented in brokers/robinhood.py), importer conversion
+ CLI flows with stubbed fetchers, quotes.json mark-writing, and the history
writer's merge/backup semantics. Fully offline and deterministic."""
from __future__ import annotations

import json

import pytest

from vantage_server import importer
from vantage_server.importer import (
    EXIT_OK,
    EXIT_USER_ERROR,
    api_cash_lot,
    option_lots_and_quotes,
    sleeve_lots_and_quotes,
    update_quotes_file,
    write_history,
)
from vantage_server.brokers import robinhood
from vantage_server.brokers.base import option_display_symbol

AS_OF = "2026-07-05"


# ------------------------------------------------------ display symbol

def test_option_display_symbol_formats():
    assert option_display_symbol("SPY", "2026-07-17", 750.0, "call") == "SPY 2026-07-17 750C"
    assert option_display_symbol("soxs", "2026-07-10", 7.5, "put") == "SOXS 2026-07-10 7.5P"
    assert option_display_symbol("SPXW", "2026-07-02", 7490, "Call") == "SPXW 2026-07-02 7490C"


# --------------------------------------- fetch_option_positions (canned)

# Shapes copied from the live get_option_positions/get_option_instruments/
# get_option_quotes payloads (see brokers/robinhood.py docstrings).
CANNED_OPTION_POSITIONS = {
    "positions": [
        {"option_id": "id-soxl", "chain_symbol": "SOXL", "type": "long",
         "quantity": "1.0000", "average_price": "1982.0000",
         "expiration_date": "2026-07-10", "trade_value_multiplier": "100.0000",
         "opened_at": "2026-07-02T19:50:12.302980Z"},
        {"option_id": "id-soxs", "chain_symbol": "SOXS", "type": "short",
         "quantity": "10.0000", "average_price": "-39.0000",
         "expiration_date": "2026-07-10", "trade_value_multiplier": "100.0000",
         "opened_at": "2026-07-02T19:31:29.373965Z"},
        {"option_id": "id-gone", "chain_symbol": "ACN", "type": "long",
         "quantity": "2.0000", "average_price": "3600.0000",
         "expiration_date": "2028-01-21", "trade_value_multiplier": "100.0000"},
        {"option_id": "id-closed", "chain_symbol": "OLD", "type": "short",
         "quantity": "0.0000", "average_price": "0.0000",
         "expiration_date": "2026-07-10", "trade_value_multiplier": "100.0000"},
    ],
    "next": None,
}

CANNED_INSTRUMENTS = {
    "id-soxl": {"id": "id-soxl", "chain_symbol": "SOXL",
                "expiration_date": "2026-07-10", "strike_price": "178.0000",
                "type": "call", "state": "active"},
    "id-soxs": {"id": "id-soxs", "chain_symbol": "SOXS",
                "expiration_date": "2026-07-10", "strike_price": "7.5000",
                "type": "put", "state": "active"},
    # id-gone: instrument lookup returns nothing (strike/type unknown)
}

CANNED_OPTION_QUOTES = {
    "id-soxl": {"instrument_id": "id-soxl", "mark_price": "21.950000",
                "adjusted_mark_price": "21.950000"},
    "id-soxs": {"instrument_id": "id-soxs", "mark_price": "0.350000"},
}


def _fake_option_call(tool, payload):
    if tool == "get_option_positions":
        assert payload == {"account_number": "532189024", "nonzero": True}
        return CANNED_OPTION_POSITIONS
    if tool == "get_option_instruments":
        ids = payload["ids"].split(",")
        return {"instruments": [CANNED_INSTRUMENTS[i] for i in ids
                                if i in CANNED_INSTRUMENTS]}
    if tool == "get_option_quotes":
        return {"results": [{"quote": CANNED_OPTION_QUOTES[i], "close": {}}
                            for i in payload["instrument_ids"]
                            if i in CANNED_OPTION_QUOTES]}
    raise AssertionError(f"unexpected tool {tool}")


def test_fetch_option_positions_normalizes_canned_payload(monkeypatch):
    monkeypatch.setattr(robinhood, "_call", _fake_option_call)
    rows = robinhood.fetch_option_positions("532189024")
    assert len(rows) == 3  # zero-quantity (closed) row dropped
    soxl, soxs, gone = rows
    assert soxl == {
        "underlying": "SOXL", "expiration": "2026-07-10", "strike": 178.0,
        "option_type": "call", "position_type": "long", "contracts": 1.0,
        "avg_price": pytest.approx(19.82), "multiplier": 100.0,
        "instrument_id": "id-soxl", "occ_symbol": "SOXL 2026-07-10 178C",
        "opened_at": "2026-07-02T19:50:12.302980Z",
        "mark": pytest.approx(21.95),
    }
    # short: unsigned contracts + avg_price, direction in position_type
    assert soxs["position_type"] == "short"
    assert soxs["contracts"] == 10.0
    assert soxs["avg_price"] == pytest.approx(0.39)
    assert soxs["occ_symbol"] == "SOXS 2026-07-10 7.5P"
    # failed strike/type lookup: kept, but unnamed and unmarked
    assert gone["occ_symbol"] is None and "mark" not in gone
    assert gone["avg_price"] == pytest.approx(36.0)  # per-contract 3600 / 100


def test_fetch_option_positions_paginates_via_cursor(monkeypatch):
    calls = []

    def fake_call(tool, payload):
        if tool == "get_option_positions":
            calls.append(payload)
            if "cursor" not in payload:
                return {"positions": [CANNED_OPTION_POSITIONS["positions"][0]],
                        "next": "http://internal/x?account_numbers=1&cursor=PAGE2"}
            assert payload["cursor"] == "PAGE2"
            return {"positions": [CANNED_OPTION_POSITIONS["positions"][2]],
                    "next": None}
        return _fake_option_call(tool, payload)

    monkeypatch.setattr(robinhood, "_call", fake_call)
    rows = robinhood.fetch_option_positions("532189024")
    assert [r["underlying"] for r in rows] == ["SOXL", "ACN"]
    assert len(calls) == 2


# ------------------------------------------------- fetch_history (canned)

CANNED_EQUITY_ORDERS = {
    "orders": [
        {"id": "eq-1", "symbol": "IMSR", "side": "sell", "type": "market",
         "state": "filled", "quantity": "200.000000",
         "cumulative_quantity": "200.000000", "price": None,
         "average_price": "7.070000", "fees": "0.070000",
         "placed_agent": "user", "created_at": "2026-06-30T14:36:38.218194Z",
         "executions": [{"price": "7.070000", "quantity": "200.000000"}]},
        {"id": "eq-2", "symbol": "NVDA", "side": "buy", "type": "limit",
         "state": "cancelled", "quantity": "5.000000",
         "cumulative_quantity": "0.000000", "price": "150.000000",
         "average_price": None, "created_at": "2026-07-01T10:00:00Z",
         "executions": []},
        {"id": "eq-3", "symbol": "GME", "side": "sell_short", "type": "market",
         "state": "filled", "quantity": "3.000000",
         "cumulative_quantity": "3.000000", "average_price": "20.000000",
         "created_at": "2026-05-01T10:00:00Z"},
    ],
    "next": None,
}

CANNED_OPTION_ORDERS = {
    "orders": [
        # filled 2-leg debit spread (live SPXW shape, per-leg executions)
        {"id": "oo-1", "chain_symbol": "SPXW", "state": "filled",
         "type": "limit", "direction": "debit", "quantity": "1.00000",
         "processed_quantity": "1.00000", "price": "1.65000000",
         "premium": "165.00000000", "processed_premium": "165",
         "trade_value_multiplier": "100.0000",
         "opening_strategy": "long_call_spread", "closing_strategy": None,
         "created_at": "2026-07-02T19:40:00Z",
         "legs": [
             {"option_id": "l1", "side": "buy", "position_effect": "open",
              "ratio_quantity": 1, "expiration_date": "2026-07-02",
              "strike_price": "7465.0000", "option_type": "call",
              "executions": [{"price": "1.72000000", "quantity": "1.00000"}]},
             {"option_id": "l2", "side": "sell", "position_effect": "open",
              "ratio_quantity": 1, "expiration_date": "2026-07-02",
              "strike_price": "7490.0000", "option_type": "call",
              "executions": [{"price": "0.07000000", "quantity": "1.00000"}]},
         ]},
        # cancelled credit order, no executions -> nothing moved
        {"id": "oo-2", "chain_symbol": "SNK", "state": "cancelled",
         "type": "limit", "direction": "credit", "quantity": "2.00000",
         "processed_quantity": "0.00000", "price": "2.50000000",
         "trade_value_multiplier": "100.0000",
         "opening_strategy": None, "closing_strategy": "short_call",
         "created_at": "2026-06-22T14:00:00Z",
         "legs": [
             {"option_id": "l3", "side": "sell", "position_effect": "close",
              "ratio_quantity": 1, "expiration_date": "2026-07-17",
              "strike_price": "15.0000", "option_type": "call"},
         ]},
        # defensive path: an order the normalizer cannot map is NOT dropped
        {"id": "oo-3", "state": "rejected", "created_at": "2026-06-01T09:00:00Z",
         "legs": []},
    ],
    "next": None,
}


def _fake_history_call(tool, payload):
    assert payload.get("account_number") == "532189024"
    if tool == "get_equity_orders":
        return CANNED_EQUITY_ORDERS
    if tool == "get_option_orders":
        return CANNED_OPTION_ORDERS
    raise AssertionError(f"unexpected tool {tool}")


def test_fetch_history_normalizes_to_the_contract(monkeypatch):
    monkeypatch.setattr(robinhood, "_call", _fake_history_call)
    rows = robinhood.fetch_history("532189024")
    # exact contract keys on every row
    contract = {"account", "broker_account", "date", "kind", "symbol",
                "description", "side", "quantity", "price", "amount", "state"}
    assert all(set(r) == contract for r in rows)
    # newest first across BOTH sources
    assert [r["date"] for r in rows] == sorted(
        (r["date"] for r in rows), reverse=True)
    # broker account is masked, vantage account left for the importer
    assert all(r["broker_account"] == "...9024" for r in rows)
    assert all(r["account"] == "" for r in rows)

    by_id = {(r["kind"], r["symbol"], r["side"]): r for r in rows}
    filled_sell = by_id[("equity", "IMSR", "sell")]
    assert filled_sell["quantity"] == 200.0
    assert filled_sell["price"] == pytest.approx(7.07)
    assert filled_sell["amount"] == pytest.approx(1414.0)  # sells positive
    assert filled_sell["state"] == "filled"

    cancelled_buy = by_id[("equity", "NVDA", "buy")]
    assert cancelled_buy["price"] == pytest.approx(150.0)  # limit price surfaced
    assert cancelled_buy["amount"] == 0.0                  # nothing moved

    short_sale = by_id[("equity", "GME", "sell")]           # sell_short -> sell
    assert short_sale["amount"] == pytest.approx(60.0)

    # spread: one row PER LEG, amounts per-contract dollars, buys negative
    buy_leg = by_id[("option", "SPXW 2026-07-02 7465C", "buy")]
    sell_leg = by_id[("option", "SPXW 2026-07-02 7490C", "sell")]
    assert buy_leg["amount"] == pytest.approx(-172.0)
    assert sell_leg["amount"] == pytest.approx(7.0)
    assert buy_leg["quantity"] == 1.0 and buy_leg["price"] == pytest.approx(1.72)
    assert "long_call_spread" in buy_leg["description"]

    cancelled_credit = by_id[("option", "SNK 2026-07-17 15C", "sell")]
    assert cancelled_credit["amount"] == 0.0
    assert cancelled_credit["quantity"] == 2.0

    # the unmappable order surfaced as kind "other" with its raw state
    others = [r for r in rows if r["kind"] == "other"]
    assert len(others) == 1 and others[0]["state"] == "rejected"


def test_fetch_history_respects_limit(monkeypatch):
    monkeypatch.setattr(robinhood, "_call", _fake_history_call)
    rows = robinhood.fetch_history("532189024", limit=2)
    assert len(rows) == 2
    assert rows[0]["date"] >= rows[1]["date"]


# ------------------------------------------- option lots + quote entries

NORMALIZED_OPTIONS = [
    {"underlying": "SOXL", "expiration": "2026-07-10", "strike": 178.0,
     "option_type": "call", "position_type": "long", "contracts": 1.0,
     "avg_price": 19.82, "mark": 21.95, "multiplier": 100.0,
     "instrument_id": "id-soxl", "occ_symbol": "SOXL 2026-07-10 178C",
     "opened_at": "2026-07-02T19:50:12.302980Z"},
    {"underlying": "ACN", "expiration": "2028-01-21", "strike": 250.0,
     "option_type": "call", "position_type": "long", "contracts": 1.0,
     "avg_price": 36.0, "multiplier": 100.0,   # no mark from the broker
     "instrument_id": "id-acn", "occ_symbol": "ACN 2028-01-21 250C",
     "opened_at": None},
    {"underlying": "SOXS", "expiration": "2026-07-10", "strike": 7.5,
     "option_type": "put", "position_type": "short", "contracts": 10.0,
     "avg_price": 0.39, "mark": 0.35, "multiplier": 100.0,
     "instrument_id": "id-soxs", "occ_symbol": "SOXS 2026-07-10 7.5P"},
]


def test_option_lots_use_marks_and_skip_shorts_loudly():
    lots, quotes, warnings, value = option_lots_and_quotes(
        NORMALIZED_OPTIONS, "rh-margin", AS_OF)
    assert lots == [
        {"account": "rh-margin", "symbol": "SOXL 2026-07-10 178C",
         "date": "2026-07-02",  # opened_at wins over as_of when present
         "shares": 1.0, "cost_per_share": pytest.approx(1982.0)},
        {"account": "rh-margin", "symbol": "ACN 2028-01-21 250C",
         "date": AS_OF, "shares": 1.0, "cost_per_share": pytest.approx(3600.0)},
    ]
    assert quotes["SOXL 2026-07-10 178C"] == {
        "name": "SOXL $178 Call 2026-07-10", "price": pytest.approx(2195.0),
        "day_pct": 0, "asset_class": "options",
    }
    # no mark -> valued at cost (honest staleness), warned
    assert quotes["ACN 2028-01-21 250C"]["price"] == pytest.approx(3600.0)
    assert any("no mark" in w for w in warnings)
    # short skipped with ONE loud warning naming the contract
    assert "SOXS 2026-07-10 7.5P" not in quotes
    loud = [w for w in warnings if "SKIPPED SHORT" in w]
    assert len(loud) == 1 and "SOXS 2026-07-10 7.5P" in loud[0]
    assert value == pytest.approx(2195.0 + 3600.0)


def test_option_without_symbol_is_skipped_with_warning():
    broken = [{"underlying": "ACN", "expiration": "2028-01-21", "strike": None,
               "option_type": None, "position_type": "long", "contracts": 1.0,
               "avg_price": 36.0, "multiplier": 100.0,
               "instrument_id": "id-x", "occ_symbol": None}]
    lots, quotes, warnings, value = option_lots_and_quotes(broken, "a", AS_OF)
    assert lots == [] and quotes == {} and value == 0
    assert any("strike/type lookup failed" in w for w in warnings)


# ------------------------------------------------------------- sleeves

PORTFOLIO = {  # live get_portfolio shape (margin account, 2026-07-05)
    "total_value": "66457.056874194295036",
    "equity_value": "1922.1247201",
    "options_value": "32670",
    "futures_value": "318.5",
    "event_contracts_value": "0",
    "crypto_value": "20723.172154094295036",
    "cash": "10823.26",
    "currency": "USD",
}


def test_sleeve_lots_from_portfolio_values():
    lots, quotes, warnings, value = sleeve_lots_and_quotes(
        PORTFOLIO, "rh-margin", AS_OF)
    by_sym = {l["symbol"]: l for l in lots}
    assert by_sym["CRYPTO"]["shares"] == pytest.approx(20723.17)
    assert by_sym["CRYPTO"]["cost_per_share"] == 1
    assert by_sym["FUTURES"]["shares"] == pytest.approx(318.5)
    assert quotes["CRYPTO"]["asset_class"] == "crypto"
    assert quotes["FUTURES"]["asset_class"] == "other"
    assert quotes["CRYPTO"]["price"] == 1
    assert value == pytest.approx(20723.17 + 318.5)


def test_zero_sleeves_book_nothing():
    lots, quotes, warnings, value = sleeve_lots_and_quotes(
        {"total_value": "10", "crypto_value": "0", "futures_value": None},
        "a", AS_OF)
    assert lots == [] and quotes == {} and value == 0


# ------------------------------------------------- breakout CASH math

def test_cash_remainder_subtracts_options_and_sleeves():
    positions = [{"symbol": "NVDA", "shares": 10, "avg_cost": 100.0,
                  "current_price": 194.83}]
    lot, warnings = api_cash_lot(
        {"total_value": "66457.05"}, positions, "rh-margin", AS_OF,
        options_value=5795.0, sleeves_value=21041.67)
    # 66457.05 - 1948.30 - 5795.00 - 21041.67
    assert lot["shares"] == pytest.approx(37672.08)
    assert any("options marks" in w for w in warnings)


def test_cash_lot_back_compat_signature_unchanged():
    lot, warnings = api_cash_lot({"total_value": 5205.71}, [], "rh-main", AS_OF)
    assert lot["shares"] == pytest.approx(5205.71)
    assert any("CASH 5,205.71" in w for w in warnings)


# --------------------------------------------------- quotes.json writer

def test_update_quotes_file_upserts_and_preserves(tmp_path):
    (tmp_path / "quotes.json").write_text(json.dumps({
        "as_of": "2026-07-05T09:30:00-04:00",
        "quotes": {"VOO": {"name": "V", "price": 683.2, "day_pct": -0.12,
                           "asset_class": "usEquity"}},
    }), encoding="utf-8")
    update_quotes_file(tmp_path, {
        "SOXL 2026-07-10 178C": {"name": "SOXL $178 Call 2026-07-10",
                                 "price": 2195.0, "day_pct": 0,
                                 "asset_class": "options"},
    })
    data = json.loads((tmp_path / "quotes.json").read_text())
    assert data["as_of"] == "2026-07-05T09:30:00-04:00"  # preserved
    assert data["quotes"]["VOO"]["price"] == 683.2       # preserved
    assert data["quotes"]["SOXL 2026-07-10 178C"]["asset_class"] == "options"
    # and the FixtureQuoteProvider actually serves the upserted mark
    from vantage_server.quotes import FixtureQuoteProvider
    snap = FixtureQuoteProvider(tmp_path).snapshot()
    assert snap.quotes["SOXL 2026-07-10 178C"].price == pytest.approx(2195.0)


def test_update_quotes_file_creates_skeleton_when_missing(tmp_path):
    import datetime as dt
    update_quotes_file(tmp_path, {"CRYPTO": {"name": "c", "price": 1,
                                             "day_pct": 0, "asset_class": "crypto"}},
                       now=dt.datetime(2026, 7, 5, 12, 0, 0))
    data = json.loads((tmp_path / "quotes.json").read_text())
    assert data["as_of"] == "2026-07-05T12:00:00"
    assert data["quotes"]["CRYPTO"]["asset_class"] == "crypto"


# ----------------------------------------------------- history writer

ROWS_A = [
    {"account": "rh-margin", "broker_account": "...9024",
     "date": "2026-07-02T19:40:00Z", "kind": "option",
     "symbol": "SPXW 2026-07-02 7465C", "description": "d", "side": "buy",
     "quantity": 1.0, "price": 1.72, "amount": -172.0, "state": "filled"},
]
ROWS_B = [
    {"account": "rh-main", "broker_account": "...0427",
     "date": "2026-07-03T10:00:00Z", "kind": "equity", "symbol": "VOO",
     "description": "d", "side": "buy", "quantity": 1.0, "price": 683.0,
     "amount": -683.0, "state": "filled"},
]


def test_write_history_merges_by_account_with_backup(tmp_path):
    import datetime as dt
    path, backup = write_history(tmp_path, "rh-margin", ROWS_A)
    assert backup is None and json.loads(path.read_text()) == ROWS_A
    # second account merges in, newest first
    path, backup = write_history(tmp_path, "rh-main", ROWS_B,
                                 now=dt.datetime(2026, 7, 5, 12, 0, 0))
    assert backup is not None and backup.name == "history.json.bak-2026-07-05T12-00-00"
    merged = json.loads(path.read_text())
    assert [r["account"] for r in merged] == ["rh-main", "rh-margin"]
    # re-importing rh-margin REPLACES only its rows
    replacement = [dict(ROWS_A[0], date="2026-07-04T09:00:00Z")]
    path, _ = write_history(tmp_path, "rh-margin", replacement)
    merged = json.loads(path.read_text())
    assert len(merged) == 2
    assert merged[0]["date"] == "2026-07-04T09:00:00Z"  # replaced + resorted


# --------------------------------------------------------- CLI flows

STUB_POSITIONS = [
    {"symbol": "NVDA", "shares": 10.0, "avg_cost": 100.0, "current_price": 194.83},
]


@pytest.fixture
def workdir(tmp_path, data_dir):
    """A writable copy of the fixture data dir (same as test_importer)."""
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    return tmp_path


@pytest.fixture
def stub_connection(monkeypatch):
    monkeypatch.setattr(robinhood, "fetch_positions", lambda acct: STUB_POSITIONS)
    monkeypatch.setattr(robinhood, "fetch_option_positions",
                        lambda acct: [dict(o) for o in NORMALIZED_OPTIONS])
    monkeypatch.setattr(robinhood, "fetch_portfolio", lambda acct: dict(PORTFOLIO))
    monkeypatch.setattr(robinhood, "fetch_history",
                        lambda acct, limit=200: [dict(r, account="") for r in ROWS_A])
    monkeypatch.setattr(robinhood, "fetch_option_orders",
                        lambda acct, limit=200: [dict(o) for o in CANNED_OPTION_ORDERS["orders"]])


def run_cli(workdir, *args):
    return importer.main(["--data-dir", str(workdir), "--broker", "robinhood",
                          "--account", "rh-margin", "--broker-account", "532189024",
                          "--as-of", AS_OF,
                          "--add-account", "rh-margin,Robinhood Margin,RHM,brokerage,true",
                          *args])


def test_cli_breakout_books_options_sleeves_and_cash(workdir, stub_connection, capsys):
    assert run_cli(workdir, "--breakout") == EXIT_OK
    err = capsys.readouterr().err
    assert "SKIPPED SHORT" in err and "SOXS 2026-07-10 7.5P" in err

    lots = json.loads((workdir / "lots.json").read_text())
    rh = {l["symbol"]: l for l in lots if l["account"] == "rh-margin"}
    assert set(rh) == {"NVDA", "SOXL 2026-07-10 178C", "ACN 2028-01-21 250C",
                       "CRYPTO", "FUTURES", "CASH"}
    assert rh["SOXL 2026-07-10 178C"]["cost_per_share"] == pytest.approx(1982.0)
    assert rh["SOXL 2026-07-10 178C"]["shares"] == 1.0
    # CASH remainder: total - equity - option marks - sleeves
    expected_cash = round(66457.06 - 1948.30 - 5795.0 - (20723.17 + 318.5), 2)
    assert rh["CASH"]["shares"] == pytest.approx(expected_cash, abs=0.02)

    quotes = json.loads((workdir / "quotes.json").read_text())["quotes"]
    assert quotes["SOXL 2026-07-10 178C"]["price"] == pytest.approx(2195.0)
    assert quotes["SOXL 2026-07-10 178C"]["asset_class"] == "options"
    assert quotes["CRYPTO"]["asset_class"] == "crypto"
    assert quotes["FUTURES"]["asset_class"] == "other"
    assert quotes["VOO"]["price"] == pytest.approx(683.20)  # untouched

    # the whole written dataset loads, values at marks, and allocation
    # tolerates the new classes end to end
    from vantage_server.quotes import FixtureQuoteProvider
    from vantage_server.store import Store
    from vantage_server import engine
    ds = Store(workdir).load_dataset()
    snap = FixtureQuoteProvider(workdir).snapshot()
    alloc = engine.allocation(ds.lots, snap.quotes, "rh-margin")
    assert alloc.by_class["options"] == pytest.approx(2195.0 + 3600.0)
    assert alloc.by_class["crypto"] == pytest.approx(20723.17)
    assert alloc.by_class["other"] == pytest.approx(318.5)
    assert alloc.total == pytest.approx(66457.06, abs=0.02)


def test_cli_breakout_with_history_single_run(workdir, stub_connection):
    assert run_cli(workdir, "--breakout", "--with-history") == EXIT_OK
    history = json.loads((workdir / "history.json").read_text())
    assert len(history) == 1
    assert history[0]["account"] == "rh-margin"  # importer fills the id
    assert history[0]["broker_account"] == "...9024"


def test_cli_dry_run_breakout_writes_nothing(workdir, stub_connection, capsys):
    before_quotes = (workdir / "quotes.json").read_text()
    before_lots = (workdir / "lots.json").read_text()
    assert run_cli(workdir, "--breakout", "--with-history", "--dry-run") == EXIT_OK
    out = capsys.readouterr().out
    assert "DRY RUN" in out and "nothing written" in out
    assert "quote entrie" in out and "history row" in out
    assert (workdir / "quotes.json").read_text() == before_quotes
    assert (workdir / "lots.json").read_text() == before_lots
    assert not (workdir / "history.json").exists()


def test_cli_include_cash_alone_keeps_old_behavior(workdir, stub_connection):
    assert run_cli(workdir, "--include-cash") == EXIT_OK
    lots = json.loads((workdir / "lots.json").read_text())
    rh = {l["symbol"]: l for l in lots if l["account"] == "rh-margin"}
    assert set(rh) == {"NVDA", "CASH"}  # no options/sleeves without --breakout
    # old math: total - equity only
    assert rh["CASH"]["shares"] == pytest.approx(66457.06 - 1948.30, abs=0.02)
    quotes = json.loads((workdir / "quotes.json").read_text())["quotes"]
    assert "CRYPTO" not in quotes


def test_breakout_rejected_for_csv_brokers(tmp_path, capsys):
    csv = tmp_path / "x.csv"
    csv.write_text("account,symbol,date,shares,costPerShare\n")
    rc = importer.main([str(csv), "--broker", "generic", "--breakout"])
    assert rc == EXIT_USER_ERROR
    assert "only valid with an API broker" in capsys.readouterr().err


def test_with_history_rejected_for_csv_brokers(tmp_path, capsys):
    csv = tmp_path / "x.csv"
    csv.write_text("account,symbol,date,shares,costPerShare\n")
    rc = importer.main([str(csv), "--broker", "generic", "--with-history",
                        "--account", "a"])
    assert rc == EXIT_USER_ERROR
    assert "only valid with an API broker" in capsys.readouterr().err


# ------------------------------------------- fetch_option_orders (broker)

def test_fetch_option_orders_returns_raw_unwrapped_newest_first(monkeypatch):
    monkeypatch.setattr(robinhood, "_call", _fake_history_call)
    orders = robinhood.fetch_option_orders("532189024")
    # raw order dicts (legs intact), NOT flattened history rows
    assert all("legs" in o for o in orders)
    assert [o["id"] for o in orders][:1] == ["oo-1"]  # newest first (2026-07-02)
    spread = next(o for o in orders if o["id"] == "oo-1")
    assert spread["chain_symbol"] == "SPXW"
    assert len(spread["legs"]) == 2  # spread kept as ONE order, not split


# ------------------------------------------------- --with-strategies (CLI)

def test_cli_with_strategies_writes_rollup(workdir, stub_connection):
    assert run_cli(workdir, "--with-strategies") == EXIT_OK
    data = json.loads((workdir / "strategies.json").read_text())
    assert set(data) == {"open", "closed", "as_of"}
    assert data["as_of"] == AS_OF
    # OPEN: shorts INCLUDED (contrast the lots view which skips them)
    opens = {(s["underlying"], s["expiration"]): s for s in data["open"]}
    assert ("SOXS", "2026-07-10") in opens  # the short IS here
    assert opens[("SOXS", "2026-07-10")]["legs"][0]["position_type"] == "short"
    assert all(s["account"] == "rh-margin" for s in data["open"])
    # CLOSED: one row per order, tagged with the vantage account for merge
    assert len(data["closed"]) == len(CANNED_OPTION_ORDERS["orders"])
    assert all(r["_vantage_account"] == "rh-margin" for r in data["closed"])


def test_breakout_implies_strategies(workdir, stub_connection):
    assert run_cli(workdir, "--breakout") == EXIT_OK
    assert (workdir / "strategies.json").exists()
    data = json.loads((workdir / "strategies.json").read_text())
    assert data["open"] and data["closed"]


def test_cli_dry_run_strategies_writes_nothing(workdir, stub_connection, capsys):
    assert run_cli(workdir, "--with-strategies", "--dry-run") == EXIT_OK
    out = capsys.readouterr().out
    assert "strateg" in out and "nothing written" in out
    assert not (workdir / "strategies.json").exists()


def test_strategies_merge_keeps_other_accounts(workdir, stub_connection):
    # seed a strategies.json for a different account; the import must keep it
    (workdir / "strategies.json").write_text(json.dumps({
        "open": [{"underlying": "ZZZ", "expiration": "2026-09-18",
                  "account": "other-acct", "kind": "single", "name": "long call"}],
        "closed": [{"order_id": "old", "_vantage_account": "other-acct"}],
        "as_of": "2026-01-01",
    }), encoding="utf-8")
    assert run_cli(workdir, "--with-strategies") == EXIT_OK
    data = json.loads((workdir / "strategies.json").read_text())
    accts = {s["account"] for s in data["open"]}
    assert accts == {"rh-margin", "other-acct"}  # other kept, backup made
    assert any(p.name.startswith("strategies.json.bak-")
               for p in workdir.iterdir())


def test_with_strategies_rejected_for_csv_brokers(tmp_path, capsys):
    csv = tmp_path / "x.csv"
    csv.write_text("account,symbol,date,shares,costPerShare\n")
    rc = importer.main([str(csv), "--broker", "generic", "--with-strategies",
                        "--account", "a"])
    assert rc == EXIT_USER_ERROR
    assert "only valid with an API broker" in capsys.readouterr().err
