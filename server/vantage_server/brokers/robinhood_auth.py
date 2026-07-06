"""OAuth client for Robinhood's Agentic Trading MCP server (ported from sentinel).

Vantage registers as its own OAuth client (dynamic client registration,
RFC 7591) and runs a one-time browser authorization-code + PKCE flow:

    python -m vantage_server.importer --broker robinhood --auth

Tokens are stored in a chmod-600 JSON file and refreshed automatically by
get_access_token(). Token file resolution order (see token_file()):

1. env ``ROBINHOOD_TOKEN_FILE`` — explicit override, always wins;
2. ``~/personal/sentinel/.robinhood_token.json`` — when it exists, the
   standing sentinel grant is reused so the two projects share one
   authorization instead of invalidating each other's refresh tokens;
3. ``server/.robinhood_token.json`` — the in-repo default (gitignored).

Token values are NEVER printed or logged — only file paths and expiries.
Stdlib-only (urllib): the core server install stays dependency-free; the
``mcp`` package is only needed by brokers/robinhood.py, not here.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs

from .base import BrokerConnectionError

log = logging.getLogger(__name__)

MCP_URL = os.environ.get("ROBINHOOD_MCP_URL", "https://agent.robinhood.com/mcp/trading")
CALLBACK_PORT = 8722  # deliberately not sentinel's 8721 so both can run
CALLBACK_PATH = "/callback"
SCOPE = "internal"

ENV_TOKEN_FILE = "ROBINHOOD_TOKEN_FILE"
_SERVER_DEFAULT_TOKEN = Path(__file__).resolve().parents[2] / ".robinhood_token.json"

# Refresh when less than this many seconds of validity remain.
_REFRESH_MARGIN_SEC = 120

_AUTH_HINT = "Run: python -m vantage_server.importer --broker robinhood --auth"


class AuthError(BrokerConnectionError):
    """Raised when no valid token is available and one cannot be obtained."""


def token_file() -> Path:
    """Resolve the token file: env > sentinel's standing grant > server default.

    Evaluated at call time (not import time) so tests and shells can switch
    the environment without reimporting.
    """
    env = os.environ.get(ENV_TOKEN_FILE)
    if env:
        return Path(env)
    sentinel = Path.home() / "personal" / "sentinel" / ".robinhood_token.json"
    if sentinel.is_file():
        return sentinel
    return _SERVER_DEFAULT_TOKEN


# ------------------------------------------------------------- HTTP helpers
#
# Stdlib transport, injectable for tests (monkeypatch _http_post / _http_get_json).

def _http_get_json(url: str, timeout: float = 15.0) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_post(
    url: str,
    *,
    form: dict | None = None,
    json_body: dict | None = None,
    timeout: float = 15.0,
) -> tuple[int, str]:
    """POST form-encoded or JSON data; returns (status_code, body_text).
    HTTP error statuses are returned, not raised."""
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
    else:
        data = urlencode(form or {}).encode("utf-8")
        headers = {"Content-Type": "application/x-www-form-urlencoded",
                   "Accept": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


# ---------------------------------------------------------------- token store

def _load_store() -> dict:
    path = token_file()
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _save_store(store: dict) -> None:
    """Atomic replace + chmod 600 — the token never exists world-readable."""
    path = token_file()
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(store, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


# -------------------------------------------------------------- OAuth pieces

def _discover() -> dict:
    """Fetch OAuth authorization-server metadata (RFC 8414)."""
    base = MCP_URL.split("/mcp/")[0]
    meta = _http_get_json(f"{base}/.well-known/oauth-authorization-server")
    for field in ("authorization_endpoint", "token_endpoint", "registration_endpoint"):
        if field not in meta:
            raise AuthError(f"OAuth metadata missing {field}: {meta}")
    return meta


def _register_client(meta: dict) -> str:
    """Dynamic client registration; returns the new client_id."""
    redirect_uri = f"http://localhost:{CALLBACK_PORT}{CALLBACK_PATH}"
    status, body = _http_post(
        meta["registration_endpoint"],
        json_body={
            "client_name": "vantage-portfolio-sync",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": SCOPE,
        },
    )
    if status != 200 and status != 201:
        raise AuthError(f"Client registration failed ({status}): {body[:500]}")
    client_id = json.loads(body).get("client_id")
    if not client_id:
        raise AuthError(f"Client registration returned no client_id: {body[:500]}")
    log.info("Registered OAuth client: %s", client_id)
    return client_id


class _CallbackHandler(BaseHTTPRequestHandler):
    result: dict = {}

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != CALLBACK_PATH:
            self.send_response(404)
            self.end_headers()
            return
        params = parse_qs(parsed.query)
        _CallbackHandler.result = {k: v[0] for k, v in params.items()}
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        body = ("<html><body><h2>Vantage authorized.</h2>"
                "<p>You can close this tab and return to the terminal.</p></body></html>")
        self.wfile.write(body.encode())

    def log_message(self, *args):
        pass


def interactive_login(timeout_sec: int = 300) -> dict:
    """One-time browser PKCE flow. Returns the saved token store."""
    meta = _discover()
    store = _load_store()
    client_id = store.get("client_id") or _register_client(meta)
    redirect_uri = f"http://localhost:{CALLBACK_PORT}{CALLBACK_PATH}"

    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)

    auth_url = meta["authorization_endpoint"] + "?" + urlencode({
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": SCOPE,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "resource": MCP_URL,
    })

    server = HTTPServer(("localhost", CALLBACK_PORT), _CallbackHandler)
    server.timeout = 1
    _CallbackHandler.result = {}

    print(f"Opening browser for Robinhood authorization...\n  {auth_url}\n")
    webbrowser.open(auth_url)
    print(f"Waiting for callback on http://localhost:{CALLBACK_PORT}{CALLBACK_PATH} "
          f"(up to {timeout_sec}s)...")

    deadline = time.time() + timeout_sec
    while time.time() < deadline and not _CallbackHandler.result:
        server.handle_request()
    server.server_close()

    result = _CallbackHandler.result
    if not result:
        raise AuthError("Timed out waiting for OAuth callback.")
    if result.get("state") != state:
        raise AuthError("OAuth state mismatch — possible CSRF, aborting.")
    if "error" in result:
        raise AuthError(f"Authorization failed: {result.get('error_description', result['error'])}")
    code = result.get("code")
    if not code:
        raise AuthError(f"No authorization code in callback: {sorted(result)}")

    status, body = _http_post(
        meta["token_endpoint"],
        form={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "code_verifier": verifier,
            "resource": MCP_URL,
        },
    )
    if status != 200:
        raise AuthError(f"Token exchange failed ({status}): {body[:500]}")
    tokens = json.loads(body)

    store = {
        "client_id": client_id,
        "token_endpoint": meta["token_endpoint"],
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token", ""),
        "expires_at": time.time() + float(tokens.get("expires_in", 3600)),
        "scope": tokens.get("scope", SCOPE),
    }
    _save_store(store)
    # Deliberately no token values in the message — path and expiry only.
    print("Authorization complete — token saved to "
          f"{token_file()} (expires in {tokens.get('expires_in', '?')}s).")
    return store


def _refresh(store: dict) -> dict:
    status, body = _http_post(
        store["token_endpoint"],
        form={
            "grant_type": "refresh_token",
            "refresh_token": store["refresh_token"],
            "client_id": store["client_id"],
            "resource": MCP_URL,
        },
    )
    if status != 200:
        raise AuthError(
            f"Token refresh failed ({status}): {body[:300]}. Re-authorize — {_AUTH_HINT}"
        )
    tokens = json.loads(body)
    store["access_token"] = tokens["access_token"]
    # Servers may rotate the refresh token — keep the new one if present.
    if tokens.get("refresh_token"):
        store["refresh_token"] = tokens["refresh_token"]
    store["expires_at"] = time.time() + float(tokens.get("expires_in", 3600))
    _save_store(store)
    log.info("Robinhood OAuth token refreshed.")  # values never logged
    return store


def get_access_token() -> str:
    """Return a valid access token, refreshing if near/past expiry."""
    store = _load_store()
    if not store.get("access_token"):
        raise AuthError(f"No Robinhood token at {token_file()}. {_AUTH_HINT}")
    if time.time() > store.get("expires_at", 0) - _REFRESH_MARGIN_SEC:
        if not store.get("refresh_token"):
            raise AuthError(f"Token expired and no refresh token. {_AUTH_HINT}")
        store = _refresh(store)
    return store["access_token"]
