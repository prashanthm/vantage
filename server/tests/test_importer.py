"""Importer CLI: per-broker CSV parsing, merge vs replace, timestamped
backups (injected clock), dry-run write-nothing, zero-lots and unknown-account
aborts, and the --add-account convenience flow. All on tmp data dirs —
the packaged fixture dataset is never touched."""
from __future__ import annotations

import datetime as dt
import json

import pytest

from vantage_server import importer
from vantage_server.importer import (
    EXIT_OK,
    EXIT_USER_ERROR,
    parse_fidelity,
    parse_generic,
    parse_schwab,
    parse_vanguard,
    write_lots,
)
from vantage_server.store import Store

AS_OF = "2026-07-05"

FIDELITY_CSV = """\
Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Cost Basis Total,Average Cost Basis,Type
Z12345678,Individual,VOO,VANGUARD S&P 500 ETF,52,$683.20,-$0.85,"$35,526.40","$41,726.00",$802.42,Cash
Z12345678,Individual,NVDA,NVIDIA CORP,60,$194.83,-$2.75,"$11,689.80","$7,284.00",$121.40,Cash
Z12345678,Individual,SPAXX**,FIDELITY GOVERNMENT MONEY MARKET,6400,$1.00,$0.00,"$6,400.00","$6,400.00",$1.00,Cash
Z12345678,Individual,Pending Activity,,,,,"$120.00",,,
,,,,,,,,,,

"The data and information in this display is for informational purposes only."
"Date downloaded 07/05/2026 9:30 AM ET"
"""

SCHWAB_CSV = """\
"Positions for account Individual ...789 as of 09:30 AM ET, 2026/07/05"

"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Cost Basis"
"IWM","ISHARES RUSSELL 2000 ETF","45","$297.58","$13,391.10","$14,904.00"
"AAPL","APPLE INC","25","$308.63","$7,715.75","$7,227.50"
"Cash & Cash Investments","--","--","--","$1,200.00","--"
"Account Total","--","--","--","$22,306.85","$22,131.50"
"""

VANGUARD_CSV = """\
Account Number,Investment Name,Symbol,Shares,Share Price,Total Value
88888888,Vanguard Total Stock Market ETF,VTI,180,330.45,59481.00
88888888,Vanguard Total Bond Market ETF,BND,300,74.20,22260.00
88888888,Vanguard Federal Money Market Fund,VMFXX,1500,1.00,1500.00

Account Number,Trade Date,Settlement Date,Transaction Type
88888888,2026-06-30,2026-07-01,Buy
"""

GENERIC_CSV = """\
account,symbol,date,shares,costPerShare
fid-taxable,VOO,2025-11-03,40,640.00
fid-taxable,NVDA,2025-08-15,60,121.40
"""

GENERIC_NO_ACCOUNT_CSV = """\
symbol,date,shares,costPerShare
QQQ,2026-01-20,30,598.20
"""


@pytest.fixture
def workdir(tmp_path, data_dir):
    """A writable copy of the fixture data dir."""
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    return tmp_path


def run_cli(workdir, csv_text, *args, filename="export.csv"):
    csv_path = workdir / filename
    csv_path.write_text(csv_text, encoding="utf-8")
    return importer.main([str(csv_path), "--data-dir", str(workdir), *args])


def read_lots(workdir):
    return json.loads((workdir / "lots.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- parsers

def test_parse_fidelity_positions():
    lots, warnings = parse_fidelity(FIDELITY_CSV, "fid-taxable", AS_OF)
    # Positions parse; the SPAXX** money-market core is captured as CASH (its
    # Current Value), not dropped, so the account value isn't understated.
    assert [(l["symbol"], l["shares"], l["cost_per_share"]) for l in lots] == [
        ("VOO", 52.0, 802.42),
        ("NVDA", 60.0, 121.40),
        ("CASH", 6400.0, 1),
    ]
    assert all(l["date"] == AS_OF and l["account"] == "fid-taxable" for l in lots)
    joined = " ".join(warnings)
    assert "core cash" in joined and "Pending" in joined  # cash captured, pending skipped


# Fidelity transaction/history export (activity CSV): buys, sells, and non-trade
# rows (a dividend + an options trade) that must be skipped.
FIDELITY_TXN_CSV = """Run Date,Account,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Amount ($),Settlement Date
01/10/2024,X12345,YOU BOUGHT,VOO,VANGUARD S&P 500 ETF,Cash,10,400.00,0,0,-4000.00,01/12/2024
06/01/2026,X12345,YOU BOUGHT,VOO,VANGUARD S&P 500 ETF,Cash,10,420.00,0,0,-4200.00,06/03/2026
07/01/2026,X12345,YOU SOLD,VOO,VANGUARD S&P 500 ETF,Cash,-15,460.00,0,0,6900.00,07/03/2026
07/02/2026,X12345,DIVIDEND RECEIVED,VOO,VANGUARD S&P 500 ETF,Cash,,,,,12.50,07/02/2026
07/02/2026,X12345,YOU BOUGHT,-SPY260117C500,CALL SPY,Margin,1,5.00,0,0,-500.00,07/02/2026
"""


def test_parse_fidelity_transactions():
    from vantage_server.importer import parse_fidelity_transactions
    rows, warnings = parse_fidelity_transactions(FIDELITY_TXN_CSV, "fid-taxable")
    # 2 buys + 1 sell of VOO; dividend + option skipped.
    assert [(r["side"], r["symbol"], r["quantity"], r["price"]) for r in rows] == [
        ("buy", "VOO", 10.0, 400.0),
        ("buy", "VOO", 10.0, 420.0),
        ("sell", "VOO", 15.0, 460.0),
    ]
    assert all(r["kind"] == "equity" and r["account"] == "fid-taxable" for r in rows)
    assert rows[0]["date"] == "2024-01-10"                 # MM/DD/YYYY → ISO
    assert "2 non-equity-trade row" in " ".join(warnings)  # dividend + option


def test_transaction_rows_feed_realized_gains():
    """The parsed rows are exactly the shape portfolio.realized_gains FIFO-matches:
    the VOO round-trip books a real long-term + short-term split."""
    from vantage_server import portfolio
    from vantage_server.importer import parse_fidelity_transactions
    rows, _ = parse_fidelity_transactions(FIDELITY_TXN_CSV, "fid-taxable")
    rg = portfolio.realized_gains(rows, year=2026)
    # sell 15 @ 460: 10 from the 2024 lot (LT, cost 400 → +$600) + 5 from the 2026
    # lot (ST, cost 420 → +$200). total +$800.
    assert rg["long_term"]["gain"] == 600.0, rg["long_term"]
    assert rg["short_term"]["gain"] == 200.0, rg["short_term"]
    assert rg["total_gain"] == 800.0


# Schwab's transaction export: different header ("Date"/"Action:Buy/Sell"/"Amount")
# and a CUSIP-listed security that must be skipped.
SCHWAB_TXN_CSV = """Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount
07/16/2026,Buy,TQQQ,PROSHARES ULTRAPRO QQQ,10,72.70,0,-727.00
07/17/2026,Sell,TQQQ,PROSHARES ULTRAPRO QQQ,10,74.30,0,743.00
07/17/2026,Buy,25490K323,DFA SECURITY,5,100.00,0,-500.00
07/18/2026,Reinvest Dividend,MU,MICRON,0.5,80.00,0,40.00
"""


def test_parse_schwab_transactions_via_shared_parser():
    from vantage_server.importer import parse_transactions
    rows, warnings = parse_transactions(SCHWAB_TXN_CSV, "charles-schwab")
    # 1 buy + 1 sell of TQQQ; the CUSIP + the dividend reinvest skipped.
    assert [(r["side"], r["symbol"], r["quantity"]) for r in rows] == [
        ("buy", "TQQQ", 10.0), ("sell", "TQQQ", 10.0)]
    assert rows[0]["date"] == "2026-07-16" and rows[0]["account"] == "charles-schwab"
    joined = " ".join(warnings)
    assert "CUSIP-only" in joined and "non-equity-trade" in joined


def test_fidelity_non_money_market_double_star_still_skipped():
    # A "**" symbol that is NOT money-market/sweep/cash stays skipped (no value
    # misbooked as cash).
    csv = (
        "Account Number,Account Name,Symbol,Description,Quantity,Last Price,"
        "Current Value,Cost Basis Total,Average Cost Basis,Type\n"
        'Z1,Ind,FOO**,SOME RESTRICTED SECURITY,10,$5.00,"$50.00","$40.00",$4.00,Cash\n'
    )
    lots, warnings = parse_fidelity(csv, "fid-taxable", AS_OF)
    assert lots == []
    assert any("skipped cash/core position 'FOO**'" in w for w in warnings)


def test_fidelity_cash_capture_sums_multiple_cores():
    csv = (
        "Account Number,Account Name,Symbol,Description,Quantity,Last Price,"
        "Current Value,Cost Basis Total,Average Cost Basis,Type\n"
        'Z1,Ind,FDRXX**,HELD IN MONEY MARKET,,,"$1,000.00",,,Cash\n'
        'Z1,Ind,SPAXX**,FIDELITY GOVERNMENT MONEY MARKET,,,"$250.50",,,Cash\n'
        'Z1,Ind,VOO,VANGUARD S&P 500 ETF,10,$683.20,"$6,832.00","$6,000.00",$600.00,Cash\n'
    )
    lots, warnings = parse_fidelity(csv, "fid-taxable", AS_OF)
    cash = [l for l in lots if l["symbol"] == "CASH"]
    assert len(cash) == 1
    assert cash[0]["shares"] == 1250.50 and cash[0]["cost_per_share"] == 1
    assert any("captured $1,250.50 core cash" in w for w in warnings)


def test_parse_fidelity_cost_falls_back_to_total_over_qty():
    csv_text = (
        "Symbol,Description,Quantity,Cost Basis Total\n"
        'VOO,VANGUARD,10,"$6,832.00"\n'
    )
    lots, _ = parse_fidelity(csv_text, "fid-taxable", AS_OF)
    assert lots[0]["cost_per_share"] == pytest.approx(683.20)


def test_fidelity_requires_as_of_when_no_dates():
    with pytest.raises(importer.ImporterError, match="--as-of"):
        parse_fidelity(FIDELITY_CSV, "fid-taxable", None)


def test_parse_schwab_positions():
    lots, warnings = parse_schwab(SCHWAB_CSV, "fid-taxable", AS_OF)
    assert [(l["symbol"], l["shares"]) for l in lots] == [("IWM", 45.0), ("AAPL", 25.0)]
    assert lots[0]["cost_per_share"] == pytest.approx(14904.00 / 45)
    assert any("Cash & Cash Investments" in w for w in warnings)
    assert any("Account Total" in w for w in warnings)


def test_parse_vanguard_positions_price_fallback():
    lots, warnings = parse_vanguard(VANGUARD_CSV, "vg-401k", AS_OF)
    assert [(l["symbol"], l["shares"]) for l in lots] == [("VTI", 180.0), ("BND", 300.0)]
    # no cost basis in the basic download: Share Price fallback, warned per row
    assert lots[0]["cost_per_share"] == pytest.approx(330.45)
    assert sum("cost basis" in w for w in warnings) == 2
    assert any("VMFXX" in w for w in warnings)  # money-market sweep skipped
    # the trades section after the blank line was not slurped
    assert all(l["symbol"] != "88888888" for l in lots)


def test_parse_generic_with_and_without_account_column():
    lots, warnings = parse_generic(GENERIC_CSV, None, None)
    assert warnings == []
    assert [(l["account"], l["symbol"], l["date"]) for l in lots] == [
        ("fid-taxable", "VOO", "2025-11-03"),
        ("fid-taxable", "NVDA", "2025-08-15"),
    ]
    lots, _ = parse_generic(GENERIC_NO_ACCOUNT_CSV, "schwab-roth", None)
    assert lots[0]["account"] == "schwab-roth"
    with pytest.raises(importer.ImporterError, match="--account"):
        parse_generic(GENERIC_NO_ACCOUNT_CSV, None, None)


def test_parse_generic_rejects_wrong_header():
    with pytest.raises(importer.ImporterError, match="costPerShare"):
        parse_generic("symbol,qty\nVOO,1\n", "fid-taxable", None)


# ---------------------------------------------------------- merge / replace

def test_merge_replaces_only_target_account(workdir):
    rc = run_cli(workdir, FIDELITY_CSV, "--broker", "fidelity",
                 "--account", "fid-taxable", "--as-of", AS_OF)
    assert rc == EXIT_OK
    lots = read_lots(workdir)
    fid = [l for l in lots if l["account"] == "fid-taxable"]
    others = [l for l in lots if l["account"] != "fid-taxable"]
    assert {l["symbol"] for l in fid} == {"VOO", "NVDA", "CASH"}  # replaced wholesale (core cash captured)
    assert len(others) == 11  # every other account untouched (18 fixture - 7 fid)
    Store(workdir).load_dataset()  # the written file passes full store validation


def test_replace_swaps_whole_file(workdir):
    rc = run_cli(workdir, GENERIC_CSV, "--broker", "generic", "--replace")
    assert rc == EXIT_OK
    lots = read_lots(workdir)
    assert len(lots) == 2
    assert {l["symbol"] for l in lots} == {"VOO", "NVDA"}


# ------------------------------------------------------------------ backup

def test_write_lots_backs_up_with_injected_clock(workdir):
    before = read_lots(workdir)
    clock = dt.datetime(2026, 7, 5, 9, 30, 0)
    backup = write_lots(workdir, [{"account": "fid-taxable", "symbol": "VOO",
                                   "date": AS_OF, "shares": 1, "cost_per_share": 1.0}],
                        now=clock)
    assert backup is not None
    assert backup.name == "lots.json.bak-2026-07-05T09-30-00"
    assert json.loads(backup.read_text()) == before  # backup is the previous content
    assert len(read_lots(workdir)) == 1


def test_cli_import_writes_a_backup(workdir):
    before = read_lots(workdir)
    run_cli(workdir, GENERIC_CSV, "--broker", "generic")
    backups = list(workdir.glob("lots.json.bak-*"))
    assert len(backups) == 1
    assert json.loads(backups[0].read_text()) == before


def test_write_lots_without_previous_file_returns_none(tmp_path):
    assert write_lots(tmp_path, [], now=dt.datetime(2026, 7, 5)) is None
    assert (tmp_path / "lots.json").is_file()


# ----------------------------------------------------------------- dry run

def test_dry_run_writes_nothing(workdir, capsys):
    before = (workdir / "lots.json").read_text()
    rc = run_cli(workdir, GENERIC_CSV, "--broker", "generic", "--dry-run")
    assert rc == EXIT_OK
    out = capsys.readouterr().out
    assert "DRY RUN" in out and "VOO" in out and "nothing written" in out
    assert (workdir / "lots.json").read_text() == before
    assert list(workdir.glob("lots.json.bak-*")) == []  # not even a backup


# ------------------------------------------------------------------ aborts

def test_zero_lots_aborts_exit_2(workdir, capsys):
    footer_only = ("Symbol,Description,Quantity,Average Cost Basis\n"
                   "Pending Activity,,,\n")
    rc = run_cli(workdir, footer_only, "--broker", "fidelity",
                 "--account", "fid-taxable", "--as-of", AS_OF)
    assert rc == EXIT_USER_ERROR
    assert "no position rows" in capsys.readouterr().err


def test_unknown_account_aborts_exit_2(workdir, capsys):
    rc = run_cli(workdir, FIDELITY_CSV, "--broker", "fidelity",
                 "--account", "etrade-new", "--as-of", AS_OF)
    assert rc == EXIT_USER_ERROR
    err = capsys.readouterr().err
    assert "etrade-new" in err and "add the account first" in err
    assert len(read_lots(workdir)) == 18  # nothing written


def test_missing_account_flag_for_broker_export_exit_2(workdir, capsys):
    rc = run_cli(workdir, FIDELITY_CSV, "--broker", "fidelity", "--as-of", AS_OF)
    assert rc == EXIT_USER_ERROR
    assert "--account is required" in capsys.readouterr().err


# ------------------------------------------------------------- add-account

def test_add_account_flow(workdir):
    rc = run_cli(workdir, FIDELITY_CSV, "--broker", "fidelity",
                 "--account", "etrade-new", "--as-of", AS_OF,
                 "--add-account", "etrade-new,E*Trade Individual,E*Trade,Taxable,true")
    assert rc == EXIT_OK
    accounts = json.loads((workdir / "accounts.json").read_text())
    new = next(a for a in accounts if a["id"] == "etrade-new")
    assert new["taxable"] is True and new["short"] == "E*Trade"
    assert {l["symbol"] for l in read_lots(workdir) if l["account"] == "etrade-new"} == {
        "VOO", "NVDA", "CASH"
    }
    Store(workdir).load_dataset()  # accounts + lots still validate together


def test_add_account_bad_spec_exit_2(workdir, capsys):
    rc = run_cli(workdir, GENERIC_CSV, "--broker", "generic",
                 "--add-account", "just-an-id")
    assert rc == EXIT_USER_ERROR
    assert "5 comma-separated fields" in capsys.readouterr().err
