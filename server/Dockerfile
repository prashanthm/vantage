# Vantage backend — deterministic portfolio engine + REST API for the SPA.
#
# FastAPI on :8641. Reads/writes a single vantage.db (SQLite, WAL) under /data —
# the mounted named volume it OWNS (POST /api/refresh writes broker holdings).
# The [robinhood,zerodha] extras pull the read-only broker SDKs (mcp for
# Robinhood, kiteconnect for Zerodha) used by /api/refresh and the account sync.
# /api/refresh is importable. The RH OAuth token is NEVER baked in — it is
# mounted at runtime and located via ROBINHOOD_TOKEN_FILE (see docker-compose).
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    VANTAGE_DB=/data/vantage.db \
    VANTAGE_QUOTES=fixture

WORKDIR /app

# Dependency layer first for build caching: metadata + package, then install.
COPY pyproject.toml README.md ./
COPY vantage_server ./vantage_server
RUN pip install ".[robinhood,zerodha,telegram]"

# Non-root runtime user; owns /data so the volume is writable (refresh + WAL).
RUN useradd --create-home --uid 10001 vantage \
    && mkdir -p /data \
    && chown -R vantage:vantage /data /app
USER vantage

EXPOSE 8641

# Reads VANTAGE_DB / VANTAGE_QUOTES / ROBINHOOD_TOKEN_FILE from env at boot.
CMD ["python", "-m", "uvicorn", "vantage_server.api:app", "--host", "0.0.0.0", "--port", "8641"]
