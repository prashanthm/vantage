# Exposing the coach webhook to TradingView (localhost + Cloudflare Tunnel)

TradingView sends alerts from **its cloud**, so your local Vantage needs a public
inbound URL. This setup exposes **only** `POST /webhook/tradingview` — the rest of
the backend stays local — via a Cloudflare Tunnel + an nginx allowlist proxy.

```
TradingView ──► Cloudflare edge ──► cloudflared ──► webhook-proxy (nginx) ──► vantage-backend
                                                     (only /webhook/tradingview;         (secret-gated)
                                                      everything else → 404)
```

Why this shape: the tunnel points at the nginx proxy, which forwards a single
path. Even though the tunnel is public, the internet can only reach the one
secret-gated webhook route — not your paper trades, playbook, or broker config.

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

## Bring it up

```bash
docker compose -f deploy/docker-compose.yml --profile webhook up -d
```

(the `webhook` profile means these two services are OFF for a normal `up`; you
opt in explicitly.) Verify the tunnel is healthy:

```bash
curl -sf https://vantage-hook.yourdomain.com/healthz   # → ok
```

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

Add ONE alert on the coach indicator:
- **Condition:** "Any alert() function call"
- **Options:** Once Per Bar Close
- **Notifications → Webhook URL:** `https://vantage-hook.yourdomain.com/webhook/tradingview`
- Leave the message box default (the coach builds the JSON itself).

Fire a test by letting an event trigger (or hand-post to confirm wiring):

```bash
curl -X POST https://vantage-hook.yourdomain.com/webhook/tradingview \
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

## Alternative: ngrok

If you already use ngrok: `ngrok http 8641` exposes the WHOLE backend (less safe)
— to keep the allowlist, point ngrok at the proxy instead: run the `webhook-proxy`
service, find its published port (add `ports: ["8080:80"]` to it), then
`ngrok http 8080`. Cloudflare Tunnel is preferred (stable URL, nothing published
on your host).

## Security recap

- The tunnel exposes ONLY `/webhook/tradingview` (nginx 404s the rest).
- The route is secret-gated; wrong/missing secret → 401.
- Secret + tunnel token live in env / git-ignored files, never committed.
- The endpoint only sends an OUTBOUND Telegram message — no broker/order path.
- Rotate the secret by setting a new one → regenerate the Pine (TV needs no
  change; the new script carries the new secret).
