# Coach alerts → TradingView → Telegram

The coach indicator can push its lifecycle events (TRIGGERED / SCALE / ARMED /
TARGET HIT / STOPPED) to Telegram, via a TradingView alert that POSTs to a
Vantage webhook.

## Flow

```
TradingView alert  ──POST──►  Vantage /webhook/tradingview  ──►  send_telegram()  ──►  Telegram
   (coach alert() )            (validates the baked secret)        (existing bot)
```

TradingView can't send auth headers, so the coach bakes a **shared secret** into
each `alert()` JSON body; the endpoint rejects any POST whose secret doesn't
match (HTTP 401).

## One-time setup

1. **Set the webhook secret** (any random string; env wins, else stored in SQLite
   meta and settable from the API):
   - env: `COACH_WEBHOOK_SECRET=<random>` on the backend, OR
   - API: `POST /api/reclaim-bot/webhook-secret {"secret":"<random>"}`
2. **Configure Telegram** (if not already): `POST /api/reclaim-bot/config
   {"bot_token","chat_id","test":true}` — the test message confirms wiring.
3. **Regenerate the coach Pine** (🎯 Coach Pine) — the secret is baked into it,
   so re-pull after setting/changing the secret.
4. **In TradingView**, add ONE alert on the coach indicator:
   - Condition: **"Any alert() function call"**
   - Options: **Once Per Bar Close**
   - Webhook URL (Notifications tab): `https://<your-vantage-host>/webhook/tradingview`
   - Leave the message box default (the coach already builds the full JSON).

That single alert covers every event — the coach fires `alert()` with the live
plan on each transition, so Telegram gets e.g.:

```
📊 SPX COACH
🔔 BUY CALLS · support (5x) 7548.6
target 7579.1 · stop 7544.1 · R:R 2.4 · read: momentum behind it
```

## The alert payload

Each `alert()` sends JSON:

```json
{"secret":"…","source":"coach","event":"TRIGGERED","symbol":"SPX",
 "headline":"🔔 BUY CALLS · support 7548.6",
 "detail":"target 7579.1 · stop 7544.1 · R:R 2.4 · read: momentum behind it",
 "price":7549.83}
```

The endpoint validates `secret`, then forwards `headline` + `detail` to Telegram.
A plain (non-JSON) body is also accepted, but only when NO secret is configured —
so a hand-authored alert still notifies during testing.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /webhook/tradingview` | inbound TradingView alert → Telegram (secret-gated) |
| `POST /api/reclaim-bot/webhook-secret` | set/clear the shared secret |
| `GET /api/spx/coach/pine` | returns the coach Pine with the secret baked; `webhook_configured` flags whether a secret is set |

## Security notes

- The webhook is public. The secret is the only gate — keep it non-trivial and
  rotate it (set a new secret → regenerate the Pine → update nothing in TV, the
  new script carries it).
- Never commit the real secret. It lives in env or the git-ignored SQLite store,
  never in a tracked file (same discipline as the DeepSeek key / Telegram token).
- The endpoint only ever sends an OUTBOUND Telegram message — no broker/order
  path (ADR-010 read-only doctrine holds).
