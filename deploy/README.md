# Vantage + Mira — Docker deployment

Containerized, portable path for the whole stack. **The dev path stays `./stack`**
(the venv runner at the repo root); Docker is the prod/portable path. Both serve
the same four services on the same host ports.

| Path | Command | Use |
|------|---------|-----|
| **Dev** | `./stack start [--live]` | venvs, hot files, fastest iteration |
| **Docker** | `docker compose -f deploy/docker-compose.yml up --build` | portable, reproducible, prod-like |

## Services & ports

| Service | Container | Host port | Health | Role |
|---------|-----------|-----------|--------|------|
| `vantage-backend` | `vantage-backend:local` | `8641` | `GET /api/health` | FastAPI REST for the SPA. **Owns** `vantage.db` (read-write). `POST /api/refresh` writes broker holdings. |
| `vantage-mcp` | `vantage-mcp:local` | `8640` | MCP handshake at `/mcp` | AI tool surface for Mira. Reads the **same** db, **read-only**. |
| `vantage-spa` | `vantage-spa:local` | `8642` | `GET /healthz` | nginx static SPA shell. |
| `mira` | `mira:local` | `8080` | `GET /health` | Agent service. Calls MCP for tools + host Ollama for the LLM. |

## Networking (the important part)

Two distinct network planes:

```
  ┌─────────────────────────── HOST (your Mac) ────────────────────────────┐
  │                                                                          │
  │   Browser ──HTTP──▶  :8642  (vantage-spa, nginx static)                  │
  │      │                                                                   │
  │      ├──HTTP fetch─▶  :8641  (vantage-backend  /api/*)   ← published     │
  │      └──HTTP fetch─▶  :8080  (mira            /turn,/health) ← published │
  │                                                                          │
  │   Ollama :11434  (OpenAI-compatible /v1)                                 │
  │      ▲                                                                    │
  │      │ host.docker.internal:11434                                        │
  │  ┌───┼──────────────── compose network `vantage_default` ───────────┐   │
  │  │   │                                                                │   │
  │  │  mira ──HTTP──▶ vantage-mcp:8640/mcp  (container DNS, NOT host)    │   │
  │  │                      │                                             │   │
  │  │  vantage-backend ─── vantage-data volume ─── vantage-mcp (ro)      │   │
  │  └────────────────────────────────────────────────────────────────┘   │
  └──────────────────────────────────────────────────────────────────────────┘
```

- **The SPA runs in the browser**, so it talks to **host-published ports**
  (`http://127.0.0.1:8641`, `http://127.0.0.1:8080`) — its Settings defaults.
  Those work because compose publishes `8641`/`8080` to the host. The SPA does
  NOT use the compose network.
- **Mira talks to the MCP over the compose network**: `http://vantage-mcp:8640/mcp`
  (container DNS name). NOT `localhost` — inside a container `localhost` is itself.
- **Backend + MCP share the db** via the `vantage-data` named volume. The
  backend owns it (read-write; refresh writes). The MCP mounts it read-write at
  the OS layer too — see "Why the MCP mount is read-write" below — but is
  read-only **by doctrine** (ADR-010): its tool surface only ever reads.
- **Ollama runs on the host.** Containers reach it via `host.docker.internal`
  (mapped with `extra_hosts: host.docker.internal:host-gateway` for Linux; a
  no-op on Docker Desktop where the name already resolves).

## First run

```bash
cd /Users/pmuniraju/personal/vantage/deploy
cp .env.example .env          # edit ROBINHOOD_TOKEN_DIR + LLM_* to taste

make seed                     # ONE-TIME: copy the host vantage.db into the volume
make up                       # build + start (detached)
make health                   # curl the health endpoints
```

Then open **http://localhost:8642**.

Equivalent raw commands (run from `deploy/`, which auto-loads `.env`):

```bash
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml logs -f
docker compose -f docker-compose.yml down          # keep the data volume
docker compose -f docker-compose.yml down -v       # ALSO delete the db volume
```

## Seeding the database

The `vantage-data` named volume starts **empty**. The backend serves an empty
portfolio until you seed it. Two options:

1. **`make seed` (recommended).** Copies `../server/data-local/vantage.db` into
   the volume via a throwaway `alpine` container. Override the source with
   `make seed DB=/abs/path/to/vantage.db`. Safe to re-run (overwrites).

2. **Manual `docker cp`.** With the backend container created:
   ```bash
   docker compose -f docker-compose.yml create vantage-backend
   docker cp ../server/data-local/vantage.db \
     $(docker compose -f docker-compose.yml ps -q vantage-backend):/data/vantage.db
   ```

Regenerate the db from JSON files instead of copying? Run the migrator on the
host (writes `data-local/vantage.db`), then seed:
```bash
python -m vantage_server.migrate_to_sqlite --data-dir data-local   # in server/
```

The backend auto-creates the SQLite **schema** on first connect, so an empty
volume will not crash — reads just return no positions until seeded.

## Why the MCP mount is read-write

You'd expect `vantage-mcp` to mount the db `:ro`. It can't. The shared engine's
`db.py` forces `PRAGMA journal_mode=WAL` on every connect, and switching/opening
a db in WAL mode **writes** to the db file (to create/attach the `-wal` and
`-shm` sidecars). A read-only OS mount fails immediately with
`unable to open database file`; a read-only *file* fails with
`attempt to write a readonly database`.

So the MCP container:
- mounts `vantage-data` **read-write**, and
- runs as **uid 10001** (the same runtime user as the backend) so it can open
  the db the backend seeded/owns.

The **read-only guarantee is enforced in code, not the mount** (ADR-010): the
MCP tool surface only ever calls `Store.load_*`; it never calls a write method.
That is the actual safety boundary — the doctrine the whole `vantage-mcp`
package is built around — and it holds regardless of the OS mount mode.

(A future hardening could open the MCP's connection with `?mode=ro&immutable=1`
and skip the WAL pragma when the db is not writable, allowing a true `:ro`
mount. That is an engine change to `db.py`, out of scope here.)

## Seeded-db ownership (uid 10001)

The backend and MCP run as uid 10001 and open the db in WAL mode, which writes
the db file. So the seeded `vantage.db` (and the `/data` dir) must be **owned by
10001**. `make seed` handles this (`chown 10001:10001` + clears stale WAL/SHM
sidecars). If you seed by hand, chown the file to 10001 afterward, or the
backend crash-loops with `attempt to write a readonly database`.

## The Robinhood token (secret handling)

`POST /api/refresh` and `POST /api/ticket/execute` need the Robinhood OAuth
token. It is **never baked into the image**. The operator sets
`ROBINHOOD_TOKEN_DIR` in `.env` to the **host directory** containing
`.robinhood_token.json` (e.g. `~/personal/sentinel` — vantage inherited the
grant from the retired sentinel, chmod 600). Compose mounts the dir
**read-write** into the backend at `/run/secrets/robinhood`, and the backend's
`ROBINHOOD_TOKEN_FILE` env points at the file inside it. Read-write because
vantage now owns the grant: token refresh rotates the refresh token, and the
atomic save needs a writable parent dir (a single-file `:ro` mount can neither
be replaced nor updated). Reads work without a token. Leave
`ROBINHOOD_TOKEN_DIR` unset to run fully read-only (it defaults to a harmless
`/dev/null` mount).

## Verifying a running stack

```bash
curl http://localhost:8641/api/health           # backend
curl http://localhost:8641/api/accounts          # backend read (needs seeded db)
curl http://localhost:8642/healthz               # spa
curl http://localhost:8080/health                # mira
# MCP streamable-HTTP handshake (expect an SSE/JSON response, not a plain 200):
curl -i http://localhost:8640/mcp
# One Mira turn (needs Ollama up on the host):
curl -sN -X POST http://localhost:8080/turn -H 'content-type: application/json' \
  -d '{"prompt":"what is my allocation?"}'
```

## Rebuilding after code changes

`make up` (or `docker compose ... up --build`) rebuilds changed layers. The MCP
and SPA images build from the **repo root** context; the backend from `server/`;
Mira from `~/personal/mira`. After changing `src/app.jsx`, rebuild `app.js`
(`./build.sh`) before rebuilding the SPA image — the image ships the pre-built
`app.js`, not the JSX source.
