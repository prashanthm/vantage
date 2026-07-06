"""One-click REFRESH — re-pull broker holdings + transactions into the store.

This is the ONLY place the app deliberately WRITES portfolio data on an operator
action (the nightly CLIs are the other writers). The policy shift (see api.py's
POST /api/refresh comment): the API may now WRITE to our own SQLite store, but
the absolute invariant is preserved — refresh calls ONLY read broker tools
(fetch_positions / fetch_option_positions / fetch_portfolio / fetch_history),
NEVER an order-placement or fund-movement tool. The broker connectors enforce
this at the transport layer (robinhood.py's READ_TOOLS allowlist, ADR-010), so a
mutating call is impossible here regardless of what refresh asks for.

Refresh reuses the importer's breakout helpers (api_positions_to_lots,
option_lots_and_quotes, sleeve_lots_and_quotes, api_cash_lot) verbatim, so a
refresh produces the SAME lots the importer's ``--breakout`` did — refreshing
never changes the shape of the data. History ACCUMULATES: upsert_history dedupes
on the row's natural key, so running refresh twice never doubles a transaction.
"""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from typing import Any

from .brokers.base import BrokerConnectionError, CONNECTIONS, get_connection
from .importer import (
    api_cash_lot,
    api_positions_to_lots,
    option_lots_and_quotes,
    sleeve_lots_and_quotes,
)
from .store import Store

#: CSV-only brokers have no live API — their accounts are refreshed by
#: re-importing a CSV, not by a broker pull. Robinhood (and any future API
#: connection) live in brokers.base.CONNECTIONS.
CSV_ONLY_BROKERS = frozenset({"fidelity", "schwab", "vanguard", "generic"})


@dataclass
class RefreshResult:
    """The outcome of refreshing one account. ``csv_only`` accounts carry a
    message instead of counts; ``errors`` is populated instead of raising so a
    multi-account refresh reports per-account failures without aborting."""

    account: str
    positions: int = 0
    new_transactions: int = 0
    cash: float | None = None
    as_of: str | None = None
    broker: str | None = None
    csv_only: bool = False
    last_imported: str | None = None
    message: str | None = None
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"account": self.account, "errors": self.errors}
        if self.broker is not None:
            out["broker"] = self.broker
        if self.csv_only:
            out["csv_only"] = True
            out["last_imported"] = self.last_imported
            out["message"] = self.message
            return out
        out.update(
            positions=self.positions,
            new_transactions=self.new_transactions,
            cash=self.cash,
            as_of=self.as_of,
        )
        if self.message is not None:
            out["message"] = self.message
        return out


def _now_iso(now: _dt.datetime | None = None) -> str:
    """A timezone-aware UTC timestamp for last_synced.

    Must carry an explicit offset ('...+00:00') so the browser's `new Date(iso)`
    parses it unambiguously as UTC — a naive local string would be misread
    (bare ISO datetimes are parsed as local by some engines, UTC by others),
    throwing the "synced N ago" label off by the local UTC offset.
    """
    return (now or _dt.datetime.now(_dt.timezone.utc)).isoformat(timespec="seconds")


def broker_of(account_id: str) -> str | None:
    """Best-effort broker id from an account id prefix (rh-* -> robinhood,
    fid-* -> fidelity, ...). Meta ``broker:<account>`` overrides this when set
    at import time; used only as the fallback resolution."""
    aid = account_id.lower()
    if aid.startswith("rh") or aid.startswith("robinhood"):
        return "robinhood"
    if aid.startswith("fid") or aid.startswith("fidelity"):
        return "fidelity"
    if aid.startswith("schwab") or aid.startswith("sch"):
        return "schwab"
    if aid.startswith("vg") or aid.startswith("vanguard"):
        return "vanguard"
    return None


def resolve_broker(store: Store, account_id: str) -> str | None:
    """The broker id for an account: meta ``broker:<account>`` (persisted at
    import) wins, then the id-prefix heuristic."""
    meta = store.get_meta(f"broker:{account_id}")
    if meta:
        return meta
    return broker_of(account_id)


def resolve_broker_account(store: Store, account_id: str, broker: str) -> str | None:
    """The FULL broker-side account number for an account.

    The importer received it as ``--broker-account`` but the store never kept
    the full value (history only carries the masked ``...NNNN``). Resolution:

      1. meta ``broker_account:<account>`` — the persisted full number.
      2. Otherwise, back it out from the live broker: match the masked suffix in
         the imported history against the connection's list_accounts() full
         numbers, and persist the winner to meta so step 1 hits next time.

    Returns the full number or None when it cannot be resolved (a live listing
    is required and either the connection has no lister or nothing matches)."""
    full = store.get_meta(f"broker_account:{account_id}")
    if full:
        return full
    return _backfill_broker_account(store, account_id, broker)


def _masked_suffix(store: Store, account_id: str) -> str | None:
    """The last-4 (or full masked token) recorded for this account in history —
    the only broker-account identifier the store already holds."""
    for row in store.load_history():
        if row.get("account") == account_id and row.get("broker_account"):
            masked = str(row["broker_account"])
            digits = masked[-4:]
            return digits
    return None


def _backfill_broker_account(store: Store, account_id: str, broker: str) -> str | None:
    """Resolve the full broker-side account number by matching the masked suffix
    from history against a live list_accounts(), then persist it to meta.

    Read-only: list_accounts() is an allowlisted read tool. Any broker failure
    is swallowed to None (the caller records an error and proceeds)."""
    if broker not in CONNECTIONS:
        return None
    suffix = _masked_suffix(store, account_id)
    conn = get_connection(broker)()
    lister = getattr(conn, "list_accounts", None)
    if lister is None:
        return None
    try:
        accounts = lister()
    except (BrokerConnectionError, NotImplementedError):
        return None
    candidates = [str(a.get("account_number")) for a in accounts if a.get("account_number")]
    if suffix:
        for num in candidates:
            if num[-4:] == suffix:
                store.set_meta(f"broker_account:{account_id}", num)
                return num
    # No history suffix to match against but exactly one account under the grant
    # — unambiguous, so adopt it.
    if len(candidates) == 1:
        store.set_meta(f"broker_account:{account_id}", candidates[0])
        return candidates[0]
    return None


def _last_imported(store: Store, account_id: str) -> str | None:
    """When a CSV account was last imported: the last_synced meta if present,
    else the newest lot date for that account (the importer stamps lots as_of)."""
    synced = store.get_meta(f"last_synced:{account_id}")
    if synced:
        return synced
    dates = [l.date for l in store.load_lots() if l.account == account_id]
    return max(dates) if dates else None


def refresh_account(
    store: Store,
    account_id: str,
    *,
    broker: str | None = None,
    broker_account: str | None = None,
    as_of: str | None = None,
    now: _dt.datetime | None = None,
) -> RefreshResult:
    """Re-pull one account from its broker and persist to the store.

    For an API broker (robinhood): fetch_positions + fetch_option_positions +
    fetch_portfolio (breakout: option contracts as lots, crypto/futures sleeves,
    CASH remainder — the importer's helpers), fetch_history -> upsert_history
    (accumulate/dedupe), upsert_lots(mode="replace") for THIS account only,
    set_quotes for new option marks, and set_meta(last_synced:<account>).

    For a CSV-only broker: return a csv_only result with the last-imported
    marker and a message — never an error, never a broker call.

    Broker resolution failure (unknown broker, no full account number) records
    an error on the result and returns it; the caller (a multi-account refresh)
    keeps going."""
    account_id = str(account_id)
    known = {a.id for a in store.load_accounts()}
    if account_id not in known:
        return RefreshResult(account=account_id, errors=[f"unknown account '{account_id}'"])

    broker = broker or resolve_broker(store, account_id)
    result = RefreshResult(account=account_id, broker=broker)
    if broker is None:
        result.errors.append(f"could not resolve a broker for account '{account_id}'")
        return result

    if broker in CSV_ONLY_BROKERS:
        result.csv_only = True
        result.last_imported = _last_imported(store, account_id)
        result.message = "re-import CSV to refresh"
        return result

    if broker not in CONNECTIONS:
        result.errors.append(f"broker '{broker}' is not a live API connection")
        return result

    broker_account = broker_account or resolve_broker_account(store, account_id, broker)
    if not broker_account:
        result.errors.append(
            f"no broker-side account number for '{account_id}' — import it once "
            "with --broker-account, or the broker listing did not match"
        )
        return result

    as_of = as_of or _dt.date.today().isoformat()
    result.as_of = as_of
    conn = get_connection(broker)()

    try:
        positions = conn.fetch_positions(broker_account)
    except (BrokerConnectionError, NotImplementedError) as e:
        result.errors.append(f"fetch_positions failed: {e}")
        return result

    lots, warnings = api_positions_to_lots(positions, account_id, as_of)

    # -- breakout: options + sleeves + CASH remainder (importer parity) --------
    quote_entries: dict[str, dict] = {}
    options_value = 0.0
    sleeves_value = 0.0
    portfolio: dict | None = None

    fetch_opts = getattr(conn, "fetch_option_positions", None)
    if fetch_opts is not None:
        try:
            option_positions = fetch_opts(broker_account)
            opt_lots, opt_quotes, _opt_warn, options_value = option_lots_and_quotes(
                option_positions, account_id, as_of)
            lots.extend(opt_lots)
            quote_entries.update(opt_quotes)
        except (BrokerConnectionError, NotImplementedError) as e:
            result.errors.append(f"fetch_option_positions failed: {e}")

    fetch_portfolio = getattr(conn, "fetch_portfolio", None)
    if fetch_portfolio is not None:
        try:
            portfolio = fetch_portfolio(broker_account)
        except (BrokerConnectionError, NotImplementedError) as e:
            result.errors.append(f"fetch_portfolio failed: {e}")

    if portfolio is not None:
        sleeve_lots, sleeve_quotes, _sl_warn, sleeves_value = sleeve_lots_and_quotes(
            portfolio, account_id, as_of)
        lots.extend(sleeve_lots)
        quote_entries.update(sleeve_quotes)
        cash_lot, _cash_warn = api_cash_lot(
            portfolio, positions, account_id, as_of,
            options_value=options_value, sleeves_value=sleeves_value)
        if cash_lot:
            lots.append(cash_lot)
            result.cash = cash_lot["shares"]

    if not lots:
        result.errors.append("broker returned no positions — nothing to write")
        return result

    # -- write: lots (replace THIS account ONLY), quotes, history (accumulate) --
    # ``mode="merge"`` is the store's per-account replace: it deletes only this
    # account's lots and inserts the fresh pull, KEEPING every other account's
    # lots. (``mode="replace"`` would swap the WHOLE lots set — wrong for a
    # single-account refresh.)
    store.upsert_lots([account_id], lots, mode="merge", now=now)
    if quote_entries:
        store.set_quotes(quote_entries, as_of=as_of)

    fetch_hist = getattr(conn, "fetch_history", None)
    if fetch_hist is not None:
        try:
            history_rows = fetch_hist(broker_account)
            for row in history_rows:
                row["account"] = account_id
            before = _history_count(store, account_id)
            store.upsert_history(account_id, history_rows, now=now)
            after = _history_count(store, account_id)
            result.new_transactions = max(after - before, 0)
        except (BrokerConnectionError, NotImplementedError) as e:
            result.errors.append(f"fetch_history failed: {e}")

    # -- lots count reported is the EQUITY position count (matches importer's
    # "positions" notion — options/sleeves/CASH are the breakout, not positions).
    result.positions = sum(1 for p in positions if p.get("symbol"))

    synced = _now_iso(now)
    store.set_meta(f"last_synced:{account_id}", synced)
    # Persist the broker + full account number so the next refresh needs no
    # live listing (and the accounts payload can expose the broker).
    store.set_meta(f"broker:{account_id}", broker)
    store.set_meta(f"broker_account:{account_id}", broker_account)
    return result


def _history_count(store: Store, account_id: str) -> int:
    return sum(1 for r in store.load_history() if r.get("account") == account_id)


def refresh_accounts(
    store: Store,
    account_id: str | None = None,
    *,
    now: _dt.datetime | None = None,
) -> list[RefreshResult]:
    """Refresh one account (``account_id``) or ALL API-broker accounts (when
    None). CSV-only and unresolved accounts yield result rows too (with a
    message or error) rather than being skipped silently. Runs synchronously."""
    accounts = store.load_accounts()
    known = {a.id for a in accounts}
    if account_id is not None:
        if account_id not in known:
            return [RefreshResult(account=account_id,
                                  errors=[f"unknown account '{account_id}'"])]
        targets = [account_id]
    else:
        # All accounts whose broker is a live API connection.
        targets = [
            a.id for a in accounts
            if (resolve_broker(store, a.id) in CONNECTIONS)
        ]
    return [refresh_account(store, aid, now=now) for aid in targets]
