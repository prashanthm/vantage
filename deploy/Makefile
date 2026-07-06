# Convenience wrapper for the containerized Vantage + Mira stack.
# Dev path stays `./stack` at the repo root; this is the Docker (prod/portable) path.
#
#   make -C deploy build     build all four images
#   make -C deploy seed      copy the host vantage.db into the named volume (one-time)
#   make -C deploy up        build + start the stack (detached)
#   make -C deploy down      stop and remove the stack (keeps the data volume)
#   make -C deploy logs      follow all service logs
#   make -C deploy ps        service status
#   make -C deploy health    curl the four health endpoints from the host
#   make -C deploy nuke      down + delete the data volume (destroys the seeded db)

COMPOSE := docker compose -f docker-compose.yml
# Host db to seed from (override: make -C deploy seed DB=/path/to/vantage.db)
DB ?= ../server/data-local/vantage.db

.PHONY: build seed up down logs ps health nuke

build:
	$(COMPOSE) build

# One-time DB seed: the named volume starts empty. This copies an existing
# vantage.db into it via a throwaway helper container. Safe to re-run (overwrites).
#
# The backend runs as uid 10001 and opens the db in SQLite WAL mode, which WRITES
# the main db file on schema init — so the seeded file (and any stale WAL/SHM
# sidecars) must be OWNED by 10001, else the backend hits "readonly database".
SEED_UID ?= 10001
seed:
	@test -f "$(DB)" || { echo "no db at $(DB) — set DB=/path/to/vantage.db"; exit 1; }
	docker run --rm \
		-v vantage_vantage-data:/data \
		-v "$(abspath $(DB))":/seed/vantage.db:ro \
		alpine:3 sh -c 'rm -f /data/vantage.db-wal /data/vantage.db-shm; \
			cp /seed/vantage.db /data/vantage.db && \
			chown $(SEED_UID):$(SEED_UID) /data /data/vantage.db && \
			echo "seeded /data/vantage.db (owner $(SEED_UID))"'

up:
	$(COMPOSE) up --build -d
	@echo "stack up. SPA: http://localhost:8642  backend: http://localhost:8641/api/health  mira: http://localhost:8080/health"

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

health:
	@echo "backend:"; curl -sf http://localhost:8641/api/health && echo " ok" || echo " DOWN"
	@echo "spa:";     curl -sf http://localhost:8642/healthz >/dev/null && echo " ok" || echo " DOWN"
	@echo "mira:";    curl -sf http://localhost:8080/health >/dev/null && echo " ok" || echo " DOWN"

nuke:
	$(COMPOSE) down -v
