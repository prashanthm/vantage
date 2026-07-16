"""REST surface for the SPA — reads are the norm; writes are deliberate.

Every GET route is read-only (ADR-010/ADR-014): the engine/quotes/journal
surface only ever reads. POST routes are the small deliberate set guarded by
tests/test_api.py's ALLOWED_WRITE_ROUTES — store-only writes (refresh, notes,
paper, journal, ...) plus EXACTLY ONE broker-order path: ``POST
/api/ticket/execute``, the ADR-010 v2 reclaim-ticket carve-out (dry-run
default, VANTAGE_LIVE_OK env gate, server-recomputed ticket — see its
handler). Every read broker connector still enforces read-only at the
transport layer (robinhood.py's READ_TOOLS allowlist); the execute path has
its own disjoint three-tool allowlist (brokers/robinhood_execution.py).

CORS allows http://localhost on any port — the SPA serves from :8642; this API
listens on :8641. GET and POST are the only allowed methods (POST solely for
/api/refresh); every other method answers 405.

Every payload carries {"as_of": ..., "source": "fixture"|"yfinance"} so the
client can always tell what data it is looking at.

Run: uvicorn vantage_server.api:app --port 8641   (or `make run-api`)
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from . import analyze
from . import bars_view
from . import engine
from .ml.roundtrips import summarize_rows as ml_summarize
from .models import QuoteSnapshot, to_jsonable
from .quotes import get_provider
from .refresh import refresh_accounts
from .signals import grade_signals
from .store import Dataset, Store

LOCALHOST_ORIGINS = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"


@dataclass
class AppState:
    store: Store
    dataset: Dataset

    def snapshot(self) -> QuoteSnapshot:
        # Provider resolved per call so VANTAGE_QUOTES flips without restart
        # and Stooq staleness is re-evaluated per request.
        return get_provider(self.store.data_dir).snapshot()


#: emoji + verb per coach event, for the Telegram message
_COACH_EVENT = {
    "TRIGGERED": "🔔 TRIGGER",
    "SCALE": "✂️ SCALE OUT",
    "ARMED": "⏳ ARMED",
    "TARGET": "✅ TARGET HIT",
    "STOPPED": "🛑 STOPPED",
}


def _num(v):
    """A JSON alert value → short number string, or None."""
    try:
        f = float(v)
        return f"{f:g}"
    except (TypeError, ValueError):
        return None


def _format_coach_alert(p: dict) -> str:
    """Render a coach webhook payload into a Telegram message. Handles both the
    rich alert() shape (headline/detail) and the alertcondition+plot shape
    (entry/target/stop/rr)."""
    sym = str(p.get("symbol") or "").upper()
    evt = str(p.get("event") or "").upper()
    head = _COACH_EVENT.get(evt, evt or "Coach alert")
    lines = [f"📊 {sym} COACH · {head}".rstrip(" ·")]
    # rich shape wins if present
    if p.get("headline"):
        lines.append(str(p["headline"]))
        if p.get("detail"):
            lines.append(str(p["detail"]))
        return "\n".join(lines)
    # plot shape: assemble entry → target · stop · R:R from whatever's present
    entry, tgt, stop, rr = (_num(p.get(k)) for k in ("entry", "target", "stop", "rr"))
    if entry:
        lines.append(f"entry {entry}" + (f" → target {tgt}" if tgt else ""))
    elif tgt:
        lines.append(f"target {tgt}")
    tail = " · ".join(x for x in (
        f"stop {stop}" if stop else None,
        f"R:R {rr}" if rr else None) if x)
    if tail:
        lines.append(tail)
    price = _num(p.get("price"))
    if price and not entry and not tgt:
        lines.append(f"at {price}")
    return "\n".join(lines)


def create_app(data_dir: str | os.PathLike[str] | None = None) -> FastAPI:
    store = Store(data_dir)
    state = AppState(store=store, dataset=store.load_dataset())
    ds = state.dataset

    app = FastAPI(
        title="Vantage backend",
        version="0.1.0",
        description="Deterministic cross-account portfolio engine — read-only (ADR-010).",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=LOCALHOST_ORIGINS,
        # GET for every read route; POST solely for the deliberate write set
        # guarded by ALLOWED_WRITE_ROUTES in tests/test_api.py.
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    def envelope(snap: QuoteSnapshot, **data):
        return {"as_of": snap.as_of, "source": snap.source, "stale": snap.stale, **data}

    def check_account(account: str) -> str:
        # Validate against the LIVE store (not the startup snapshot) so an
        # account created via the settings-page write surface is immediately
        # addressable by edit/delete/sync in the same session.
        if account != "all" and account not in {a.id for a in store.load_accounts()}:
            raise HTTPException(status_code=404, detail=f"unknown account '{account}'")
        return account

    @app.get("/api/health")
    def health():
        snap = state.snapshot()
        return envelope(snap, status="ok", data_dir=str(store.data_dir),
                        accounts=len(ds.accounts), lots=len(ds.lots))

    @app.get("/api/accounts")
    def accounts():
        # Reload from the store so a refresh's freshly-written lots/last_synced
        # are reflected without an API restart (the dataset captured at startup
        # is the fixture/offline baseline; the store is the live source).
        from .refresh import CONNECTIONS as _CONN, resolve_broker

        acct_rows = store.load_accounts()
        lots = store.load_lots()
        snap = state.snapshot()
        rows = []
        for a in acct_rows:
            broker = resolve_broker(store, a.id)
            rows.append({
                **to_jsonable(a),
                "value": engine.account_value(lots, snap.quotes, a.id),
                # last_synced from meta (SQLite only; None on JSON) so the UI can
                # show "synced 5m ago". Falls back to the account's last_sync.
                "last_synced": store.get_meta(f"last_synced:{a.id}") or a.last_sync,
                # Broker + whether refresh can pull it live (an API connection)
                # or only re-import CSV — the rail's ⟳ honesty depends on this.
                "broker": broker,
                "refreshable": broker in _CONN,
                # Connection auth state (API brokers only) + the one-time CLI
                # command to grant it. Secrets NEVER travel to the browser —
                # only the human-readable status + the command to run host-side.
                "auth_status": _account_auth_status(broker),
                "auth_hint": _account_auth_hint(broker),
            })
        return envelope(snap, accounts=rows)

    @app.get("/api/positions")
    def positions(account: str = Query("all")):
        check_account(account)
        snap = state.snapshot()
        rows = engine.positions(ds.lots, snap.quotes, account, accounts=ds.accounts)
        return envelope(snap, account=account, positions=to_jsonable(rows))

    @app.get("/api/allocation")
    def allocation(account: str = Query("all")):
        check_account(account)
        snap = state.snapshot()
        alloc = engine.allocation(ds.lots, snap.quotes, account, accounts=ds.accounts)
        by_class = {
            cls: {"value": v, "pct": (v / alloc.total * 100) if alloc.total else 0.0}
            for cls, v in alloc.by_class.items()
        }
        return envelope(snap, account=account, total=alloc.total, by_class=by_class,
                        by_currency=alloc.by_currency or {"USD": alloc.total},
                        currency=alloc.currency)

    @app.get("/api/lots")
    def lots(account: str = Query("all")):
        check_account(account)
        snap = state.snapshot()
        return envelope(snap, account=account,
                        lots=to_jsonable(engine.select_lots(ds.lots, account)))

    @app.get("/api/tax/wash")
    def tax_wash():
        snap = state.snapshot()
        today = engine.parse_as_of(snap.as_of)
        held = sorted({l.symbol for l in ds.lots if l.symbol != "CASH"})
        statuses = {
            sym: to_jsonable(
                engine.wash_status(
                    sym,
                    accounts=ds.accounts,
                    recent_buys=ds.recent_buys,
                    auto_buys=ds.auto_buys,
                    today=today,
                    lots=ds.lots,
                )
            )
            for sym in held
        }
        return envelope(snap, window_days=engine.WASH_WINDOW_DAYS, wash=statuses)

    @app.get("/api/tax/tlh")
    def tax_tlh(
        threshold_usd: float = Query(engine.DEFAULT_THRESHOLD_USD, alias="thresholdUsd", ge=0),
        threshold_pct: float = Query(engine.DEFAULT_THRESHOLD_PCT, alias="thresholdPct", ge=0),
    ):
        snap = state.snapshot()
        today = engine.parse_as_of(snap.as_of)
        cands = engine.tlh_candidates(
            ds.lots,
            snap.quotes,
            accounts=ds.accounts,
            recent_buys=ds.recent_buys,
            auto_buys=ds.auto_buys,
            partner_map=ds.partner_map,
            today=today,
            threshold_usd=threshold_usd,
            threshold_pct=threshold_pct,
        )
        return envelope(snap, threshold_usd=threshold_usd, threshold_pct=threshold_pct,
                        candidates=to_jsonable(cands))

    @app.get("/api/history")
    def history(account: str = Query("all"),
                limit: int = Query(200, ge=1, le=1000)):
        """Imported transaction history (importer --with-history), newest
        first. Read from history.json PER REQUEST (the file appears/changes
        when the operator imports; no restart needed); a missing file is an
        empty list — the SPA shows an empty state."""
        check_account(account)
        snap = state.snapshot()
        rows = store.load_history()
        if account != "all":
            rows = [r for r in rows if r.get("account") == account]
        return envelope(snap, account=account, history=rows[:limit])

    @app.get("/api/strategies")
    def strategies(account: str = Query("all"),
                   status: str = Query("all"),
                   by: str = Query("strategy")):
        """Options strategy roll-up (importer --with-strategies), read PER
        REQUEST from strategies.json (appears/changes on import; no restart).
        A missing file is an empty roll-up.

        ``by`` selects the view: the default "strategy" returns the open/closed
        strategy roll-up (``status`` filters open|closed|all); "ticker" returns
        the per-underlying POSITION BOOK (``by_ticker`` — every option leg of a
        ticker combined into one row regardless of expiry/strike, netting a
        diagonal's short credit into the long's cost). ``account`` filters open
        and by_ticker rows by their account id (closed rows carry no vantage
        account — they are masked broker-order rows — so an account filter
        narrows those away)."""
        check_account(account)
        if by not in {"strategy", "ticker"}:
            raise HTTPException(status_code=422,
                                detail="by must be one of strategy|ticker")
        if status not in {"all", "open", "closed"}:
            raise HTTPException(status_code=422,
                                detail="status must be one of all|open|closed")
        snap = state.snapshot()
        rollup = store.load_strategies()
        if by == "ticker":
            by_ticker_rows = rollup["by_ticker"]
            if account != "all":
                by_ticker_rows = [r for r in by_ticker_rows
                                  if r.get("account") == account]
            return envelope(snap, account=account,
                            strategies_as_of=rollup["as_of"],
                            by_ticker=by_ticker_rows)
        open_rows = rollup["open"]
        closed_rows = rollup["closed"]
        if account != "all":
            open_rows = [r for r in open_rows if r.get("account") == account]
            closed_rows = []  # closed rows have no vantage account id
        if status == "open":
            closed_rows = []
        elif status == "closed":
            open_rows = []
        return envelope(snap, account=account, status=status,
                        strategies_as_of=rollup["as_of"],
                        open=open_rows, closed=closed_rows)

    @app.get("/api/analysis")
    def analysis(date: str | None = Query(None),
                 symbol: str | None = Query(None)):
        """The nightly decision journal (written by `python -m
        vantage_server.analyze`), read via store.load_analysis_day (SQLite-aware; JSON fallback)
        (or latest.json when no date). Optional ``date`` (YYYY-MM-DD) selects a
        day; ``symbol`` narrows to that underlying. A missing journal is an
        empty state (decisions: [])."""
        snap = state.snapshot()
        day = store.load_analysis_day(date)
        decisions = (day or {}).get("decisions", [])
        if symbol:
            want = symbol.upper()
            decisions = [d for d in decisions if str(d.get("symbol", "")).upper() == want]
        return envelope(snap, date=(day or {}).get("as_of", date),
                        generated_at=(day or {}).get("generated_at"),
                        symbol=symbol, decisions=decisions)

    @app.get("/api/analysis/history")
    def analysis_history(symbol: str = Query(...)):
        """The decision trail for one underlying across ALL journaled days,
        newest first — the record Mira reads to explain how a position's
        recommendation evolved. Empty when the symbol has never been journaled."""
        snap = state.snapshot()
        trail = store.load_analysis_symbol_history(symbol)
        return envelope(snap, symbol=symbol.upper(), history=trail)

    @app.get("/api/spx/playbook")
    def spx_playbook(date: str | None = Query(None),
                     symbol: str = Query("SPX")):
        """The daily 0DTE playbook for ``symbol`` (SPX|QQQ|IWM; written by `python
        -m vantage_server.spx_playbook --symbol`, fusing that underlying's GEX with
        its 15m chart dimensions). ``{scaffold, narrative, session, date}`` —
        latest when no date. Empty state (available:false) when nothing generated.
        Context, not a signal (ADR-008); places no orders."""
        snap = state.snapshot()
        sym = (symbol or "SPX").upper()
        row = store.load_spx_playbook(date, symbol=sym)
        if row is None:
            return envelope(snap, available=False,
                            note=f"No {sym} playbook generated yet — run "
                                 f"`python -m vantage_server.spx_playbook --symbol {sym}`.")
        return envelope(snap, available=True, date=row["date"], session=row["session"],
                        symbol=sym, scaffold=row["scaffold"], narrative=row["narrative"])

    @app.get("/api/spx/playbook/pine")
    def spx_playbook_pine(date: str | None = Query(None),
                          symbol: str = Query("SPX")):
        """The 0DTE playbook for ``symbol`` as a copy-paste TradingView Pine v5
        indicator: every level marked, setup zones shaded, conditional buy/sell
        arrows keyed to the gamma-flip regime. Rendered from the stored scaffold
        (latest when no date). Context, not a signal (ADR-008)."""
        from . import playbook_pine
        snap = state.snapshot()
        sym = (symbol or "SPX").upper()
        row = store.load_spx_playbook(date, symbol=sym)
        if row is None:
            return envelope(snap, available=False,
                            note=f"No {sym} playbook generated yet.")
        script = playbook_pine.build_playbook_pine(row["scaffold"] or {})
        return envelope(snap, available=bool(script), date=row["date"],
                        session=row["session"], script=script)

    @app.get("/api/spx/reclaim/pine")
    def spx_reclaim_pine(date: str | None = Query(None),
                         symbol: str = Query("SPX")):
        """The reclaim strategy as a PREFILLED TradingView indicator for
        ``symbol``: the symbol's current GEX levels (from the stored playbook
        scaffold) are baked into the GEX-levels input, so it fires ONLY on
        reclaims of those lines with no daily paste. Regenerate when the GEX
        levels move (0DTE: each session). A symbol without options gamma yields
        no baked levels and the script falls back to live pivots. Context, not a
        signal (ADR-008)."""
        from . import reclaim_pine
        snap = state.snapshot()
        sym = (symbol or "SPX").upper()
        row = store.load_spx_playbook(date, symbol=sym)
        if row is None:
            return envelope(snap, available=False,
                            note=f"No {sym} playbook generated yet — needed for "
                                 f"the GEX levels to prefill.")
        scaffold = row["scaffold"] or {}
        script = reclaim_pine.build_reclaim_indicator_for(sym, scaffold)
        levels = reclaim_pine.gex_levels_from_scaffold(scaffold)
        return envelope(snap, available=bool(script), date=row["date"],
                        session=row["session"], symbol=sym,
                        gex_levels=levels, prefilled=bool(levels), script=script)

    @app.get("/api/spx/coach/pine")
    def spx_coach_pine(date: str | None = Query(None),
                       symbol: str = Query("SPX")):
        """The COACH indicator — a live TradingView discipline coach with the
        session's GEX + pivot levels BAKED from the stored playbook. Tracks
        session VWAP / volume / RSI and flashes WAIT / ENTER / EXIT / HOLD /
        WARN, warning on the operator's documented leaks (front-run, wrong-side,
        extended, knife). Regenerate each session as the levels move. Context,
        not a signal (ADR-008); levels are the 0DTE-blind nightly estimate."""
        from . import coach_pine
        from . import signal_bot
        snap = state.snapshot()
        sym = (symbol or "SPX").upper()
        row = store.load_spx_playbook(date, symbol=sym)
        if row is None:
            return envelope(snap, available=False,
                            note=f"No {sym} playbook generated yet — needed for "
                                 f"the coach's baked levels.")
        scaffold = row["scaffold"] or {}
        secret = signal_bot.webhook_secret(store) or ""
        script = coach_pine.build_coach_indicator(scaffold, webhook_secret=secret)
        return envelope(snap, available=bool(script), date=row["date"],
                        session=row["session"], symbol=sym, script=script,
                        webhook_configured=bool(secret))

    def _stage_reclaim_ticket(symbol: str, side: str, level: float,
                              risk: float, date: str | None,
                              entry: float | None = None):
        """Build the staged reclaim ticket ALL ticket surfaces share — the GET
        preview and the execute route recompute through here, so what executes
        is byte-for-byte what was previewed (and client-supplied prices can
        never reach the broker). Returns (ticket, extras) or (None, note)."""
        from . import order_ticket as _ot
        from . import reclaim_pine
        sym = (symbol or "").upper()
        sd = (side or "").lower()
        if sd not in ("long", "short") or not sym or level <= 0:
            return None, "need symbol, side=long|short, level>0"
        row = store.load_spx_playbook(date, symbol=sym)
        scaffold = (row or {}).get("scaffold") or {}
        levels = reclaim_pine.gex_levels_from_scaffold(scaffold) if row else []
        supports = [v for v in levels if v < level]
        resistances = [v for v in levels if v > level]

        # indexes aren't buyable — stage the ticket in the proxy ETF, rescaled
        ticket_sym, derived, lvl = sym, None, float(level)
        proxy = _ot.proxy_for(sym)
        if proxy:
            index_spot = (scaffold.get("regime") or {}).get("spot")
            proxy_last = None
            try:
                from .quotes import _yf_fetch
                got = _yf_fetch([proxy])
                proxy_last = got.get(proxy, (None, None))[0]
            except Exception:
                proxy_last = None
            if not index_spot or not proxy_last:
                return None, (f"{sym} is an index (not directly buyable); "
                              f"couldn't price the {proxy} proxy to rescale "
                              f"(index_spot={index_spot}, "
                              f"proxy_last={proxy_last}). Retry, or pass "
                              f"symbol={proxy} with {proxy}-terms levels.")
            ratio = float(proxy_last) / float(index_spot)
            supports = _ot.rescale(supports, ratio)
            resistances = _ot.rescale(resistances, ratio)
            lvl = lvl * ratio
            ticket_sym = proxy
            derived = {"index": sym, "index_level": float(level),
                       "ratio": ratio, "proxy_last": float(proxy_last),
                       "index_spot": float(index_spot)}

        # a FIRED signal fills at the reclaim close, not at the level — price
        # the ticket from there so the order IS the trade the signal promised
        entry_scaled = (float(entry) * ratio if (entry and proxy)
                        else (float(entry) if entry else None))
        ticket = _ot.build_ticket(ticket_sym, sd, lvl, supports, resistances,
                                  risk_amount=risk, derived_from=derived,
                                  entry=entry_scaled)
        extras = {
            "text": _ot.render_ticket(ticket),
            "levels_source": ("playbook" if levels else "none — targets empty; "
                              "pass a symbol with a generated playbook for the "
                              "ladder"),
        }
        return ticket, extras

    @app.get("/api/ticket")
    def order_ticket(symbol: str = Query(...),
                     side: str = Query(...),
                     level: float = Query(...),
                     risk: float = Query(100.0),
                     date: str | None = Query(None),
                     entry: float | None = Query(None)):
        """A STAGED order ticket for a reclaim trade at ``level``: entry/stop
        from the shared reclaim spec, target ladder from the symbol's playbook
        levels, risk-based qty, per-leg scale-out — plus a copy-paste text
        block. An INDEX symbol (SPX/NDX/RUT — not directly buyable) is staged
        in its tradeable proxy ETF (SPY/QQQ/IWM) with every price rescaled by
        the live proxy/index ratio; the ticket records the mapping. Staging
        only — submission is the separate, gated POST /api/ticket/execute
        (ADR-010 v2). ``risk`` = max loss at the stop."""
        snap = state.snapshot()
        ticket, extras = _stage_reclaim_ticket(symbol, side, level, risk, date, entry)
        if ticket is None:
            return envelope(snap, available=False, note=extras)
        return envelope(snap, available=True, ticket=ticket, **extras)

    @app.post("/api/ticket/execute")
    def order_ticket_execute(body: dict = Body(default={})):
        """THE ADR-010 v2 execution carve-out: recompute the staged reclaim
        ticket server-side (same path as GET /api/ticket — client prices are
        never trusted) and submit it to Robinhood as entry + stop + target
        orders via brokers/robinhood_execution.py.

        Body: ``{symbol, side, level, risk?, date?, account_number, live?}``.
        Dry-run by default: ``live: true`` additionally requires the operator
        env ``VANTAGE_LIVE_OK=1`` or the call is refused. Robinhood only;
        reclaim tickets only; operator-initiated only (not exposed to the MCP
        advisor surface)."""
        from .brokers import robinhood_execution as _exec
        snap = state.snapshot()
        ticket, extras = _stage_reclaim_ticket(
            str(body.get("symbol") or ""), str(body.get("side") or ""),
            float(body.get("level") or 0), float(body.get("risk") or 100.0),
            body.get("date"),
            float(body["entry"]) if body.get("entry") else None)
        if ticket is None:
            return envelope(snap, available=False, note=extras)
        account = str(body.get("account_number") or "")
        try:
            sig = body.get("signal_paper_id")
            result = _exec.execute_ticket(
                ticket, account, live=bool(body.get("live")),
                exit_policy=str(body.get("exit_policy") or "ladder"),
                store=store if store.uses_sqlite else None,
                signal_paper_id=int(sig) if sig else None)
        except (ValueError, _exec.ExecutionViolation) as e:
            return envelope(snap, available=False, note=str(e), ticket=ticket)
        return envelope(snap, available=True, ticket=ticket,
                        execution=result, **extras)

    @app.get("/api/reclaim-bot/status")
    def reclaim_bot_status():
        """The signal bot's config + what it is tracking: telegram wiring,
        auto-opened paper trades (pending = armed levels, filled = live
        signals), and the session they belong to. Read-only."""
        from . import signal_bot
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="signal bot needs the SQLite backend")
        auto = [t for t in store.load_paper_trades()
                if t.get("source") == "auto"]
        open_auto = [t for t in auto if t["status"] == "open"]
        token, chat, source = signal_bot.telegram_creds(store)
        return envelope(snap, available=True,
                        telegram=signal_bot.telegram_configured(store),
                        telegram_source=source,
                        # masked: enough to recognize, never enough to use
                        telegram_token_tail=(token[-4:] if token else None),
                        telegram_chat_id=chat,
                        market_open=signal_bot.market_open_now(),
                        armed=[t for t in open_auto
                               if (t.get("fill_status") or "") == "pending"],
                        live_signals=[t for t in open_auto
                                      if (t.get("fill_status") or "") == "filled"],
                        closed_count=len([t for t in auto if t["status"] == "closed"]))

    @app.post("/api/reclaim-bot/config")
    def reclaim_bot_config(body: dict = Body(default={})):
        """Save the bot's Telegram credentials to OUR store's meta table
        (UI-managed; container env still wins when set) and optionally send a
        test message. Body: ``{bot_token?, chat_id?, test?}`` — empty string
        clears a value. Token is never echoed back."""
        from . import signal_bot
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="signal bot needs the SQLite backend")
        if "bot_token" in body:
            store.set_meta(signal_bot.TOKEN_META, str(body["bot_token"] or ""))
        if "chat_id" in body:
            store.set_meta(signal_bot.CHAT_META, str(body["chat_id"] or ""))
        token, chat, source = signal_bot.telegram_creds(store)
        tested = None
        if body.get("test"):
            tested = signal_bot.send_telegram(
                "🔧 Vantage reclaim bot: test message — wiring works.", store)
        return envelope(snap, available=True, telegram_source=source,
                        telegram_token_tail=(token[-4:] if token else None),
                        telegram_chat_id=chat, test_sent=tested)

    @app.post("/api/reclaim-bot/webhook-secret")
    def reclaim_bot_webhook_secret(body: dict = Body(default={})):
        """Set the shared secret that the coach's TradingView alerts must carry.
        Baked into the coach Pine (regenerate it after changing) and validated by
        /webhook/tradingview. Body: ``{secret}`` — empty string clears it."""
        from . import signal_bot
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="webhook secret needs the SQLite backend")
        if "secret" in body:
            store.set_meta(signal_bot.WEBHOOK_SECRET_META, str(body["secret"] or ""))
        cur = signal_bot.webhook_secret(store)
        return envelope(snap, available=True, configured=bool(cur),
                        secret_tail=(cur[-4:] if cur else None))

    @app.post("/webhook/tradingview")
    async def tradingview_webhook(request: Request):
        """Inbound TradingView alert → Telegram. TradingView can't send auth
        headers, so the coach bakes a shared SECRET into the alert JSON body;
        this endpoint validates it and forwards a formatted message to Telegram.

        Two body shapes, both JSON, both secret-gated:
          * rich alert() (paid TV plans): {secret, event, symbol, headline,
            detail, price}
          * per-event alertcondition (free plans, values via {{plot(...)}}):
            {secret, event, symbol, entry, target, stop, rr, price}
        A plain non-JSON body is also accepted when no secret is configured."""
        from . import signal_bot
        raw = (await request.body()).decode("utf-8", "replace").strip()
        want = signal_bot.webhook_secret(store)
        payload = None
        try:
            payload = json.loads(raw)
        except Exception:
            payload = None
        # secret gate — if we have a secret configured, the body MUST match it
        if want:
            got = (payload or {}).get("secret") if isinstance(payload, dict) else None
            if got != want:
                raise HTTPException(status_code=401, detail="bad or missing secret")
        # build the Telegram text
        if isinstance(payload, dict):
            text = _format_coach_alert(payload)
        else:
            text = f"📊 Coach alert\n{raw[:600]}" if raw else "📊 Coach alert (empty)"
        sent = signal_bot.send_telegram(text, store)
        return JSONResponse({"ok": True, "forwarded": bool(sent)})

    @app.post("/api/nightly/record")
    def nightly_record(body: dict = Body(default={})):
        """Store one nightly pipeline snapshot ({started_at, finished_at,
        variant, jobs: [{job, ok, duration_sec, tail}]}) — posted by
        nightly-docker.sh's run() collector. Writes only our own SQLite."""
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required")
        jobs = body.get("jobs")
        if not isinstance(jobs, list) or not jobs:
            return envelope(snap, available=False, note="jobs list required")
        rid = store.record_nightly_run({
            "started_at": str(body.get("started_at") or ""),
            "finished_at": str(body.get("finished_at") or ""),
            "variant": str(body.get("variant") or "docker"),
            "jobs": [{"job": str(j.get("job") or "?"), "ok": bool(j.get("ok")),
                      "duration_sec": int(j.get("duration_sec") or 0),
                      "tail": str(j.get("tail") or "")[:2000]}
                     for j in jobs if isinstance(j, dict)],
        })
        return envelope(snap, available=True, run_id=rid)

    @app.get("/api/nightly/status")
    def nightly_status(limit: int = Query(1)):
        """The latest nightly pipeline snapshot(s): per-job ok/duration/tail.
        Read-only; the Signal Bot view renders the most recent run."""
        snap = state.snapshot()
        runs = store.load_nightly_runs(max(1, min(int(limit), 30)))
        return envelope(snap, available=bool(runs), runs=runs)

    @app.post("/api/reclaim-bot/nightly-report")
    def reclaim_bot_nightly_report(body: dict = Body(default={})):
        """Build + push the 🌙 nightly digest (playbook freshness, today's
        signal outcomes, open book). Called by nightly-docker.sh after the
        EOD pipeline; an optional ``note`` (e.g. the pipeline's failure
        tail) is appended so problems reach the phone too. Outbound
        notification only — no broker path."""
        from . import signal_bot
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="signal bot needs the SQLite backend")
        text = signal_bot.nightly_report(store)
        extra = str(body.get("note") or "").strip()
        if extra:
            text = f"{text}\n{extra}"
        sent = signal_bot.send_telegram(text, store)
        return envelope(snap, available=True, text=text, sent=sent)

    @app.get("/api/reclaim-bot/performance")
    def reclaim_bot_performance():
        """The signal↔live correlation: every bot signal beside its paper
        outcome and (when taken) the live execution's outcome, plus a
        summary. Read-only."""
        from . import signal_bot
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="signal bot needs the SQLite backend")
        return envelope(snap, available=True, **signal_bot.performance(store))

    @app.post("/api/reclaim-bot/poll")
    def reclaim_bot_poll():
        """ONE signal-bot pass: arm today's reclaim tickets as auto paper
        trades, advance the paper pipeline, push Telegram on transitions.
        Writes only our own SQLite + the outbound notification — no broker
        path (ADR-010 untouched). The continuous loop is
        ``python -m vantage_server.signal_bot``."""
        from . import signal_bot
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="signal bot needs the SQLite backend")
        events = signal_bot.poll(store)
        return envelope(snap, available=True, events=events,
                        telegram=signal_bot.telegram_configured(store))

    @app.get("/api/exits")
    def exits_list(status: str | None = Query(None), merge_broker: bool = Query(False)):
        """Managed-exit positions (ADR-010 v3): what the exit monitor is
        holding, protecting, and has closed. Read-only.

        ``merge_broker=1`` also returns the account's ACTUAL broker positions
        with a ``managed`` flag — so the book shows what you really hold, not
        only what the bot opened. An unmanaged position has no monitor stop:
        that is exactly the thing worth seeing."""
        from .brokers import robinhood_execution as _exec
        snap = state.snapshot()
        managed = store.load_managed_positions(status)
        payload = {"positions": managed, "live_gate": _exec.live_allowed()}
        if merge_broker:
            payload["broker"] = _broker_positions(managed)
        return envelope(snap, **payload)

    def _broker_positions(managed: list[dict]) -> list[dict]:
        """Live broker positions, each flagged with whether the exit monitor
        is managing it. Best-effort: a broker/auth failure yields [] with a
        note rather than breaking the view (read-only path — ADR-010)."""
        from . import engine
        by_symbol = {m["symbol"]: m for m in managed
                     if m["status"] in ("active", "pending_entry")}
        out = []
        try:
            snap = state.snapshot()
            for p in engine.positions(ds.lots, snap.quotes, accounts=ds.accounts):
                d = to_jsonable(p)
                sym = d.get("symbol")
                m = by_symbol.get(sym)
                d["managed"] = bool(m)
                d["managed_id"] = m["id"] if m else None
                d["stop_price"] = m.get("stop_price") if m else None
                out.append(d)
        except Exception as e:            # never break the book on a data hiccup
            return []
        return out

    @app.get("/api/positions/tradeable")
    def positions_tradeable(symbols: str = Query("SPY,QQQ,IWM")):
        """The positions that matter WHILE TRADING: the reclaim proxies you
        actually hold right now (shares, cost, live value, P&L), each flagged
        with whether the exit monitor is protecting it. Powers the Today
        view's positions card. Read-only."""
        snap = state.snapshot()
        want = {s.strip().upper() for s in (symbols or "").split(",") if s.strip()}
        managed = store.load_managed_positions("open")
        rows = [p for p in _broker_positions(managed)
                if (p.get("symbol") or "").upper() in want and (p.get("shares") or 0) != 0]
        return envelope(snap, positions=rows,
                        unprotected=[p["symbol"] for p in rows if not p["managed"]])

    @app.post("/api/exits/tick")
    def exits_tick():
        """Run ONE exit-monitor pass now (ADR-010 v3 exits-only automation:
        re-arm stops, detect fills, ladder target swaps, trailing ratchets —
        can only ever reduce or close carve-out positions). The continuous
        loop is ``python -m vantage_server.execution_monitor``; this route
        lets the operator (or an external cron) drive the same pass."""
        from . import execution_monitor
        snap = state.snapshot()
        if not store.uses_sqlite:
            return envelope(snap, available=False,
                            note="managed exits need the SQLite backend")
        actions = execution_monitor.tick(store)
        return envelope(snap, available=True, actions=actions)

    @app.post("/api/exits/{pos_id}/disarm")
    def exits_disarm(pos_id: int):
        """Stop managing one position. The broker-side stop is LEFT RESTING
        (disarm never removes protection); the row just leaves the monitor's
        control. Manual cleanup of the resting order is the operator's."""
        snap = state.snapshot()
        import datetime as _dtmod
        ok = store.update_managed_position(
            pos_id, status="disarmed",
            closed_at=_dtmod.datetime.now(_dtmod.timezone.utc).isoformat(),
            exit_reason="disarmed")
        return envelope(snap, available=ok,
                        note=None if ok else f"no managed position {pos_id}")

    @app.post("/api/spx/playbook/recompute")
    def spx_playbook_recompute(body: dict = Body(default={})):
        """Regenerate the playbook NOW for the requested ``symbol`` (SPX|QQQ|IWM)
        from the latest data, outside the nightly job. Writes ONLY our own store
        (no broker / fund path — ADR-010 holds; no disk .pine files — the Pine
        is served as text via /pine and /reclaim/pine for the UI to copy).
        Returns the new ``{scaffold, session, date}``. Body: ``{as_of?:
        'YYYY-MM-DD', symbol?: 'SPX'}``."""
        import datetime as _dt
        from . import spx_playbook as _pb
        as_of = (body or {}).get("as_of")
        sym = ((body or {}).get("symbol") or "SPX").upper()
        # None → build_playbook's ET-clock default (session labeling must not
        # come from the container date — a pre-close run serves TODAY's session)
        today = _dt.date.fromisoformat(as_of) if as_of else None
        scaffold = _pb.build_playbook(today, store=store, underlying=sym)
        store.upsert_spx_playbook(scaffold["generated_for"], scaffold, symbol=sym)
        snap = state.snapshot()
        return envelope(snap, available=True, date=scaffold["generated_for"],
                        symbol=sym, session=scaffold["session"], scaffold=scaffold)

    @app.get("/api/futures/analysis")
    def futures_analysis(contract: str | None = Query(None),
                         alignment: bool = Query(True)):
        """Win-rate analysis of imported AMP futures executions: round-trips
        paired from fills, win-rate-by-condition (exit type / hold time / entry
        hour ET / playbook alignment) via the Bayesian bucketing engine, order
        behavior (cancel rate), and a RECONCILIATION vs the broker's realized PnL
        that flags partial/windowed data. Empty state when nothing imported.
        Decision-support (ADR-008); reads the user's CSV import, no broker path."""
        from . import futures as _fut
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False) or not store.load_futures_fills(contract):
            return envelope(snap, available=False,
                            note="No AMP futures fills imported — run "
                                 "`python -m vantage_server.futures --import ampfutures` "
                                 "or POST /api/futures/import.")
        analysis = _fut.analysis_from_store(store, contract=contract,
                                            with_alignment=alignment)
        # forward projection: today's ETF 0DTE levels rescaled into this contract's
        # futures points (NQ<-QQQ, RTY<-IWM). Reference/context only (ADR-010).
        from . import futures_projection as _fp
        proj_contract = (contract or "NQ").upper()
        projection = _fp.project_for_store(store, proj_contract)
        return envelope(snap, available=True, contract=contract,
                        projection=projection, **analysis)

    @app.post("/api/futures/import")
    def futures_import(body: dict = Body(default={})):
        """(Re)import AMP futures CSVs from ``<data-dir>/<subdir>`` (default
        'ampfutures') into the store, then return the fresh analysis. Writes only
        our SQLite (no broker/order path — ADR-010). Optional
        ``{subdir, account, alignment}``."""
        from . import futures as _fut
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="Futures import requires the SQLite backend.")
        subdir = (body or {}).get("subdir", "ampfutures")
        account = (body or {}).get("account", "ampfutures")
        base = os.path.join(str(store.data_dir), subdir)
        if not os.path.isdir(base):
            return envelope(snap, available=False, note=f"Import dir not found: {base}")
        res = _fut.import_and_store(store, base, account=account)
        analysis = _fut.analysis_from_store(
            store, with_alignment=bool((body or {}).get("alignment", True)))
        return envelope(snap, available=True, imported=res, **analysis)

    @app.get("/api/paper")
    def paper_view(symbol: str = Query("SPX")):
        """Paper-trading tracker for the 0DTE playbook (no money, no orders — a
        simulation for learning + strategy validation), for ``symbol`` (SPX|QQQ|
        IWM). Returns today's tickets (from that underlying's latest playbook),
        open positions, the closed track record + stats. ADR-010: no orders."""
        from . import paper as _paper
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False,
                            note="Paper trading requires the SQLite backend.")
        sym = (symbol or "SPX").upper()
        row = store.load_spx_playbook(symbol=sym)
        scaffold = (row or {}).get("scaffold") if row else None
        view = _paper.build_analysis(store, scaffold, underlying=sym)
        return envelope(snap, available=True, session=(row or {}).get("session"),
                        **view)

    @app.post("/api/paper/open")
    def paper_open(body: dict = Body(default={})):
        """Log a paper trade from a ticket (no real order — ADR-010). Body is the
        ticket dict (side/spy_entry/spy_target/spy_stop/shares/underlying/...)."""
        from . import paper as _paper
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        ticket = body or {}
        if not ticket.get("side") or ticket.get("spy_entry") is None:
            return envelope(snap, available=False, note="ticket needs side + spy_entry")
        sym = (ticket.get("underlying") or "SPX").upper()
        row = store.load_spx_playbook(symbol=sym)
        tid = _paper.open_paper_trade(store, ticket,
                                      session=(row or {}).get("session"), source="manual")
        return envelope(snap, available=True, opened_id=tid,
                        **_paper.build_analysis(store, (row or {}).get("scaffold") if row else None,
                                                underlying=sym))

    @app.post("/api/paper/settle")
    def paper_settle(body: dict = Body(default={})):
        """Auto-close open paper trades that hit target/stop (checks each proxy's
        bars). Writes only our store; no broker path (ADR-010)."""
        from . import paper as _paper
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        res = _paper.settle_open(store)
        sym = ((body or {}).get("symbol") or "SPX").upper()
        row = store.load_spx_playbook(symbol=sym)
        return envelope(snap, available=True, settled=res,
                        **_paper.build_analysis(store, (row or {}).get("scaffold") if row else None,
                                                underlying=sym))

    @app.post("/api/paper/close")
    def paper_close(body: dict = Body(default={})):
        """Manually close an open paper trade at the current proxy price."""
        from . import paper as _paper
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        tid = (body or {}).get("id")
        spy_exit = (body or {}).get("spy_exit")
        if tid is None or spy_exit is None:
            return envelope(snap, available=False, note="need id + spy_exit")
        ok = _paper.close_manually(store, int(tid), float(spy_exit))
        sym = ((body or {}).get("symbol") or "SPX").upper()
        row = store.load_spx_playbook(symbol=sym)
        return envelope(snap, available=True, closed=ok,
                        **_paper.build_analysis(store, (row or {}).get("scaffold") if row else None,
                                                underlying=sym))

    @app.get("/api/journal")
    def journal_view(symbol: str | None = Query(None)):
        """The chart-snapshot journal for ``symbol`` (SPX|QQQ|IWM; all when
        omitted): each saved chart (metadata + the forecast live when captured +
        the forecast-vs-outcome scorecard) and the running accuracy. Image bytes
        served via /api/journal/image/{id}. Journal/analysis only (ADR-010)."""
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        sym = symbol.upper() if symbol else None
        return envelope(snap, available=True, **_j.build_journal(store, sym))

    @app.post("/api/journal/upload")
    async def journal_upload(image: UploadFile = File(default=None),
                             note: str = Form(""),
                             symbol: str = Form("SPX"),
                             forecast_kind: str = Form("prior"),
                             attach_to: str = Form("")):
        """Attach a reference chart to a journal entry. With ``attach_to`` set to a
        snapshot id, the image is attached to THAT existing entry (the normal path:
        drop today's chart onto today's auto-created row) — no new entry. Without
        it, a NEW entry is created, freezing a playbook forecast: ``forecast_kind``
        ``'prior'`` (default) pins LAST NIGHT'S forecast, ``'live'`` pins today's.
        The image is reference only — never analyzed. Store/disk-only (ADR-010)."""
        import datetime as _dt
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        now = _dt.datetime.now(_dt.timezone.utc).astimezone()
        today = now.date().isoformat()
        # write the reference image (optional)
        fname = mime = None
        if image is not None:
            data = await image.read()
            if data:
                jdir = _j.journal_dir(store.data_dir)
                ext = os.path.splitext(image.filename or "")[1].lower() or ".png"
                fname = f"{now.strftime('%Y%m%dT%H%M%S')}_{int(now.timestamp())}{ext}"
                (jdir / fname).write_bytes(data)
                mime = image.content_type or "image/png"

        # attach to an existing entry (today's row) rather than create a new one
        if attach_to:
            row = store.load_journal_snapshot(int(attach_to))
            if not row:
                return envelope(snap, available=False, note="entry not found")
            if fname:
                # drop the old image file if it's being replaced
                old = row.get("image_path")
                if old:
                    try:
                        (_j.journal_dir(store.data_dir) / old).unlink(missing_ok=True)
                    except OSError:
                        pass
                store.update_journal_image(int(attach_to), fname, mime)
            return envelope(snap, available=True, id=int(attach_to),
                            **_j.build_journal(store, (row.get("symbol") or "SPX")))

        # otherwise: a fresh entry freezing the chosen forecast (prior by default)
        sym = (symbol or "SPX").upper()
        scaffold, forecast, resolved = _j.pick_forecast(
            store, today, "live" if forecast_kind == "live" else "prior", sym)
        sid = store.record_journal_snapshot({
            "created_at": now.isoformat(),
            "session": forecast.get("session") or (scaffold.get("session")),
            "symbol": sym, "image_path": fname,
            "image_mime": mime, "note": note,
            "spot_at_snap": (scaffold.get("regime") or {}).get("spot"),
            "forecast": forecast, "forecast_kind": resolved,
        })
        return envelope(snap, available=True, id=sid, **_j.build_journal(store, sym))

    @app.post("/api/journal/ensure_today")
    def journal_ensure_today(body: dict = Body(default={})):
        """Ensure today's journal entry exists for the requested underlying, or for
        ALL of them (SPX/QQQ/IWM) when no ``symbol`` is given — auto-create freezing
        last night's forecast (idempotent, one per underlying per day) and re-score
        against live price. The Journal page calls this on open. ADR-010."""
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        sym = ((body or {}).get("symbol") or "").upper() or None
        if sym:
            res = _j.ensure_today_entry(store, sym)
        else:
            res = _j.ensure_all_underlyings(store)
        return envelope(snap, available=True, ensured=res,
                        **_j.build_journal(store, sym))

    @app.get("/api/journal/activity")
    def journal_activity(day: str | None = Query(None),
                         underlying: str | None = Query(None)):
        """Your session as TRADES (decisions), not fills: multi-leg orders
        grouped into one trade, 0DTEs left to expire settled against the print
        (money that appears in NO fill), and each trade stamped with its
        underlying's price at entry plus the forecast level it was taken
        against. Omit ``underlying`` (or pass 'all') for EVERY ticker traded
        that day, each correlated to its own playbook; pass one (e.g. SPX,
        catches SPXW) to filter. ``tickers`` lists everything traded.

        This is the FACTUAL half of a journal entry; the operator writes the
        thinking. Read-only."""
        import datetime as _dtmod
        from . import session_activity as _sa
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        d = day or _dtmod.date.today().isoformat()
        # None / 'all' → every ticker; a specific symbol → filter to it
        act = _sa.session(store, d, underlying)
        return envelope(snap, available=bool(act["trades"]), **act)

    @app.get("/api/journal/coach-backtest")
    def journal_coach_backtest(day: str = Query(...),
                               underlying: str = Query("SPX")):
        """Replay the coach's rules against ``day``'s trades: per-trade WARN/
        ENTER/WAIT + a tally of whether WARN aligned with losses (i.e. would
        heeding it have helped). Approximation of the live indicator — read the
        deltas, not the last dollar. Read-only."""
        from . import coach_backtest as _cb
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        return envelope(snap, **_cb.backtest(store, day, (underlying or "SPX").upper()))

    @app.get("/api/journal/day-pnl")
    def journal_day_pnl(days: str = Query(...),
                        underlying: str | None = Query(None)):
        """Realized P&L per day for a comma-separated list of dates — cheap
        (fills only, no bars) so the day strip can tint each pill by outcome.
        Omit ``underlying`` (or 'all') to sum EVERY ticker; pass one to filter.
        Returns {day: {realized, trades, has_fills}}. Read-only."""
        from . import session_activity as _sa
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        want = [d.strip() for d in (days or "").split(",") if d.strip()][:40]
        return envelope(snap, available=True,
                        pnl=_sa.day_pnl_range(store, want, underlying))

    @app.get("/api/journal/trade-dna")
    def journal_trade_dna(day: str = Query(...), trade: int = Query(...),
                          underlying: str = Query("SPX")):
        """The full DNA of one trade (step 1 of trade analysis, pure data):
        the ±5-bar price action around entry AND exit with volume, technicals
        (VWAP/ATR/RSI/rel-vol) at each fill, the entry/exit level correlation,
        and the forecast it was taken against. Resolution follows the
        timeframe — 1-minute for a 0DTE, 15-minute for a swing (labelled when
        1m is unavailable). ``trade`` is the index into the day's FULL
        (all-ticker) session-activity trade list — the same list the journal
        shows; the trade's own ticker drives its DNA. Read-only."""
        from . import session_activity as _sa
        from . import trade_dna as _dna
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        # index into the ALL-ticker session (what the UI indexes into) — a
        # per-ticker fetch re-indexed and put every non-primary trade out of
        # range (live: MU trade 10 in a 16-trade day fetched as 'day has 1').
        sess = _sa.session(store, day, None)
        trades = sess.get("trades") or []
        if trade < 0 or trade >= len(trades):
            return envelope(snap, available=False,
                            note=f"trade {trade} out of range (day has {len(trades)})")
        t = trades[trade]
        # the trade carries its own ticker; correlation is already per-ticker in
        # session(), so t.correlation/exit_correlation frame the DNA correctly.
        tk = t.get("ticker") or underlying or "SPX"
        # only attach the session's forecast-levels context when it's THIS
        # trade's ticker (session returns the PRIMARY ticker's levels); a
        # different-ticker trade (e.g. MU) has no playbook here, so pass none.
        same = (tk == sess.get("primary"))
        dna = _dna.build(store, day, t,
                         (sess.get("forecast_levels") or []) if same else [],
                         (sess.get("gex_anchors") or []) if same else [], tk)
        trade_key = f"{t.get('opened_at') or trade}|{t.get('label')}"
        # a stored analysis (frozen DNA + Mira read) if this trade was analyzed
        prior = store.load_trade_analysis(day, trade_key)
        return envelope(snap, available=True, dna=dna, trade_key=trade_key,
                        stored=(prior[0] if prior else None),
                        playbook_session=sess.get("playbook_session"),
                        settle_price=sess.get("settle_price"))

    @app.post("/api/journal/trade-analysis")
    def journal_trade_analysis(body: dict = Body(default={})):
        """Freeze a trade's DNA snapshot + Mira's read into the store, so the
        record survives even after 1m bars age out. Body: {day, trade_key,
        underlying, label, dna, analysis}. Store-only write (ADR-010)."""
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        day = str(body.get("day") or "")
        tk = str(body.get("trade_key") or "")
        dna = body.get("dna")
        if not day or not tk or not isinstance(dna, dict):
            return envelope(snap, available=False, note="need day, trade_key, dna")
        rid = store.save_trade_analysis(
            day=day, trade_key=tk, underlying=str(body.get("underlying") or "SPX"),
            label=body.get("label"), dna=dna,
            analysis=(str(body["analysis"]) if body.get("analysis") else None))
        return envelope(snap, available=True, id=rid)

    @app.get("/api/journal/analysis/bundle")
    def journal_analysis_bundle(window_from: str = Query(...),
                                window_to: str = Query(...),
                                underlying: str = Query("SPX")):
        """The deterministic Journal-Analysis bundle for a window + the ready
        DeepSeek prompt: rubric scores, the pattern census with trade citations,
        per-day discipline, the per-trade review excerpts, and the PRIOR
        analysis (so the read compounds). The client streams Mira with the
        prompt, then POSTs the result to /api/journal/analysis. Read-only."""
        from . import journal_analysis as _ja
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        bundle = _ja.gather(store, window_from, window_to, underlying or "SPX")
        return envelope(snap, available=True, bundle=bundle,
                        prompt=_ja.build_prompt(bundle))

    @app.post("/api/journal/analysis")
    def journal_analysis_save(body: dict = Body(default={})):
        """Store one Journal-Analysis run (tagged daily|weekly|monthly, with the
        date window), so knowledge compounds — the next run reads this one. Body:
        {period, window_from, window_to, underlying, rubric_version, trades,
        net_pnl, scores, swot, patterns, recommendations, narrative}. The
        deterministic fields come from the bundle; swot+narrative from Mira.
        Store-only write (ADR-010)."""
        import datetime as _dt
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        wf, wt = str(body.get("window_from") or ""), str(body.get("window_to") or "")
        if not wf or not wt:
            return envelope(snap, available=False, note="need window_from, window_to")
        und = str(body.get("underlying") or "SPX").upper()
        prior = store.load_latest_journal_analysis(wf, und)
        rid = store.save_journal_analysis({
            "period": str(body.get("period") or "on-demand"),
            "window_from": wf, "window_to": wt, "underlying": und,
            "generated_at": _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat(),
            "rubric_version": int(body.get("rubric_version") or 1),
            "prior_id": (prior or {}).get("id"),
            "trades": body.get("trades"), "net_pnl": body.get("net_pnl"),
            "scores": body.get("scores"), "swot": body.get("swot"),
            "patterns": body.get("patterns"),
            "recommendations": body.get("recommendations"),
            "narrative": (str(body["narrative"]) if body.get("narrative") else None),
        })
        return envelope(snap, available=True, id=rid)

    @app.get("/api/journal/analysis")
    def journal_analysis_list(underlying: str = Query("SPX"),
                              limit: int = Query(60)):
        """Recorded Journal Analyses, newest window first — the history the
        Journal Analysis tab lists, and the score-trend source. Read-only."""
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        rows = store.load_journal_analyses(underlying or "SPX", limit=int(limit))
        return envelope(snap, available=True, analyses=rows)

    @app.post("/api/journal/entry")
    def journal_entry(body: dict = Body(default={})):
        """Save / update the structured trade-action log ('what I did') for a
        snapshot. Body: ``{id, entry: {action, entry, exit, result, lesson, notes}}``.
        Store-only write (ADR-010)."""
        import datetime as _dt
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        sid = (body or {}).get("id")
        if sid is None:
            return envelope(snap, available=False, note="need id")
        entry = _j.normalize_entry((body or {}).get("entry"))
        now = _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat()
        store.update_journal_entry(int(sid), entry, now)
        return envelope(snap, available=True, saved=True, **_j.build_journal(store))

    @app.get("/api/journal/image/{snap_id}")
    def journal_image(snap_id: int):
        """Serve a snapshot's image bytes."""
        from . import journal as _j
        if not getattr(store, "uses_sqlite", False):
            raise HTTPException(status_code=404, detail="not found")
        row = store.load_journal_snapshot(snap_id)
        if not row or not row.get("image_path"):
            raise HTTPException(status_code=404, detail="snapshot not found")
        path = _j.journal_dir(store.data_dir) / row["image_path"]
        if not path.exists():
            raise HTTPException(status_code=404, detail="image missing")
        return FileResponse(str(path), media_type=row.get("image_mime") or "image/png")

    @app.post("/api/journal/score")
    def journal_score(body: dict = Body(default={})):
        """(Re)score snapshots against price action since they were captured —
        which forecast levels held/broke, was the regime call right. Writes only
        our store (ADR-010)."""
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        res = _j.score_all_open(store)
        return envelope(snap, available=True, scored=res, **_j.build_journal(store))

    @app.post("/api/journal/delete")
    def journal_delete(body: dict = Body(default={})):
        """Delete a snapshot (row + image file)."""
        from . import journal as _j
        snap = state.snapshot()
        if not getattr(store, "uses_sqlite", False):
            return envelope(snap, available=False, note="SQLite backend required.")
        sid = (body or {}).get("id")
        if sid is None:
            return envelope(snap, available=False, note="need id")
        row = store.load_journal_snapshot(int(sid))
        if row and row.get("image_path"):
            p = _j.journal_dir(store.data_dir) / row["image_path"]
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
        store.delete_journal_snapshot(int(sid))
        return envelope(snap, available=True, deleted=True, **_j.build_journal(store))

    @app.get("/api/bars")
    def bars(symbol: str = Query(...),
             timeframe: str = Query("daily")):
        """OHLCV bars + computed S/R levels for one ticker/timeframe — the
        chart's data. Read PER REQUEST from bars/<SYMBOL>.json (written by
        snapshot_bars). ``timeframe`` is daily|weekly|monthly. ``levels`` come
        from technicals.support_resistance over that timeframe at the last
        close, serialized to {price, strength, kind}. 404
        {"error":"no_bars_for_symbol"} when the ticker has no bars file (the
        SPA falls back to its fixture chart)."""
        snap = state.snapshot()
        try:
            payload = bars_view.bars_payload(store.data_dir, symbol, timeframe)
        except ValueError:
            raise HTTPException(status_code=422,
                                detail="timeframe must be one of daily|weekly|monthly")
        except bars_view.BarsNotFound:
            raise HTTPException(status_code=404, detail={"error": "no_bars_for_symbol"})
        return envelope(snap, **payload)

    @app.get("/api/bars/overlay")
    def bars_overlay(symbol: str = Query(...)):
        """The chart's full overlay bundle for one ticker — {symbol,
        current_price, levels (all timeframes), analysis (latest journal
        decision), cost_basis (lots avg cost)}. The single call the chart makes
        to draw everything. 404 {"error":"no_bars_for_symbol"} when no bars
        file exists."""
        snap = state.snapshot()
        q = snap.quotes.get(symbol.upper())
        live_price = q.price if q and q.price else None
        try:
            payload = bars_view.overlay_payload(store.data_dir, symbol, live_price=live_price)
        except bars_view.BarsNotFound:
            raise HTTPException(status_code=404, detail={"error": "no_bars_for_symbol"})
        return envelope(snap, **payload)

    @app.get("/api/quotes")
    def quotes():
        snap = state.snapshot()
        return envelope(snap, quotes=to_jsonable(snap.quotes))

    @app.get("/api/ml/roundtrips")
    def ml_roundtrips(account: str = Query("all"),
                      symbol: str | None = Query(None)):
        """Labeled closed round-trips (win/loss + MFE/MAE excursion), written
        by `python -m vantage_server.ml.build_roundtrips`, read PER REQUEST
        from ml/roundtrips.json (appears/changes on build; no restart). A
        missing file is an empty state ({roundtrips: [], summary: {}}).

        ``account`` filters to one Vantage account id (round-trips carry the
        account they were built for); ``symbol`` narrows to one underlying. The
        returned ``summary`` is RECOMPUTED over the filtered set (via the pure
        ml.roundtrips.summarize) so win-rate/profit-factor always describe what
        was actually returned, never the whole-file roll-up."""
        check_account(account)
        snap = state.snapshot()
        data = store.load_roundtrips()
        rows = data["roundtrips"]
        if account != "all":
            rows = [r for r in rows if r.get("account") == account]
        if symbol:
            want = symbol.upper()
            rows = [r for r in rows if str(r.get("symbol", "")).upper() == want]
        summary = ml_summarize(rows)
        return envelope(snap, account=account, symbol=symbol,
                        roundtrips_as_of=data["as_of"], roundtrips=rows,
                        summary=summary)

    @app.get("/api/ml/trade_stats")
    def ml_trade_stats(account: str = Query("all"),
                       dimension: str | None = Query(None)):
        """Entry-condition Bayesian condition buckets + notable edges/leaks,
        written by `python -m vantage_server.ml.build_features`, read PER REQUEST
        from ml/trade_stats.json (appears/changes on build; no restart). A
        missing file is an empty state (baseline null, buckets/notable []).

        ``account`` selects one account's blocks (round-trip stats are built per
        account); 'all' returns the top-level (last-built) account's blocks.
        ``dimension`` narrows ``buckets`` to one feature dimension (daily_trend,
        vol_percentile_band, dte_band, moneyness, ...); the baseline row (kept
        under dimension '__baseline__') and ``notable`` are always returned in
        full so the client keeps its comparison point. Returns
        {baseline_win_rate, buckets, notable, trade_stats_as_of}."""
        check_account(account)
        snap = state.snapshot()
        data = store.load_trade_stats()
        block = data
        if account != "all":
            per = data.get("by_account", {}).get(account)
            block = per if isinstance(per, dict) else {
                "baseline_win_rate": None, "buckets": [], "notable": []}
        buckets = list(block.get("buckets") or [])
        if dimension:
            want = dimension.strip()
            buckets = [b for b in buckets
                       if b.get("dimension") in (want, "__baseline__")]
        return envelope(snap, account=account, dimension=dimension,
                        trade_stats_as_of=data["as_of"],
                        baseline_win_rate=block.get("baseline_win_rate"),
                        buckets=buckets,
                        notable=list(block.get("notable") or []))

    # ==================================================================
    # POST /api/refresh — THE deliberate mutating route (read tools only).
    #
    # This is the FIRST and ONLY route that WRITES. It is an operator action:
    # re-pull broker holdings + transactions and persist them to OUR OWN SQLite
    # (positions replaced for the account, history accumulated/deduped,
    # last_synced stamped). It calls ONLY read broker tools (fetch_positions /
    # fetch_option_positions / fetch_portfolio / fetch_history) — order
    # placement and fund movement are impossible (the broker connectors enforce
    # a read-only allowlist at the transport layer, ADR-010). Runs synchronously
    # (fine for a handful of accounts) and returns per-account results. Broker
    # resolution failure for one account is reported in that account's ``errors``
    # while the others proceed.
    # ==================================================================
    @app.post("/api/refresh")
    def refresh(body: dict = Body(default={})):
        account = (body or {}).get("account")
        if account is not None and str(account) != "all":
            account = str(account)
            check_account(account)  # 404 for an unknown account id
        else:
            account = None  # omitted or "all" -> refresh every API-broker account
        results = refresh_accounts(store, account)
        snap = state.snapshot()
        return envelope(snap, results=[r.to_dict() for r in results])

    # ==================================================================
    # ACCOUNT MANAGEMENT — the settings-page write surface. Creates/edits/
    # removes accounts and triggers a sync. Writes touch ONLY our own store
    # (accounts + lots), never a fund-moving path (ADR-010). Broker SECRETS are
    # NOT handled here — they live host-side (env/token file); this surface only
    # reports auth status and the CLI command to grant it.
    # ==================================================================
    from .brokers.base import CONNECTIONS as _ALL_CONN

    def _account_auth_status(broker: str | None) -> str | None:
        if not broker or broker not in _ALL_CONN:
            return None
        try:
            return _ALL_CONN[broker]().auth_status()
        except Exception:  # noqa: BLE001 — a status probe never breaks the list
            return "unknown"

    def _account_auth_hint(broker: str | None) -> str | None:
        """The host-side one-time-auth command for an API broker (no secrets)."""
        if not broker or broker not in _ALL_CONN:
            return None
        return (f"python -m vantage_server.importer --broker {broker} --auth"
                if broker != "robinhood"
                else "python -m vantage_server.importer --broker robinhood --auth")

    @app.post("/api/accounts")
    def create_account(body: dict = Body(...)):
        """Create an account (manual or as a target for an API broker's sync).
        Requires id + name; currency/jurisdiction default USD/US. 409 if the id
        exists."""
        acct_id = str((body or {}).get("id", "")).strip()
        name = str((body or {}).get("name", "")).strip()
        if not acct_id or not name:
            return JSONResponse({"error": "id and name are required"}, status_code=400)
        account = {
            "id": acct_id, "name": name,
            "short": str(body.get("short") or name)[:12],
            "type": str(body.get("type") or "brokerage"),
            "taxable": bool(body.get("taxable", True)),
            "last_sync": "never",
            "currency": str(body.get("currency") or "USD").upper(),
            "jurisdiction": str(body.get("jurisdiction") or "US").upper(),
        }
        if not store.add_account(account):
            return JSONResponse({"error": f"account '{acct_id}' already exists"},
                                status_code=409)
        broker = str(body.get("broker") or "").strip()
        if broker:
            store.set_meta(f"broker:{acct_id}", broker)
        snap = state.snapshot()
        return envelope(snap, account=account, created=True)

    @app.post("/api/accounts/{account_id}/edit")
    def edit_account(account_id: str, body: dict = Body(...)):
        """Patch editable fields (name/short/type/taxable/currency/jurisdiction)."""
        check_account(account_id)
        if not store.update_account(account_id, body or {}):
            return JSONResponse({"error": "no editable fields changed"}, status_code=400)
        if body and body.get("broker") is not None:
            store.set_meta(f"broker:{account_id}", str(body["broker"]).strip())
        snap = state.snapshot()
        return envelope(snap, account_id=account_id, updated=True)

    @app.post("/api/accounts/{account_id}/delete")
    def delete_account(account_id: str):
        """Remove an account and its lots."""
        check_account(account_id)
        removed = store.remove_account(account_id)
        snap = state.snapshot()
        return envelope(snap, account_id=account_id, removed=removed)

    @app.post("/api/accounts/{account_id}/sync")
    def sync_account(account_id: str):
        """Pull live positions for ONE API-broker account (same read-only broker
        path as /api/refresh, scoped to this account)."""
        check_account(account_id)
        results = refresh_accounts(store, account_id)
        snap = state.snapshot()
        return envelope(snap, results=[r.to_dict() for r in results])

    # ------------------------------------------------------------------
    # Kite (Zerodha) one-click re-auth. The daily token expires ~06:00 IST;
    # this replaces the CLI copy-paste. The backend catches the redirect (its
    # published port IS the app's registered redirect URL), so no browser paste.
    # SECRETS never leave the host: only the login URL out, request_token in.
    # ------------------------------------------------------------------
    def _kite_conn():
        conn_cls = _ALL_CONN.get("zerodha")
        if conn_cls is None:
            raise HTTPException(status_code=404, detail="zerodha connector not available")
        return conn_cls()

    @app.get("/")
    def root(request_token: str = Query(default="")):
        """Root: forwards a Kite redirect (…/ ?request_token=…) to the callback
        so the app's registered redirect URL can be the backend root. A bare
        GET / (no token) is a friendly liveness line."""
        if request_token:
            return kite_callback(request_token=request_token)
        return JSONResponse({"service": "vantage-backend", "ok": True})

    @app.get("/api/kite/login-url")
    def kite_login_url():
        """The Kite login URL to open. The button opens this; after login Kite
        redirects to /api/kite/callback with the request_token."""
        try:
            url = _kite_conn().login_url()
        except Exception as exc:  # noqa: BLE001 — surface setup errors to the UI
            return JSONResponse({"error": str(exc)}, status_code=400)
        snap = state.snapshot()
        return envelope(snap, login_url=url)

    @app.get("/api/kite/callback")
    def kite_callback(request_token: str = Query(default=""),
                      status: str = Query(default="")):
        """Kite's redirect target: exchange the request_token for the daily
        access token and save it, then return a small self-closing HTML page.
        Registered redirect URL in the Kite app must point here (or to the
        published backend root that forwards here)."""
        html_ok = ("<html><body style='font-family:system-ui;padding:40px'>"
                   "<h2>Zerodha connected \u2713</h2><p>Access token saved. "
                   "You can close this tab and return to Vantage.</p>"
                   "<script>setTimeout(()=>window.close(),1500)</script>"
                   "</body></html>")
        html_err = ("<html><body style='font-family:system-ui;padding:40px'>"
                    "<h2>Kite auth failed</h2><p>{msg}</p>"
                    "<p>Return to Vantage and try Re-authenticate again.</p>"
                    "</body></html>")
        if not request_token:
            return HTMLResponse(html_err.format(msg="No request_token in the "
                                "redirect. Did the login complete?"), status_code=400)
        try:
            _kite_conn().exchange_request_token(request_token)
        except Exception as exc:  # noqa: BLE001
            return HTMLResponse(html_err.format(msg=str(exc)), status_code=400)
        return HTMLResponse(html_ok)

    signal_seed = store.load_signals()

    @app.get("/api/signals")
    def signals():
        """Graded signals — status/pnl/grade are COMPUTED from the current
        quote snapshot on every read, never authored (see signals.py)."""
        snap = state.snapshot()
        graded = grade_signals(signal_seed, snap.quotes)
        return envelope(snap, signals=to_jsonable(graded))

    # ==================================================================
    # Per-ticker NOTEBOOK — the second deliberate API write surface after
    # /api/refresh (ADR-014). Writes touch ONLY our own SQLite (plan + journal),
    # never a broker or any fund-moving path — fully inside ADR-010.
    # ==================================================================
    def _now_iso() -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()

    @app.get("/api/ticker/{symbol}/notebook")
    def ticker_notebook(symbol: str):
        """Everything the notebook panel needs in one call: the structured plan
        (+ computed risk/reward geometry), the running journal (newest first),
        valuation fundamentals, growth/quality, market-implied expectations,
        relative strength, and recent news — the same analyst datasets the MCP
        surface serves, so the product isn't blind to what the advisor sees."""
        from . import expectations as exp_mod
        from . import fundamentals as fund
        from . import growth as growth_mod
        from . import news as news_mod
        from . import relative_strength as rs_mod
        from .risk_reward import risk_reward as rr
        snap = state.snapshot()
        sym = symbol.upper()
        plan = store.load_ticker_plan(sym)
        quote = snap.quotes.get(sym)
        price = quote.price if quote else None
        if price is None:
            bars = store.load_bars(sym)
            daily = bars.get("daily") if isinstance(bars, dict) else None
            if isinstance(daily, list) and daily and daily[-1].get("close"):
                price = float(daily[-1]["close"])
        fundamentals = fund.fundamentals(sym, store.data_dir)
        grown = growth_mod.growth(sym, store.data_dir)
        return envelope(
            snap,
            symbol=sym,
            plan=plan,
            risk_reward=rr(plan, price),
            journal=store.load_ticker_journal(sym),
            fundamentals=fundamentals,
            growth=grown,
            expectations=exp_mod.expectations(fundamentals, grown, price),
            relative_strength=rs_mod.relative_strength(sym, store.data_dir),
            news=news_mod.news(sym, store.data_dir),
        )

    @app.get("/api/rec_scorecard")
    def api_rec_scorecard():
        """The decision journal's own track record (per-rule forward-return hit
        rates) — same dataset as the vantage.rec_scorecard MCP tool."""
        from . import rec_scorecard as sc_mod
        snap = state.snapshot()
        return envelope(snap, scorecard=sc_mod.rec_scorecard(store.data_dir))

    @app.get("/api/ticker/{symbol}/fundamentals")
    def ticker_fundamentals(symbol: str):
        from . import fundamentals as fund
        snap = state.snapshot()
        return envelope(snap, symbol=symbol.upper(),
                        fundamentals=fund.fundamentals(symbol.upper(), store.data_dir))

    @app.get("/api/ticker/{symbol}/news")
    def ticker_news(symbol: str):
        """Aggregated, deduped, sentiment-tagged news for one symbol (or null)."""
        from . import news as news_mod
        snap = state.snapshot()
        return envelope(snap, symbol=symbol.upper(),
                        news=news_mod.news(symbol.upper(), store.data_dir))

    @app.post("/api/ticker/{symbol}/plan")
    def save_ticker_plan(symbol: str, body: dict = Body(default={})):
        """Upsert the thesis/target/stop/notes plan for one symbol."""
        store.upsert_ticker_plan(symbol.upper(), body or {}, now=_now_iso())
        snap = state.snapshot()
        return envelope(snap, symbol=symbol.upper(), plan=store.load_ticker_plan(symbol.upper()))

    @app.post("/api/ticker/{symbol}/note")
    def add_ticker_note(symbol: str, body: dict = Body(default={})):
        """Append a manual note to the ticker's journal."""
        text = str((body or {}).get("text", "")).strip()
        if not text:
            raise HTTPException(status_code=400, detail="note text is required")
        store.append_ticker_journal(symbol.upper(), "note", {"text": text}, now=_now_iso())
        snap = state.snapshot()
        return envelope(snap, symbol=symbol.upper(), journal=store.load_ticker_journal(symbol.upper()))

    return app


app = create_app()
