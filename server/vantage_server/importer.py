"""Broker positions importer — CLI file management for lots.json.

This CLI mutates the data directory the same way an operator editing the JSON
by hand would. It is deliberately OUTSIDE the read-only service surface
(ADR-010): the REST API and MCP tools never mutate anything; only this
command-line tool (run by the operator, on the operator's machine) writes.

    python -m vantage_server.importer positions.csv \
        --broker fidelity --account fid-taxable --as-of 2026-07-05

    # API broker connections: no CSV — read positions live from the broker's
    # API (READ-ONLY by hard transport-layer allowlist, see brokers/base.py)
    python -m vantage_server.importer \
        --broker robinhood --account rh-main --broker-account <N> [--as-of DATE]
    python -m vantage_server.importer --broker robinhood --auth  # one-time grant

ADDING A BROKER CONNECTION: one module in brokers/ implementing
brokers.base.BrokerConnection (fetch_positions/fetch_portfolio/
interactive_auth/auth_status), decorated with @register_connection and
imported from brokers/__init__.py. Its broker_id shows up in --broker
automatically; NOTHING in this file changes. Registered today: "robinhood"
(live), "schwab-api" and "fidelity-api" (informative stubs).

API LIMITATION — average cost basis, not tax lots: broker position APIs
(Robinhood's get_equity_positions included) return one row per symbol with an
AVERAGE buy price and no acquisition dates, so the sync writes ONE SYNTHETIC
LOT per position dated --as-of (default: today). Wash-sale and TLH math then
runs on average basis; when you need lot-accurate numbers, import a statement
CSV instead.

Broker parsers are tolerant of the messy realities of positions exports:
preamble lines, quoted "$1,234.56" numbers, cash/sweep rows, pending-activity
rows, and disclaimer footers are skipped (with per-row warnings where the row
looked like a position). Each parser yields internal lot dicts
{account, symbol, date, shares, cost_per_share}. A file that yields zero lots
aborts with exit code 2 — so does an unknown target account (add it first,
e.g. with --add-account).

Parser assumptions per broker:

- fidelity  Positions export: "Account Number,Account Name,Symbol,Description,
            Quantity,...,Cost Basis Total,Average Cost Basis,...". Cost per
            share prefers "Average Cost Basis", falling back to
            Cost Basis Total / Quantity. No acquisition date column in the
            standard export, so --as-of is required (a "Date Acquired" column
            is used when present). Rows whose symbol ends in "**" (core/sweep
            money market such as SPAXX**) and "Pending Activity" rows are
            skipped.
- schwab    Positions export: preamble line, then "Symbol,Description,
            Qty (Quantity),Price,...,Cost Basis,...". Cost per share =
            Cost Basis / Quantity ("Cost/Share" or "Date Acquired" columns are
            used when present). "Cash & Cash Investments" / "Account Total"
            footer rows are skipped. --as-of required when no date column.
- vanguard  Holdings download: "Account Number,Investment Name,Symbol,Shares,
            Share Price,Total Value". The basic download carries NO cost
            basis; an "Average Cost"/"Total Cost" column is used when present,
            otherwise cost per share falls back to Share Price with a warning.
            Money-market sweep rows are skipped. --as-of required (no dates).
- generic   Exactly the internal shape: header
            "account,symbol,date,shares,costPerShare" (the account column is
            optional when --account is given).

Writes ALWAYS back up the previous lots.json to lots.json.bak-<ISO> first
(write_lots takes an injectable `now` so tests are deterministic; the CLI
passes the real clock). --dry-run prints the parsed lots and writes nothing.
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import io
import json
import re
import sys
from pathlib import Path

from .brokers import CONNECTIONS, BrokerConnectionError, get_connection
from .store import StoreError, resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2


class ImporterError(Exception):
    """A user-correctable import problem (bad file, unknown account, ...)."""


# ------------------------------------------------------------- cell helpers

def _norm(cell: str) -> str:
    """Normalise a header cell: drop parentheticals, quotes, case, spacing.
    'Qty (Quantity)' -> 'qty'."""
    return re.sub(r"\(.*?\)", "", cell).strip().strip('"').strip().lower()


def _to_float(cell: str | None) -> float | None:
    """Parse a broker-formatted number ('$1,234.56', '(12.30)', 'N/A')."""
    if cell is None:
        return None
    s = str(cell).strip().strip('"').replace("$", "").replace(",", "").replace("%", "")
    if s in ("", "--", "n/a", "N/A", "N/D"):
        return None
    negative = s.startswith("(") and s.endswith(")")
    if negative:
        s = s[1:-1]
    try:
        value = float(s)
    except ValueError:
        return None
    return -value if negative else value


def _to_iso_date(cell: str | None) -> str | None:
    s = (cell or "").strip().strip('"')
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return _dt.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _rows(text: str) -> list[list[str]]:
    return [row for row in csv.reader(io.StringIO(text))]


def _find_header(
    rows: list[list[str]], symbol_col: str, qty_names: tuple[str, ...]
) -> tuple[int, dict[str, int]]:
    """Locate the header row (the one carrying a symbol AND a quantity-like
    column) and return (row index, normalised-name -> column-index map)."""
    for i, row in enumerate(rows):
        names = [_norm(c) for c in row]
        if symbol_col in names and any(q in names for q in qty_names):
            return i, {name: idx for idx, name in enumerate(names) if name}
    raise ImporterError(
        f"could not find a header row with '{symbol_col}' and one of {qty_names} columns"
    )


def _cell(row: list[str], idx: int | None) -> str | None:
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def _first(cols: dict[str, int], *names: str) -> int | None:
    for name in names:
        if name in cols:
            return cols[name]
    return None


def _need_date(row_date: str | None, as_of: str | None, symbol: str) -> str:
    if row_date:
        return row_date
    if as_of:
        return as_of
    raise ImporterError(
        f"row for {symbol} has no acquisition date and --as-of was not given; "
        "pass --as-of YYYY-MM-DD to date the imported lots deterministically"
    )


# ---------------------------------------------------------------- parsers
#
# Every parser: (text, account, as_of) -> (lots, warnings) where lots are
# internal dicts {account, symbol, date, shares, cost_per_share}.

_SCHWAB_FOOTERS = {"cash & cash investments", "account total", "total", "cash"}


def parse_fidelity(text: str, account: str, as_of: str | None):
    rows = _rows(text)
    hi, cols = _find_header(rows, "symbol", ("quantity", "qty"))
    i_sym = cols["symbol"]
    i_qty = _first(cols, "quantity", "qty")
    i_avg = _first(cols, "average cost basis", "average cost")
    i_total = _first(cols, "cost basis total", "cost basis")
    i_date = _first(cols, "date acquired", "acquisition date")
    lots, warnings = [], []
    for row in rows[hi + 1:]:
        symbol = (_cell(row, i_sym) or "").strip().strip('"')
        if not symbol or len(row) <= i_qty:
            continue  # blank spacer / disclaimer footer
        if "pending" in symbol.lower():
            warnings.append(f"skipped pending-activity row '{symbol}'")
            continue
        if symbol.endswith("**"):
            warnings.append(f"skipped cash/core position '{symbol}'")
            continue
        qty = _to_float(_cell(row, i_qty))
        if qty is None or qty <= 0:
            warnings.append(f"skipped {symbol}: quantity not a positive number")
            continue
        cost = _to_float(_cell(row, i_avg))
        if cost is None:
            total = _to_float(_cell(row, i_total))
            cost = total / qty if total is not None else None
        if cost is None:
            warnings.append(f"skipped {symbol}: no usable cost basis")
            continue
        lots.append({
            "account": account,
            "symbol": symbol.upper(),
            "date": _need_date(_to_iso_date(_cell(row, i_date)), as_of, symbol),
            "shares": qty,
            "cost_per_share": round(cost, 6),
        })
    return lots, warnings


def parse_schwab(text: str, account: str, as_of: str | None):
    rows = _rows(text)
    hi, cols = _find_header(rows, "symbol", ("quantity", "qty"))
    i_sym = cols["symbol"]
    i_qty = _first(cols, "quantity", "qty")
    i_cps = _first(cols, "cost/share", "cost per share")
    i_total = _first(cols, "cost basis", "cost basis total")
    i_date = _first(cols, "date acquired", "acquisition date")
    lots, warnings = [], []
    for row in rows[hi + 1:]:
        symbol = (_cell(row, i_sym) or "").strip().strip('"')
        if not symbol or len(row) <= i_qty:
            continue
        if symbol.lower() in _SCHWAB_FOOTERS or symbol.lower().startswith("account"):
            warnings.append(f"skipped non-position row '{symbol}'")
            continue
        qty = _to_float(_cell(row, i_qty))
        if qty is None or qty <= 0:
            warnings.append(f"skipped {symbol}: quantity not a positive number")
            continue
        cost = _to_float(_cell(row, i_cps))
        if cost is None:
            total = _to_float(_cell(row, i_total))
            cost = total / qty if total is not None else None
        if cost is None:
            warnings.append(f"skipped {symbol}: no usable cost basis")
            continue
        lots.append({
            "account": account,
            "symbol": symbol.upper(),
            "date": _need_date(_to_iso_date(_cell(row, i_date)), as_of, symbol),
            "shares": qty,
            "cost_per_share": round(cost, 6),
        })
    return lots, warnings


def parse_vanguard(text: str, account: str, as_of: str | None):
    rows = _rows(text)
    hi, cols = _find_header(rows, "symbol", ("shares", "quantity"))
    i_sym = cols["symbol"]
    i_shares = _first(cols, "shares", "quantity")
    i_name = _first(cols, "investment name")
    i_avg = _first(cols, "average cost", "average cost basis")
    i_total = _first(cols, "total cost", "cost basis")
    i_price = _first(cols, "share price")
    lots, warnings = [], []
    started = False
    for row in rows[hi + 1:]:
        if started and not any(c.strip() for c in row):
            break  # blank line ends the holdings section (a trades section may follow)
        symbol = (_cell(row, i_sym) or "").strip().strip('"')
        if not symbol or len(row) <= i_shares:
            continue
        name = (_cell(row, i_name) or "").lower()
        if "money market" in name or "sweep" in name:
            warnings.append(f"skipped cash/sweep position '{symbol}'")
            continue
        shares = _to_float(_cell(row, i_shares))
        if shares is None or shares <= 0:
            warnings.append(f"skipped {symbol}: shares not a positive number")
            continue
        cost = _to_float(_cell(row, i_avg))
        if cost is None:
            total = _to_float(_cell(row, i_total))
            cost = total / shares if total is not None else None
        if cost is None:
            cost = _to_float(_cell(row, i_price))
            if cost is not None:
                warnings.append(
                    f"{symbol}: export has no cost basis — using Share Price "
                    "as cost_per_share (unrealized P/L will read as zero)"
                )
        if cost is None:
            warnings.append(f"skipped {symbol}: no usable cost or price")
            continue
        lots.append({
            "account": account,
            "symbol": symbol.upper(),
            "date": _need_date(None, as_of, symbol),
            "shares": shares,
            "cost_per_share": round(cost, 6),
        })
        started = True
    return lots, warnings


def parse_generic(text: str, account: str | None, as_of: str | None):
    reader = csv.DictReader(io.StringIO(text))
    fields = {f.strip() for f in (reader.fieldnames or [])}
    required = {"symbol", "date", "shares", "costPerShare"}
    if not required <= fields:
        raise ImporterError(
            "generic CSV must have header 'account,symbol,date,shares,costPerShare' "
            f"(account optional when --account is given); missing: {sorted(required - fields)}"
        )
    lots, warnings = [], []
    for n, row in enumerate(reader, start=2):
        symbol = (row.get("symbol") or "").strip()
        if not symbol:
            continue
        acct = (row.get("account") or "").strip() or account
        if not acct:
            raise ImporterError(f"line {n}: no account column value and --account not given")
        date = _to_iso_date(row.get("date")) or as_of
        if not date:
            warnings.append(f"skipped {symbol} (line {n}): bad or missing date and no --as-of")
            continue
        shares = _to_float(row.get("shares"))
        cost = _to_float(row.get("costPerShare"))
        if shares is None or shares <= 0:
            warnings.append(f"skipped {symbol} (line {n}): shares not a positive number")
            continue
        if cost is None or cost < 0:
            warnings.append(f"skipped {symbol} (line {n}): costPerShare not a non-negative number")
            continue
        lots.append({
            "account": acct,
            "symbol": symbol.upper(),
            "date": date,
            "shares": shares,
            "cost_per_share": cost,
        })
    return lots, warnings


PARSERS = {
    "fidelity": parse_fidelity,
    "schwab": parse_schwab,
    "vanguard": parse_vanguard,
    "generic": parse_generic,
}

#: --broker choices: CSV parsers + every registered API connection.
BROKERS = tuple(PARSERS) + tuple(sorted(CONNECTIONS))


# -------------------------------------------------- API broker connections

def api_positions_to_lots(positions: list[dict], account: str, as_of: str):
    """Convert normalized API positions ({symbol, shares, avg_cost, ...} —
    brokers.base.Position) into synthetic lots: ONE lot per position, dated
    as_of, at the AVERAGE cost basis (position APIs expose no tax-lot detail
    — see module docstring). Zero/negative-share rows are skipped with
    warnings."""
    lots, warnings = [], []
    for pos in positions:
        symbol = str(pos.get("symbol") or "").strip().upper()
        if not symbol:
            warnings.append("skipped a position with no symbol")
            continue
        shares = _to_float(pos.get("shares"))
        if shares is None or shares <= 0:
            warnings.append(f"skipped {symbol}: zero or non-positive share count")
            continue
        avg = _to_float(pos.get("avg_cost"))
        if avg is None or avg < 0:
            warnings.append(f"skipped {symbol}: no usable average cost basis")
            continue
        if avg == 0:
            warnings.append(f"{symbol}: average cost basis is 0 — unrealized "
                            "P/L will read as the full position value")
        lots.append({
            "account": account,
            "symbol": symbol,
            "date": as_of,
            "shares": shares,
            "cost_per_share": round(avg, 6),
        })
    return lots, warnings


def api_cash_lot(portfolio: dict, positions: list[dict], account: str, as_of: str,
                 *, options_value: float = 0.0, sleeves_value: float = 0.0):
    """Represent the account's NON-EQUITY value as one synthetic CASH lot.

    Position APIs are typically equities-only; value held in futures, crypto,
    sweep, or buying power never appears as a position. ``--include-cash``
    books ``total_value − Σ(equity position value)`` as CASH (the store's
    $1-priced cash symbol) so the account's real worth shows in Vantage.
    Requires the connection's fetch_portfolio to include ``total_value``.
    Returns ``(lot | None, warnings)``.

    With ``--breakout`` the remainder additionally subtracts the value already
    booked as option lots (``options_value`` — the sum of the imported option
    marks) and as CRYPTO/FUTURES sleeve lots (``sleeves_value``) so nothing is
    double-counted. Any SKIPPED short option's negative market value is
    thereby absorbed into CASH (total_value nets it; the imported longs do
    not), keeping the account total honest.
    """
    warnings: list[str] = []
    total = _to_float(portfolio.get("total_value"))
    if total is None:
        return None, ["portfolio total_value missing — cannot compute CASH balance"]
    equity_value = 0.0
    for pos in positions:
        shares = _to_float(pos.get("shares")) or 0.0
        price = _to_float(pos.get("current_price"))
        if price is None:
            price = _to_float(pos.get("avg_cost")) or 0.0
            if shares > 0:
                warnings.append(
                    f"{pos.get('symbol', '?')}: no current price — valued at cost "
                    "for the CASH remainder calculation"
                )
        equity_value += shares * price
    cash = round(total - equity_value - options_value - sleeves_value, 2)
    if cash <= 0:
        return None, warnings
    if options_value or sleeves_value:
        warnings.append(
            f"CASH {cash:,.2f} = portfolio total {total:,.2f} minus equity "
            f"{equity_value:,.2f} minus options marks {options_value:,.2f} "
            f"minus sleeves {sleeves_value:,.2f}"
        )
    else:
        warnings.append(
            f"CASH {cash:,.2f} = portfolio total {total:,.2f} minus equity value "
            f"{equity_value:,.2f} (futures/crypto/sweep are not importable as positions)"
        )
    return {
        "account": account,
        "symbol": "CASH",
        "date": as_of,
        "shares": cash,
        "cost_per_share": 1,
    }, warnings


# ------------------------------------------------- options + sleeve breakout

def option_lots_and_quotes(options: list[dict], account: str, as_of: str):
    """Convert normalized option positions (brokers' fetch_option_positions
    shape) into (lots, quote_entries, warnings, marked_value).

    Each LONG contract becomes one lot under the compact display symbol
    ("SPY 2026-07-17 750C"): shares = contracts, cost_per_share = avg premium
    x multiplier (per-CONTRACT dollars), dated from opened_at when the API
    provides it (real acquisition date) else as_of. quote_entries carries a
    quotes.json record per symbol — price = mark x multiplier when the broker
    returned a mark, else cost (honest staleness) — asset_class "options" so
    the engine values the contract at its mark, not cost.

    SHORT positions are SKIPPED with one loud warning listing them: the store
    rejects non-positive-share lots (store.load_lots) and the engine's
    positions/TLH math assumes long lots, so a negative-share representation
    would poison the whole data dir at load time. Their negative market value
    is absorbed by the --breakout CASH remainder (see api_cash_lot).

    marked_value = Σ(contracts x (mark|cost) x multiplier) over the IMPORTED
    lots — exactly what the CASH remainder must subtract.
    """
    lots: list[dict] = []
    quote_entries: dict[str, dict] = {}
    warnings: list[str] = []
    skipped_shorts: list[str] = []
    marked_value = 0.0
    for opt in options:
        symbol = opt.get("occ_symbol")
        label = symbol or (
            f"{opt.get('underlying', '?')} {opt.get('expiration', '?')} "
            f"(instrument {opt.get('instrument_id', '?')})"
        )
        if opt.get("position_type") == "short":
            skipped_shorts.append(label)
            continue
        if not symbol:
            warnings.append(
                f"skipped option {label}: strike/type lookup failed — cannot "
                "name the contract"
            )
            continue
        contracts = _to_float(opt.get("contracts"))
        if contracts is None or contracts <= 0:
            warnings.append(f"skipped option {label}: no open contracts")
            continue
        multiplier = _to_float(opt.get("multiplier")) or 100.0
        avg = _to_float(opt.get("avg_price"))
        if avg is None or avg < 0:
            warnings.append(f"skipped option {label}: no usable average premium")
            continue
        cost_per_contract = round(avg * multiplier, 6)
        opened = str(opt.get("opened_at") or "")[:10]
        lots.append({
            "account": account,
            "symbol": symbol,
            "date": opened if _to_iso_date(opened) else as_of,
            "shares": contracts,
            "cost_per_share": cost_per_contract,
        })
        mark = _to_float(opt.get("mark"))
        price = round(mark * multiplier, 6) if mark is not None else cost_per_contract
        if mark is None:
            warnings.append(f"{symbol}: no mark from broker — valued at cost")
        option_name = (
            f"{opt.get('underlying', symbol)} ${_to_float(opt.get('strike')) or 0:g} "
            f"{'Call' if str(opt.get('option_type')).lower().startswith('c') else 'Put'} "
            f"{opt.get('expiration', '')}".strip()
        )
        quote_entries[symbol] = {
            "name": option_name,
            "price": price,
            "day_pct": 0,
            "asset_class": "options",
        }
        marked_value += contracts * price
    if skipped_shorts:
        warnings.append(
            "SKIPPED SHORT OPTION POSITION(S) — the engine cannot represent "
            "negative-share lots; their negative value is absorbed into the "
            f"CASH remainder: {', '.join(skipped_shorts)}"
        )
    return lots, quote_entries, warnings, round(marked_value, 2)


#: sleeve symbol -> (portfolio field, asset_class, display name)
SLEEVES = {
    "CRYPTO": ("crypto_value", "crypto", "Crypto sleeve (value via Robinhood portfolio)"),
    "FUTURES": ("futures_value", "other", "Futures sleeve (value via Robinhood portfolio)"),
}


def sleeve_lots_and_quotes(portfolio: dict, account: str, as_of: str):
    """Crypto/futures VALUE sleeves: no positions API exists for either, but
    get_portfolio reports their current value (crypto_value/futures_value).
    Book each nonzero sleeve as ONE $1-priced lot (shares = value, cost 1 —
    like CASH, so unrealized P/L reads 0) plus a quotes.json entry carrying
    its asset class. Returns (lots, quote_entries, warnings, sleeves_value).
    """
    lots: list[dict] = []
    quote_entries: dict[str, dict] = {}
    warnings: list[str] = []
    sleeves_value = 0.0
    for symbol, (field, asset_class, name) in SLEEVES.items():
        value = _to_float(portfolio.get(field))
        if value is None or value <= 0:
            continue
        value = round(value, 2)
        lots.append({
            "account": account,
            "symbol": symbol,
            "date": as_of,
            "shares": value,
            "cost_per_share": 1,
        })
        quote_entries[symbol] = {
            "name": name, "price": 1, "day_pct": 0, "asset_class": asset_class,
        }
        warnings.append(f"{symbol} sleeve booked at {value:,.2f} (portfolio {field})")
        sleeves_value += value
    return lots, quote_entries, warnings, round(sleeves_value, 2)


# Back-compat aliases from when Robinhood was the only API broker.
robinhood_positions_to_lots = api_positions_to_lots
robinhood_cash_lot = api_cash_lot


# ------------------------------------------------------------------ writer

def write_lots(
    data_dir: str | Path, lots: list[dict], *, now: _dt.datetime | None = None
) -> Path | None:
    """Write lots.json, ALWAYS backing up the previous file first.

    The backup lands next to lots.json as lots.json.bak-<ISO timestamp>
    (colons replaced with '-' for filename portability). `now` is injectable
    so tests get deterministic backup names; the CLI passes the real clock.
    Returns the backup path, or None when there was no previous file.
    """
    now = now or _dt.datetime.now()
    path = Path(data_dir) / "lots.json"
    backup: Path | None = None
    if path.is_file():
        stamp = now.isoformat(timespec="seconds").replace(":", "-")
        backup = path.with_name(f"lots.json.bak-{stamp}")
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    path.write_text(json.dumps(lots, indent=2) + "\n", encoding="utf-8")
    return backup


def update_quotes_file(
    data_dir: str | Path, entries: dict[str, dict], *, now: _dt.datetime | None = None
) -> Path:
    """Upsert importer-maintained quote entries (option marks, sleeves) into
    <data_dir>/quotes.json so the FixtureQuoteProvider values them.

    Existing entries for other symbols — and the file's as_of — are preserved
    (the fixture as_of is the engine's 'today'; a missing file gets a skeleton
    stamped with the real clock). Each entry is a full quote record
    {name, price, day_pct, asset_class}.
    """
    now = now or _dt.datetime.now()
    path = Path(data_dir) / "quotes.json"
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ImporterError(f"{path}: invalid JSON ({e})") from e
        if not isinstance(data, dict) or not isinstance(data.get("quotes"), dict):
            raise ImporterError(f"{path}: must be an object with 'as_of' and 'quotes' keys")
    else:
        data = {"as_of": now.isoformat(timespec="seconds"), "quotes": {}}
    data["quotes"].update(entries)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return path


def write_history(
    data_dir: str | Path, account: str, rows: list[dict],
    *, now: _dt.datetime | None = None,
) -> tuple[Path, Path | None]:
    """Snapshot transaction history to <data_dir>/history.json.

    Merge-by-account like the lots merge: this account's previous rows are
    replaced, every other account's rows are kept; the previous file is
    ALWAYS backed up first (history.json.bak-<ISO>). Rows are stored newest
    first. Returns (path, backup | None).
    """
    now = now or _dt.datetime.now()
    path = Path(data_dir) / "history.json"
    existing: list[dict] = []
    backup: Path | None = None
    if path.is_file():
        existing = [r for r in _load_json_list(path, "history") if isinstance(r, dict)]
        stamp = now.isoformat(timespec="seconds").replace(":", "-")
        backup = path.with_name(f"history.json.bak-{stamp}")
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    kept = [r for r in existing if r.get("account") != account]
    merged = sorted(rows + kept, key=lambda r: str(r.get("date") or ""), reverse=True)
    path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    return path, backup


# ----------------------------------------------------------------- account

def _parse_add_account(spec: str) -> dict:
    parts = [p.strip() for p in spec.split(",")]
    if len(parts) != 5:
        raise ImporterError(
            '--add-account expects "id,name,short,type,taxable" (5 comma-separated fields)'
        )
    taxable_raw = parts[4].lower()
    if taxable_raw not in ("true", "false", "yes", "no", "1", "0"):
        raise ImporterError(f"--add-account: taxable must be true/false, got '{parts[4]}'")
    return {
        "id": parts[0],
        "name": parts[1],
        "short": parts[2],
        "type": parts[3],
        "taxable": taxable_raw in ("true", "yes", "1"),
        "last_sync": "never",
    }


def _load_json_list(path: Path, what: str) -> list:
    if not path.is_file():
        raise ImporterError(f"{path}: {what} file not found")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ImporterError(f"{path}: invalid JSON ({e})") from e
    if not isinstance(data, list):
        raise ImporterError(f"{path}: top level must be a JSON array")
    return data


# --------------------------------------------------------------------- CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.importer",
        description="Import a broker positions CSV into the Vantage lots.json "
                    "(operator-side file management — the API stays read-only).",
    )
    api_brokers = ", ".join(sorted(CONNECTIONS))
    p.add_argument("csv_file", nargs="?",
                   help="path to the broker positions export (omit for API broker "
                        f"connections — {api_brokers} — which read the broker's API)")
    p.add_argument("--broker", required=True, choices=BROKERS)
    p.add_argument("--account",
                   help="target internal account id (required unless the generic "
                        "CSV carries an account column)")
    p.add_argument("--broker-account", "--rh-account", dest="broker_account",
                   metavar="N",
                   help="broker-side account number (required for API broker "
                        "connections; --rh-account is a deprecated alias)")
    p.add_argument("--list-accounts", action="store_true",
                   help="API broker connections only: list the broker accounts "
                        "visible under the grant (account numbers for --broker-account) and exit")
    p.add_argument("--include-cash", action="store_true",
                   help="API broker connections only: book the account's non-equity "
                        "value (futures/crypto/sweep/buying power) as a synthetic "
                        "CASH lot")
    p.add_argument("--breakout", action="store_true",
                   help="API broker connections only: break the non-equity value "
                        "out per asset — one lot per LONG option contract (marked "
                        "via quotes.json), CRYPTO/FUTURES value sleeves, and the "
                        "remaining CASH (implies the cash booking; short options "
                        "are skipped with a warning)")
    p.add_argument("--with-history", action="store_true",
                   help="API broker connections only: also snapshot the account's "
                        "equity+option order history to <data-dir>/history.json "
                        "(merge by account, backed up like lots.json)")
    p.add_argument("--auth", action="store_true",
                   help="API broker connections only: run the connection's one-time "
                        "authorization flow (e.g. browser OAuth), save the token, "
                        "and exit")
    p.add_argument("--data-dir", help="data directory (default: VANTAGE_DATA_DIR or server/data)")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--merge", action="store_true",
                      help="replace only the imported accounts' lots, keep all others (default)")
    mode.add_argument("--replace", action="store_true",
                      help="swap the WHOLE lots file for the imported lots")
    p.add_argument("--dry-run", action="store_true",
                   help="print the parsed lots and summary; write nothing")
    p.add_argument("--as-of",
                   help="ISO date (YYYY-MM-DD) used as the lot date when the export "
                        "carries no acquisition dates (required for such exports)")
    p.add_argument("--add-account", metavar='"id,name,short,type,taxable"',
                   help="append this account to accounts.json before importing")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        return _run(args)
    except (ImporterError, StoreError) as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_USER_ERROR


def _api(broker_id: str, fn, *fn_args):
    """Run one connection call, converting a connection's failures (auth,
    transport, stub NotImplementedError) into user-facing ImporterErrors."""
    try:
        return fn(*fn_args)
    except NotImplementedError as e:
        raise ImporterError(f"{broker_id}: {e}") from e
    except BrokerConnectionError as e:
        raise ImporterError(f"{broker_id}: {e}") from e


def _run(args: argparse.Namespace) -> int:
    if args.auth:
        if args.broker not in CONNECTIONS:
            raise ImporterError(
                "--auth is only valid with an API broker connection "
                f"({', '.join(sorted(CONNECTIONS))})"
            )
        conn = get_connection(args.broker)()
        _api(args.broker, conn.interactive_auth)
        return EXIT_OK

    if args.list_accounts:
        if args.broker not in CONNECTIONS:
            raise ImporterError(
                "--list-accounts is only valid with an API broker connection "
                f"({', '.join(sorted(CONNECTIONS))})"
            )
        conn = get_connection(args.broker)()
        lister = getattr(conn, "list_accounts", None)
        if lister is None:
            raise ImporterError(f"{args.broker}: account listing is not supported")
        accounts = _api(args.broker, lister)
        for a in accounts:
            flags = []
            if a.get("is_default"):
                flags.append("default")
            flags.append("agentic" if a.get("agentic_allowed") else "read-only via API")
            nickname = f" ({a['nickname']})" if a.get("nickname") else ""
            print(f"  {a['account_number']}  {a.get('type', ''):8}{nickname}  [{', '.join(flags)}]")
        return EXIT_OK

    data_dir = resolve_data_dir(args.data_dir)
    if args.as_of and _to_iso_date(args.as_of) != args.as_of:
        raise ImporterError(f"--as-of must be an ISO date (YYYY-MM-DD), got '{args.as_of}'")
    if args.broker != "generic" and not args.account:
        raise ImporterError(f"--account is required for --broker {args.broker}")

    quote_entries: dict[str, dict] = {}
    history_rows: list[dict] | None = None

    if args.broker in CONNECTIONS:
        conn = get_connection(args.broker)()
        if args.csv_file:
            raise ImporterError(
                f"--broker {args.broker} reads positions from the API — "
                "do not pass a CSV file")
        if not args.broker_account:
            raise ImporterError(
                f"--broker-account/--rh-account is required for --broker {args.broker}")
        as_of = args.as_of or _dt.date.today().isoformat()
        positions = _api(args.broker, conn.fetch_positions, args.broker_account)
        lots, warnings = api_positions_to_lots(positions, args.account, as_of)
        if args.breakout:
            fetch_opts = getattr(conn, "fetch_option_positions", None)
            if fetch_opts is None:
                raise ImporterError(
                    f"{args.broker}: --breakout is not supported (no option-"
                    "positions capability on this connection)")
            options = _api(args.broker, fetch_opts, args.broker_account)
            opt_lots, opt_quotes, opt_warnings, options_value = \
                option_lots_and_quotes(options, args.account, as_of)
            lots.extend(opt_lots)
            quote_entries.update(opt_quotes)
            warnings.extend(opt_warnings)
            portfolio = _api(args.broker, conn.fetch_portfolio, args.broker_account)
            sleeve_lots, sleeve_quotes, sleeve_warnings, sleeves_value = \
                sleeve_lots_and_quotes(portfolio, args.account, as_of)
            lots.extend(sleeve_lots)
            quote_entries.update(sleeve_quotes)
            warnings.extend(sleeve_warnings)
            # --breakout implies the cash booking: the remainder AFTER options
            # and sleeves, so nothing is double-counted.
            cash_lot, cash_warnings = api_cash_lot(
                portfolio, positions, args.account, as_of,
                options_value=options_value, sleeves_value=sleeves_value,
            )
            warnings.extend(cash_warnings)
            if cash_lot:
                lots.append(cash_lot)
        elif args.include_cash:
            portfolio = _api(args.broker, conn.fetch_portfolio, args.broker_account)
            cash_lot, cash_warnings = api_cash_lot(
                portfolio, positions, args.account, as_of
            )
            warnings.extend(cash_warnings)
            if cash_lot:
                lots.append(cash_lot)
        if args.with_history:
            fetch_hist = getattr(conn, "fetch_history", None)
            if fetch_hist is None:
                raise ImporterError(
                    f"{args.broker}: --with-history is not supported (no history "
                    "capability on this connection)")
            history_rows = _api(args.broker, fetch_hist, args.broker_account)
            for row in history_rows:
                row["account"] = args.account
        source = f"{conn.display_name} account ...{args.broker_account[-4:]}"
    else:
        if args.breakout or args.with_history:
            raise ImporterError(
                "--breakout/--with-history are only valid with an API broker "
                f"connection ({', '.join(sorted(CONNECTIONS))})")
        if not args.csv_file:
            raise ImporterError(f"a positions CSV file is required for --broker {args.broker}")
        csv_path = Path(args.csv_file)
        if not csv_path.is_file():
            raise ImporterError(f"{csv_path}: file not found")
        text = csv_path.read_text(encoding="utf-8-sig")
        lots, warnings = PARSERS[args.broker](text, args.account, args.as_of)
        source = str(csv_path)

    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    if not lots:
        raise ImporterError(f"{source}: no position rows found — nothing to import")

    # -- accounts: optional convenience append, then hard existence check
    accounts_path = data_dir / "accounts.json"
    accounts = _load_json_list(accounts_path, "accounts")
    known = {a.get("id") for a in accounts}
    if args.add_account:
        new_acct = _parse_add_account(args.add_account)
        if new_acct["id"] in known:
            print(f"warning: account '{new_acct['id']}' already exists — --add-account ignored",
                  file=sys.stderr)
        else:
            accounts.append(new_acct)
            known.add(new_acct["id"])
            if not args.dry_run:
                accounts_path.write_text(json.dumps(accounts, indent=2) + "\n", encoding="utf-8")
                print(f"added account '{new_acct['id']}' to {accounts_path}")
    imported_accounts = sorted({l["account"] for l in lots})
    for acct in imported_accounts:
        if acct not in known:
            raise ImporterError(
                f"account '{acct}' is not in {accounts_path} — add the account first "
                f'(e.g. --add-account "{acct},Full Name,Short,Taxable,true")'
            )

    # -- merge/replace against the current file
    lots_path = data_dir / "lots.json"
    existing = _load_json_list(lots_path, "lots") if lots_path.is_file() else []
    if args.replace:
        final, kept = list(lots), 0
    else:
        keep = [l for l in existing if l.get("account") not in imported_accounts]
        final, kept = keep + lots, len(keep)
    mode = "replace" if args.replace else "merge"

    if args.dry_run:
        print(f"DRY RUN — parsed {len(lots)} lot(s) from {source} ({args.broker}):")
        for l in lots:
            print(f"  {l['account']:<14} {l['symbol']:<24} {l['date']}  "
                  f"{l['shares']:>12g} sh @ {l['cost_per_share']:.2f}")
        print(f"would write {len(final)} lot(s) to {lots_path} "
              f"({mode}; {kept} lot(s) from other accounts kept); nothing written")
        if quote_entries:
            print(f"would upsert {len(quote_entries)} quote entrie(s) into "
                  f"{data_dir / 'quotes.json'}; nothing written")
        if history_rows is not None:
            print(f"would write {len(history_rows)} history row(s) to "
                  f"{data_dir / 'history.json'}; nothing written")
        return EXIT_OK

    backup = write_lots(data_dir, final)
    print(f"imported {len(lots)} lot(s) into {', '.join(imported_accounts)} ({mode})")
    print(f"wrote {len(final)} lot(s) to {lots_path}"
          + (f" (backup: {backup})" if backup else " (no previous file to back up)"))
    if quote_entries:
        quotes_path = update_quotes_file(data_dir, quote_entries)
        print(f"upserted {len(quote_entries)} quote entrie(s) into {quotes_path}")
    if history_rows is not None:
        history_path, history_backup = write_history(
            data_dir, args.account, history_rows)
        print(f"wrote {len(history_rows)} history row(s) to {history_path}"
              + (f" (backup: {history_backup})" if history_backup
                 else " (no previous file to back up)"))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
