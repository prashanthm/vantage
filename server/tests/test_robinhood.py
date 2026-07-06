"""Robinhood read-only sync: allowlist refusal (the ADR-010 hard guarantee),
payload normalization, synthetic-lot conversion through the importer with a
stubbed client, token-file resolution order, and the auth module's atomic
0600 save + stubbed refresh flow. Fully offline and deterministic — no
network, no mcp dependency, no real token file is ever read."""
from __future__ import annotations

import json
import stat
import time

import pytest

from vantage_server import importer
from vantage_server.importer import (
    EXIT_OK,
    EXIT_USER_ERROR,
    robinhood_positions_to_lots,
)
from vantage_server.brokers import robinhood, robinhood_auth
from vantage_server.brokers.robinhood import (
    READ_TOOLS,
    ReadOnlyViolation,
    RobinhoodError,
    _resolve_tool,
    _unwrap,
)

AS_OF = "2026-07-05"


# --------------------------------------------------- read-only allowlist

@pytest.mark.parametrize("tool", [
    "place_equity_order",
    "review_equity_order",
    "cancel_equity_order",
    "place_option_order",
    "cancel_option_order",
    "add_option_to_watchlist",   # even non-trading mutations are refused
    "transfer_funds",
    "",
])
def test_call_refuses_tools_outside_allowlist(tool):
    with pytest.raises(ReadOnlyViolation, match="ADR-010"):
        robinhood._call(tool, {"account_number": "X"})


def test_allowlist_is_exactly_the_read_tools():
    assert READ_TOOLS == frozenset({
        "get_accounts",
        "get_portfolio",
        "get_equity_positions",
        "get_equity_quotes",
        # options breakout + transaction history (all read-only listings)
        "get_option_positions",
        "get_option_instruments",
        "get_option_quotes",
        "get_equity_orders",
        "get_option_orders",
        # EOD OHLCV bars for the technical-analysis engine (read-only)
        "get_equity_historicals",
        # per-close realized-gain history — the authoritative win/loss label
        # for round-trip reconstruction (read-only)
        "get_pnl_trade_history",
    })
    # frozenset: nobody can .add() a mutating tool at runtime
    with pytest.raises(AttributeError):
        READ_TOOLS.add("place_equity_order")


def test_refusal_happens_before_any_network_or_mcp_import(monkeypatch):
    """The allowlist check must precede token lookup / mcp import — the
    refusal path needs neither credentials nor the optional dependency."""
    def boom(*a, **k):  # pragma: no cover - would only run on regression
        raise AssertionError("network path reached for a refused tool")
    monkeypatch.setattr(robinhood, "_acall", boom)
    monkeypatch.setattr(robinhood, "_require_mcp", boom)
    with pytest.raises(ReadOnlyViolation):
        robinhood._call("place_equity_order", {})


def test_missing_mcp_dependency_gives_install_hint(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def no_mcp(name, *args, **kwargs):
        if name == "mcp" or name.startswith("mcp."):
            raise ImportError(f"No module named '{name}'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_mcp)
    with pytest.raises(RobinhoodError, match=r'\[robinhood\]'):
        robinhood._require_mcp()


# ------------------------------------------------------- payload parsing

def test_unwrap_data_envelope_shapes():
    assert _unwrap({"data": {"positions": []}, "guide": "ignore me"}) == {"positions": []}
    assert _unwrap({"data": [1, 2]}) == {"results": [1, 2]}
    assert _unwrap({"positions": []}) == {"positions": []}  # already bare


def test_resolve_tool_tolerates_namespace_prefixes():
    tools = {"mcp__robinhood-trading__get_equity_positions", "get_portfolio"}
    assert _resolve_tool("get_portfolio", tools) == "get_portfolio"
    assert (_resolve_tool("get_equity_positions", tools)
            == "mcp__robinhood-trading__get_equity_positions")
    with pytest.raises(RobinhoodError, match="not found"):
        _resolve_tool("get_equity_quotes", tools)


CANNED_POSITIONS = {  # realistic get_equity_positions shape (post-_unwrap)
    "positions": [
        {"symbol": "VOO", "quantity": "12", "average_buy_price": "512.3400"},
        {"ticker": "nvda", "quantity": 60.0, "average_buy_price": 121.40,
         "current_price": "194.83"},
        {"symbol": "SOLD", "quantity": "0", "average_buy_price": "10.00"},
        {"symbol": "WEIRD", "quantity": "3"},  # no average_buy_price
        {"not_a": "position"},  # no symbol at all — dropped
    ]
}


def test_fetch_positions_normalizes_canned_payload(monkeypatch):
    calls = []

    def fake_call(tool, payload):
        calls.append((tool, payload))
        return CANNED_POSITIONS

    monkeypatch.setattr(robinhood, "_call", fake_call)
    positions = robinhood.fetch_positions("123456789")
    assert calls == [("get_equity_positions", {"account_number": "123456789"})]
    assert positions == [
        {"symbol": "VOO", "shares": 12.0, "avg_cost": 512.34},
        {"symbol": "NVDA", "shares": 60.0, "avg_cost": 121.40, "current_price": 194.83},
        {"symbol": "SOLD", "shares": 0.0, "avg_cost": 10.0},
        {"symbol": "WEIRD", "shares": 3.0, "avg_cost": 0.0},
    ]


def test_fetch_positions_accepts_results_key(monkeypatch):
    monkeypatch.setattr(robinhood, "_call", lambda t, p: {
        "results": [{"symbol": "IWM", "quantity": "5", "average_buy_price": "200.1"}]
    })
    assert robinhood.fetch_positions("X") == [
        {"symbol": "IWM", "shares": 5.0, "avg_cost": 200.1}
    ]


def test_fetch_portfolio_requires_an_account_value(monkeypatch):
    monkeypatch.setattr(robinhood, "_call", lambda t, p: {"total_value": "5432.10"})
    assert robinhood.fetch_portfolio("X")["total_value"] == "5432.10"
    monkeypatch.setattr(robinhood, "_call", lambda t, p: {"buying_power": "1.00"})
    with pytest.raises(RobinhoodError, match="Account value missing"):
        robinhood.fetch_portfolio("X")


# -------------------------------------------------- historicals (OHLCV bars)

# Realistic get_equity_historicals shape (post-_unwrap), out of chronological
# order to prove the normalizer sorts oldest->newest.
CANNED_HISTORICALS = {
    "results": [
        {
            "symbol": "PLTR",
            "interval": "day",
            "bounds": "regular",
            "bars": [
                {"begins_at": "2026-06-10T00:00:00Z", "open_price": "129.325000",
                 "high_price": "133.185000", "low_price": "128.800000",
                 "close_price": "130.210000", "volume": 30612640, "session": "reg"},
                {"begins_at": "2026-06-08T00:00:00Z", "open_price": "135.680000",
                 "high_price": "137.760000", "low_price": "135.280000",
                 "close_price": "136.470000", "volume": 26978870, "session": "reg"},
                {"begins_at": "2026-06-09T00:00:00Z", "open_price": "134.870000",
                 "high_price": "136.990000", "low_price": "127.350000",
                 "close_price": "132.070000", "volume": 38679990, "session": "reg"},
                {"begins_at": "", "open_price": "1", "high_price": "1",
                 "low_price": "1", "close_price": "1", "volume": 0},  # no date -> dropped
                {"begins_at": "2026-06-11T00:00:00Z", "open_price": "128.780000",
                 "high_price": "131.520000", "low_price": "127.170000",
                 "close_price": None, "volume": 27554474},  # missing close -> dropped
            ],
        }
    ]
}


def test_fetch_historicals_normalizes_and_sorts(monkeypatch):
    calls = []

    def fake_call(tool, payload):
        calls.append((tool, payload))
        return CANNED_HISTORICALS

    monkeypatch.setattr(robinhood, "_call", fake_call)
    bars = robinhood.fetch_historicals("pltr", start_time="2026-06-01T00:00:00Z")
    assert calls == [("get_equity_historicals",
                      {"symbols": ["PLTR"], "start_time": "2026-06-01T00:00:00Z",
                       "interval": "day"})]
    # oldest -> newest; the empty-date and missing-close bars are dropped
    assert [b["date"] for b in bars] == [
        "2026-06-08T00:00:00Z", "2026-06-09T00:00:00Z", "2026-06-10T00:00:00Z"]
    assert bars[0] == {"date": "2026-06-08T00:00:00Z", "open": 135.68,
                       "high": 137.76, "low": 135.28, "close": 136.47,
                       "volume": 26978870}
    assert all(isinstance(b["volume"], int) for b in bars)


def test_fetch_historicals_passes_end_time_and_interval(monkeypatch):
    calls = []
    monkeypatch.setattr(robinhood, "_call",
                        lambda t, p: calls.append(p) or {"results": []})
    robinhood.fetch_historicals("SNK", start_time="2026-01-01T00:00:00Z",
                                end_time="2026-06-01T00:00:00Z", interval="week")
    assert calls[0] == {"symbols": ["SNK"], "start_time": "2026-01-01T00:00:00Z",
                        "interval": "week", "end_time": "2026-06-01T00:00:00Z"}


def test_fetch_historicals_batch_matches_by_symbol(monkeypatch):
    payload = {"results": [
        {"symbol": "AAA", "bars": [
            {"begins_at": "2026-06-08T00:00:00Z", "open_price": "1", "high_price": "2",
             "low_price": "1", "close_price": "1.5", "volume": 10}]},
        {"symbol": "BBB", "bars": [
            {"begins_at": "2026-06-08T00:00:00Z", "open_price": "5", "high_price": "6",
             "low_price": "4", "close_price": "5.5", "volume": 20}]},
    ]}
    monkeypatch.setattr(robinhood, "_call", lambda t, p: payload)
    out = robinhood.fetch_historicals_batch(["aaa", "bbb"],
                                            start_time="2026-06-01T00:00:00Z")
    assert set(out) == {"AAA", "BBB"}
    assert out["AAA"][0]["close"] == 1.5
    assert out["BBB"][0]["close"] == 5.5


# ------------------------------------------------- synthetic-lot conversion

def test_positions_to_lots_one_synthetic_lot_per_position():
    positions = [
        {"symbol": "VOO", "shares": 12.0, "avg_cost": 512.34},
        {"symbol": "NVDA", "shares": 60.0, "avg_cost": 121.40, "current_price": 194.83},
    ]
    lots, warnings = robinhood_positions_to_lots(positions, "rh-main", AS_OF)
    assert warnings == []
    assert lots == [
        {"account": "rh-main", "symbol": "VOO", "date": AS_OF,
         "shares": 12.0, "cost_per_share": 512.34},
        {"account": "rh-main", "symbol": "NVDA", "date": AS_OF,
         "shares": 60.0, "cost_per_share": 121.40},
    ]


def test_positions_to_lots_skips_zero_shares_and_collects_warnings():
    positions = [
        {"symbol": "SOLD", "shares": 0.0, "avg_cost": 10.0},
        {"symbol": "SHORT", "shares": -3.0, "avg_cost": 10.0},
        {"symbol": "", "shares": 1.0, "avg_cost": 10.0},
        {"symbol": "FREE", "shares": 2.0, "avg_cost": 0.0},  # kept, warned
        {"symbol": "OK", "shares": 1.0, "avg_cost": 5.0},
    ]
    lots, warnings = robinhood_positions_to_lots(positions, "rh-main", AS_OF)
    assert [l["symbol"] for l in lots] == ["FREE", "OK"]
    joined = " ".join(warnings)
    assert "SOLD" in joined and "SHORT" in joined and "no symbol" in joined
    assert any("FREE" in w and "0" in w for w in warnings)


# --------------------------------------------------- importer integration

STUB_POSITIONS = [
    {"symbol": "VOO", "shares": 12.0, "avg_cost": 512.34},
    {"symbol": "NVDA", "shares": 60.0, "avg_cost": 121.40},
    {"symbol": "SOLD", "shares": 0.0, "avg_cost": 10.0},
]


@pytest.fixture
def workdir(tmp_path, data_dir):
    """A writable copy of the fixture data dir (same as test_importer)."""
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    return tmp_path


@pytest.fixture
def stub_positions(monkeypatch):
    monkeypatch.setattr(robinhood, "fetch_positions", lambda acct: STUB_POSITIONS)


def run_cli(workdir, *args):
    return importer.main(["--data-dir", str(workdir), "--broker", "robinhood", *args])


def read_lots(workdir):
    return json.loads((workdir / "lots.json").read_text(encoding="utf-8"))


def test_sync_merges_synthetic_lots_into_new_account(workdir, stub_positions):
    rc = run_cli(workdir, "--account", "rh-main", "--rh-account", "123456789",
                 "--as-of", AS_OF,
                 "--add-account", "rh-main,Robinhood,RH,brokerage,true")
    assert rc == EXIT_OK
    lots = read_lots(workdir)
    rh = [l for l in lots if l["account"] == "rh-main"]
    assert [(l["symbol"], l["shares"], l["cost_per_share"], l["date"]) for l in rh] == [
        ("VOO", 12.0, 512.34, AS_OF),
        ("NVDA", 60.0, 121.40, AS_OF),
    ]
    assert len([l for l in lots if l["account"] != "rh-main"]) == 18  # others kept
    from vantage_server.store import Store
    Store(workdir).load_dataset()  # written files pass full store validation


def test_sync_defaults_as_of_to_today(workdir, stub_positions):
    import datetime as dt
    run_cli(workdir, "--account", "fid-taxable", "--rh-account", "123456789")
    rh = [l for l in read_lots(workdir) if l["account"] == "fid-taxable"]
    assert all(l["date"] == dt.date.today().isoformat() for l in rh)


def test_dry_run_writes_nothing(workdir, stub_positions, capsys):
    before = (workdir / "lots.json").read_text()
    rc = run_cli(workdir, "--account", "fid-taxable", "--rh-account", "123456789",
                 "--as-of", AS_OF, "--dry-run")
    assert rc == EXIT_OK
    captured = capsys.readouterr()
    assert "DRY RUN" in captured.out and "VOO" in captured.out
    assert "nothing written" in captured.out
    assert "Robinhood account ...6789" in captured.out  # never the full number
    assert "SOLD" in captured.err  # zero-share row warned on stderr
    assert (workdir / "lots.json").read_text() == before
    assert list(workdir.glob("lots.json.bak-*")) == []


def test_unknown_vantage_account_exits_2(workdir, stub_positions, capsys):
    rc = run_cli(workdir, "--account", "rh-main", "--rh-account", "123456789",
                 "--as-of", AS_OF)
    assert rc == EXIT_USER_ERROR
    err = capsys.readouterr().err
    assert "rh-main" in err and "add the account first" in err
    assert len(read_lots(workdir)) == 18  # nothing written


def test_missing_flags_exit_2(workdir, capsys):
    assert run_cli(workdir, "--rh-account", "123456789") == EXIT_USER_ERROR
    assert "--account is required" in capsys.readouterr().err
    assert run_cli(workdir, "--account", "fid-taxable") == EXIT_USER_ERROR
    assert "--rh-account is required" in capsys.readouterr().err


def test_csv_file_rejected_for_robinhood(workdir, capsys):
    rc = importer.main([str(workdir / "positions.csv"), "--data-dir", str(workdir),
                        "--broker", "robinhood",
                        "--account", "fid-taxable", "--rh-account", "1"])
    assert rc == EXIT_USER_ERROR
    assert "do not pass a CSV file" in capsys.readouterr().err


def test_auth_error_reported_cleanly_exit_2(workdir, monkeypatch, capsys):
    def boom(acct):
        raise robinhood.AuthError("Token refresh failed (400): invalid_grant")
    monkeypatch.setattr(robinhood, "fetch_positions", boom)
    rc = run_cli(workdir, "--account", "fid-taxable", "--rh-account", "123456789")
    assert rc == EXIT_USER_ERROR
    assert "invalid_grant" in capsys.readouterr().err


def test_auth_flag_runs_browser_flow_and_exits(monkeypatch):
    ran = []
    monkeypatch.setattr(robinhood_auth, "interactive_login", lambda: ran.append(True))
    assert importer.main(["--broker", "robinhood", "--auth"]) == EXIT_OK
    assert ran == [True]


def test_auth_flag_requires_robinhood_broker(tmp_path, capsys):
    csv = tmp_path / "x.csv"
    csv.write_text("symbol,date,shares,costPerShare\n")
    rc = importer.main([str(csv), "--broker", "generic", "--auth"])
    assert rc == EXIT_USER_ERROR
    assert "--auth is only valid" in capsys.readouterr().err


# --------------------------------------------------- token-file resolution

def test_token_file_env_override_wins(tmp_path, monkeypatch):
    override = tmp_path / "tok.json"
    monkeypatch.setenv(robinhood_auth.ENV_TOKEN_FILE, str(override))
    monkeypatch.setenv("HOME", str(tmp_path))  # even with a sentinel grant present
    sentinel = tmp_path / "personal" / "sentinel" / ".robinhood_token.json"
    sentinel.parent.mkdir(parents=True)
    sentinel.write_text("{}")
    assert robinhood_auth.token_file() == override


def test_token_file_prefers_existing_sentinel_grant(tmp_path, monkeypatch):
    monkeypatch.delenv(robinhood_auth.ENV_TOKEN_FILE, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    sentinel = tmp_path / "personal" / "sentinel" / ".robinhood_token.json"
    sentinel.parent.mkdir(parents=True)
    sentinel.write_text("{}")
    assert robinhood_auth.token_file() == sentinel


def test_token_file_falls_back_to_server_default(tmp_path, monkeypatch):
    monkeypatch.delenv(robinhood_auth.ENV_TOKEN_FILE, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))  # no sentinel grant under this home
    assert robinhood_auth.token_file() == robinhood_auth._SERVER_DEFAULT_TOKEN
    assert robinhood_auth.token_file().name == ".robinhood_token.json"
    assert robinhood_auth.token_file().parent.name == "server"


# ------------------------------------------------------------ auth module

@pytest.fixture
def token_path(tmp_path, monkeypatch):
    path = tmp_path / ".robinhood_token.json"
    monkeypatch.setenv(robinhood_auth.ENV_TOKEN_FILE, str(path))
    return path


def test_save_store_is_atomic_with_0600_perms(token_path):
    robinhood_auth._save_store({"access_token": "secret", "refresh_token": "r"})
    mode = stat.S_IMODE(token_path.stat().st_mode)
    assert mode == 0o600
    assert json.loads(token_path.read_text())["access_token"] == "secret"
    assert not token_path.with_name(token_path.name + ".tmp").exists()  # replaced, not left


def test_get_access_token_returns_fresh_token_without_refresh(token_path, monkeypatch):
    token_path.write_text(json.dumps({
        "access_token": "fresh", "refresh_token": "r",
        "client_id": "c", "token_endpoint": "https://rh.example/token",
        "expires_at": time.time() + 3600,
    }))
    monkeypatch.setattr(robinhood_auth, "_http_post",
                        lambda *a, **k: pytest.fail("refresh attempted for a fresh token"))
    assert robinhood_auth.get_access_token() == "fresh"


def test_get_access_token_refreshes_expired_token(token_path, monkeypatch):
    token_path.write_text(json.dumps({
        "access_token": "stale", "refresh_token": "old-refresh",
        "client_id": "client-1", "token_endpoint": "https://rh.example/token",
        "expires_at": time.time() - 10,
    }))
    posts = []

    def fake_post(url, *, form=None, json_body=None, timeout=15.0):
        posts.append((url, form))
        return 200, json.dumps({
            "access_token": "renewed", "refresh_token": "rotated", "expires_in": 3600,
        })

    monkeypatch.setattr(robinhood_auth, "_http_post", fake_post)
    assert robinhood_auth.get_access_token() == "renewed"
    (url, form), = posts
    assert url == "https://rh.example/token"
    assert form["grant_type"] == "refresh_token"
    assert form["refresh_token"] == "old-refresh"
    saved = json.loads(token_path.read_text())
    assert saved["access_token"] == "renewed"
    assert saved["refresh_token"] == "rotated"  # server rotation honored
    assert saved["expires_at"] > time.time()
    assert stat.S_IMODE(token_path.stat().st_mode) == 0o600


def test_failed_refresh_raises_autherror_with_auth_hint(token_path, monkeypatch):
    token_path.write_text(json.dumps({
        "access_token": "stale", "refresh_token": "revoked",
        "client_id": "c", "token_endpoint": "https://rh.example/token",
        "expires_at": 0,
    }))
    monkeypatch.setattr(robinhood_auth, "_http_post",
                        lambda *a, **k: (400, '{"error":"invalid_grant"}'))
    with pytest.raises(robinhood_auth.AuthError, match="--auth"):
        robinhood_auth.get_access_token()
    # the revoked token was NOT overwritten by a failed refresh
    assert json.loads(token_path.read_text())["access_token"] == "stale"


def test_missing_token_file_raises_autherror(token_path):
    with pytest.raises(robinhood_auth.AuthError, match="--auth"):
        robinhood_auth.get_access_token()


# ---------------------------------------------------------------- cash lot

from vantage_server.importer import robinhood_cash_lot


def test_cash_lot_books_non_equity_value():
    portfolio = {"total_value": 5205.71, "buying_power": 9.63}
    lot, warnings = robinhood_cash_lot(portfolio, [], "rh-main", "2026-07-05")
    assert lot == {
        "account": "rh-main", "symbol": "CASH", "date": "2026-07-05",
        "shares": 5205.71, "cost_per_share": 1,
    }
    assert any("CASH 5,205.71" in w for w in warnings)


def test_cash_lot_subtracts_equity_value():
    portfolio = {"total_value": 10000.0}
    positions = [{"symbol": "SPY", "shares": 10, "avg_cost": 700.0, "current_price": 750.0}]
    lot, _ = robinhood_cash_lot(portfolio, positions, "rh-main", "2026-07-05")
    assert lot["shares"] == 2500.0  # 10000 - 10*750


def test_cash_lot_values_at_cost_when_no_price():
    portfolio = {"total_value": 10000.0}
    positions = [{"symbol": "SPY", "shares": 10, "avg_cost": 700.0}]
    lot, warnings = robinhood_cash_lot(portfolio, positions, "rh-main", "2026-07-05")
    assert lot["shares"] == 3000.0  # 10000 - 10*700
    assert any("no current price" in w for w in warnings)


def test_cash_lot_none_when_fully_invested_or_missing_total():
    assert robinhood_cash_lot({"total_value": 7500.0},
                              [{"symbol": "SPY", "shares": 10, "avg_cost": 700.0,
                                "current_price": 750.0}],
                              "rh-main", "2026-07-05")[0] is None
    lot, warnings = robinhood_cash_lot({}, [], "rh-main", "2026-07-05")
    assert lot is None
    assert any("total_value missing" in w for w in warnings)


# ---------------------------------------------------------------- accounts

def test_list_accounts_normalizes_and_marks_agentic(monkeypatch):
    canned = {"accounts": [
        {"account_number": "532189024", "type": "margin", "is_default": True,
         "agentic_allowed": False, "brokerage_account_type": "individual"},
        {"account_number": "472120427", "type": "cash", "nickname": "Agentic",
         "agentic_allowed": True},
        {"no_account_number": True},
    ]}
    monkeypatch.setattr(robinhood, "_call", lambda tool, payload: canned)
    accounts = robinhood.list_accounts()
    assert [a["account_number"] for a in accounts] == ["532189024", "472120427"]
    assert accounts[0]["is_default"] and not accounts[0]["agentic_allowed"]
    assert accounts[1]["nickname"] == "Agentic" and accounts[1]["agentic_allowed"]


def test_get_accounts_is_allowlisted():
    # The discovery tool must be callable through the read-only dispatcher
    # (no ReadOnlyViolation) — transport errors are fine for this test.
    assert "get_accounts" in READ_TOOLS
