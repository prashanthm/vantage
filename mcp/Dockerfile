# Vantage MCP — the AI-facing read-only tool surface over the vantage-server engine.
#
# Streamable HTTP on :8640/mcp. Depends on the vantage-server package (the
# deterministic engine), which is a path dependency kept OUT of pyproject
# metadata — so this image installs ../server explicitly, then this package.
#
# IMPORTANT: build with the VANTAGE REPO ROOT as the build context so both
# `server/` and `mcp/` are visible:
#     docker build -f mcp/Dockerfile -t vantage-mcp .
# (docker-compose does this via `context: ..` + `dockerfile: mcp/Dockerfile`.)
#
# Reads the SAME vantage.db as the backend, mounted READ-ONLY at /data.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    VANTAGE_DB=/data/vantage.db \
    VANTAGE_QUOTES=fixture \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8640 \
    MCP_PATH=/mcp

WORKDIR /app

# Install the engine (the [robinhood] extra is NOT needed here — MCP is
# read-only and never refreshes), then the MCP tool package. Both installed
# non-editable: the images are self-contained.
COPY server/pyproject.toml server/README.md /app/server/
COPY server/vantage_server /app/server/vantage_server
RUN pip install /app/server

COPY mcp/pyproject.toml mcp/README.md /app/mcp/
COPY mcp/vantage_mcp /app/mcp/vantage_mcp
RUN pip install /app/mcp

# Non-root runtime user (db is mounted read-only, so no writable state needed).
RUN useradd --create-home --uid 10002 vantagemcp
USER vantagemcp

EXPOSE 8640

# MCP_HOST=0.0.0.0 (env, honored by the server module) so it binds in-container.
CMD ["python", "-m", "vantage_mcp.server"]
