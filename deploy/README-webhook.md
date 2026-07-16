# Exposing the coach webhook to TradingView (localhost + a tunnel)

TradingView sends alerts from **its cloud**, so your local Vantage needs a public
inbound URL. This setup exposes **only** `POST /webhook/tradingview` — the rest of
the backend stays local — via a tunnel (ngrok or Cloudflare) + an nginx allowlist
proxy.

```
TradingView ──► tunnel (ngrok | cloudflared) ──► webhook-proxy (nginx) ──► vantage-backend
                                                  (only /webhook/tradingview;       (secret-gated)
                                                   everything else → 404)
```

Why this shape: the tunnel points at the nginx proxy, which forwards a single
path. Even though the tunnel is public, the internet can only reach the one
secret-gated webhook route — not your paper trades, playbook, or broker config.

Pick ONE tunnel below.

---

## Option A — ngrok (a reserved static domain)

You have a reserved free domain, e.g. `unrived-unconventional-bethanie.ngrok-free.dev`.

1. Get your **authtoken** from <https://dashboard.ngrok.com/get-started/your-authtoken>.
2. Put both in `deploy/.env` (git-ignored — never commit):
   ```
   NGROK_AUTHTOKEN=your-authtoken
   NGROK_DOMAIN=unrived-unconventional-bethanie.ngrok-free.dev
   ```
3. Bring it up (forwards your domain → the allowlist proxy, NOT the whole :8641):
   ```bash
   docker compose -f deploy/docker-compose.yml --profile webhook-ngrok up -d
   ```
4. Verify:
   ```bash
   curl -sf https://unrived-unconventional-bethanie.ngrok-free.dev/healthz   # → ok
   ```

Your **webhook URL** for TradingView is:
`https://unrived-unconventional-bethanie.ngrok-free.dev/webhook/tradingview`

Then jump to **"One-time: set the shared secret + Telegram"** below.

> Note: this points ngrok at the `webhook-proxy` allowlist, so only
> `/webhook/tradingview` is reachable. Do NOT run a bare `ngrok http 8641` — that
> would expose the entire backend.

---

## Option B — Cloudflare Tunnel

## One-time: create the tunnel (needs your Cloudflare login — do this yourself)

Cloudflare Tunnel is free and gives a **stable** hostname (unlike ngrok's
per-restart URL).

1. Sign in at <https://one.dash.cloudflare.com> → **Networks → Tunnels → Create a
   tunnel** → **Cloudflared** → name it e.g. `vantage-webhook`.
2. Cloudflare shows an install command containing a **token** (a long
   `eyJ...` string). Copy just the token.
3. Add a **Public Hostname** to the tunnel:
   - Subdomain + domain: e.g. `vantage-hook.yourdomain.com` (any domain on your
     Cloudflare account). No domain? Cloudflare also offers a free
     `*.trycloudflare.com` quick tunnel — see "No domain?" below.
   - Service: **HTTP** → `webhook-proxy:80`
4. Put the token in `deploy/.env` (git-ignored — never commit it):
   ```
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...your-token...
   ```

Bring it up (the `webhook-cf` profile is OFF for a normal `up`; opt in
explicitly):

```bash
docker compose -f deploy/docker-compose.yml --profile webhook-cf up -d
curl -sf https://vantage-hook.yourdomain.com/healthz   # → ok
```

Your webhook URL is `https://<your-webhook-host>/webhook/tradingview`.

---

## One-time: set the shared secret + Telegram

```bash
# a random secret (the webhook's only gate)
curl -X POST http://localhost:8641/api/reclaim-bot/webhook-secret \
     -H 'Content-Type: application/json' -d '{"secret":"<random-string>"}'

# Telegram (if not already configured), with a test ping
curl -X POST http://localhost:8641/api/reclaim-bot/config \
     -H 'Content-Type: application/json' \
     -d '{"bot_token":"<token>","chat_id":"<chat>","test":true}'
```

Then **re-pull the coach Pine** (🎯 Coach Pine) — the secret bakes into it.

## In TradingView

### Paid plan (Essential+) — one alert

If your plan has **"Any alert() function call"**, add ONE alert on the coach:
- **Condition:** "Any alert() function call"
- **Options:** Once Per Bar Close
- **Webhook URL:** `https://<your-webhook-host>/webhook/tradingview`
- Leave the message default (the coach builds the JSON itself).

### Free / basic plan — one alert per event

The free plan doesn't offer "Any alert()", only the named conditions. Create a
separate alert for **each** you want (TRIGGER is the essential one; add SCALE /
TARGET HIT / STOPPED / ARMED as desired):
- **Condition:** the coach indicator → pick e.g. **"Coach: TRIGGER"**
- **Options:** Once Per Bar Close
- **Webhook URL:** `https://<your-webhook-host>/webhook/tradingview`
- **Message:** leave it as the **default** — the coach already fills it with the
  secret JSON + `{{plot(...)}}` placeholders that carry the live entry/target/
  stop/R:R. Don't overwrite it.

Both paths hit the same endpoint and produce the same Telegram messages.

Fire a test by letting an event trigger (or hand-post to confirm wiring):

```bash
curl -X POST https://<your-webhook-host>/webhook/tradingview \
  -H 'Content-Type: application/json' \
  -d '{"secret":"<random-string>","symbol":"SPX","headline":"test","detail":"wiring works"}'
# → Telegram receives it. Wrong/missing secret → HTTP 401.
```

## No domain? (quick tunnel)

For throwaway testing without a Cloudflare domain, run a quick tunnel (random
`*.trycloudflare.com` URL, changes each restart — you'd re-enter it in TV each
time, so not for ongoing use):

```bash
docker run --rm --network vantage_default cloudflare/cloudflared:latest \
  tunnel --url http://webhook-proxy:80
```

## Security recap

- The tunnel exposes ONLY `/webhook/tradingview` (nginx 404s the rest).
- The route is secret-gated; wrong/missing secret → 401.
- Secret + tunnel token live in env / git-ignored files, never committed.
- The endpoint only sends an OUTBOUND Telegram message — no broker/order path.
- Rotate the secret by setting a new one → regenerate the Pine (TV needs no
  change; the new script carries the new secret).
