"""Telegram USER-ACCOUNT listener — sees exactly what the operator's phone
sees (MTProto via Telethon), filtered to the allow-listed channels, feeding
telegram_signals.ingest_message. READ-ONLY by design: it never sends,
forwards, or reacts as the account (the outbound alert path stays on the
bot). The session file is FULL ACCOUNT ACCESS — it lives in the data dir,
is gitignored, and never leaves the box.

Setup (operator, once):
  1. api_id/api_hash from https://my.telegram.org → env TELEGRAM_API_ID /
     TELEGRAM_API_HASH (deploy/.env).
  2. Login (interactive, sends a code to your phone — run it yourself):
       python -m vantage_server.telegram_listener --login
  3. See your subscribed channels and pick names for the allow-list:
       python -m vantage_server.telegram_listener --list
     then add them in the desk (Strategies → Paper → Telegram signals) or
     POST /api/telegram/channels.
  4. Run the daemon:  docker compose --profile telegram up -d
"""
from __future__ import annotations

import logging
import os
import sys

from . import telegram_signals as tg
from .store import Store, resolve_data_dir

log = logging.getLogger("vantage.telegram")


def _session_path() -> str:
    return str(resolve_data_dir(None) / "telegram.session")


def _client():
    try:
        from telethon import TelegramClient
    except ImportError:
        sys.exit("telethon is not installed — pip install 'vantage-server[telegram]'")
    api_id, api_hash = os.environ.get("TELEGRAM_API_ID"), os.environ.get("TELEGRAM_API_HASH")
    if not api_id or not api_hash:
        sys.exit("set TELEGRAM_API_ID / TELEGRAM_API_HASH (from my.telegram.org)")
    return TelegramClient(_session_path(), int(api_id), api_hash)


def login() -> None:
    """Interactive one-time login (Telegram texts a code to the phone)."""
    with _client() as c:
        me = c.loop.run_until_complete(c.get_me())
        print(f"logged in as {me.first_name} (@{me.username}) — session saved to "
              f"{_session_path()}")


def list_dialogs() -> None:
    """Print subscribed channels/groups so the operator can pick allow-list
    entries — @username when one exists, otherwise the numeric id (both are
    valid allow-list values)."""
    with _client() as c:
        for d in c.iter_dialogs():
            if d.is_channel or d.is_group:
                uname = getattr(d.entity, "username", None)
                key = f"@{uname}" if uname else str(d.id)
                print(f"{key:>28}  ·  {d.name}")


def run() -> None:  # pragma: no cover — network daemon
    import datetime as _dt
    import time

    from telethon import events
    store = Store(None)
    client = _client()

    async def _publish_dialogs():
        """Publish the account's channel list to the store so the desk's
        config screen can list-and-toggle without its own Telethon client."""
        rows = []
        async for d in client.iter_dialogs():
            if d.is_channel or d.is_group:
                uname = getattr(d.entity, "username", None)
                rows.append({"key": f"@{uname}" if uname else str(d.id),
                             "name": d.name,
                             "at": _dt.datetime.now(_dt.timezone.utc).isoformat()})
        tg.save_dialogs(store, rows)
        log.info("published %d dialogs to the store", len(rows))

    # allow-list is re-read (cached 30s) per message — desk toggles take
    # effect WITHOUT restarting this daemon.
    _allow = {"at": 0.0, "list": []}

    def _allowed(chat_id, username):
        if time.time() - _allow["at"] > 30:
            _allow["list"] = tg.channels(store)
            _allow["at"] = time.time()
        return tg.is_allowed(chat_id, username, _allow["list"])

    @client.on(events.NewMessage())
    async def _on_msg(event):
        try:
            chat = await event.get_chat()
            uname = getattr(chat, "username", None)
            if not _allowed(event.chat_id, uname):
                return
            name = uname or getattr(chat, "title", "?")
            res = tg.ingest_message(store, str(name), int(event.id),
                                    event.raw_text or "",
                                    event.date.isoformat() if event.date else None)
            log.info("telegram @%s msg %s → %s", name, event.id, res["status"])
        except Exception:  # noqa: BLE001 — one bad message never kills the listener
            log.exception("telegram ingest failed")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    with client:
        client.loop.run_until_complete(_publish_dialogs())
        log.info("listening · allow-list (%d): %s — toggle on the desk, no restart needed",
                 len(tg.channels(store)), ", ".join(tg.channels(store)) or "(empty)")
        client.run_until_disconnected()


if __name__ == "__main__":
    if "--login" in sys.argv:
        login()
    elif "--list" in sys.argv:
        list_dialogs()
    else:
        run()
