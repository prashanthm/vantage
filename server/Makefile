# Vantage backend — self-contained venv under server/.venv (Python 3.12).
# Uses uv when available, plain python3.12 venv otherwise.

VENV := .venv
PY   := $(VENV)/bin/python

.PHONY: setup test run-api run-mcp run-api-live run-mcp-live clean

setup:
	@if command -v uv >/dev/null 2>&1; then \
		uv venv --python 3.12 $(VENV) && \
		uv pip install --python $(PY) -e '.[dev]'; \
	else \
		python3.12 -m venv $(VENV) && \
		$(PY) -m pip install --upgrade pip && \
		$(PY) -m pip install -e '.[dev]'; \
	fi

test:
	$(PY) -m pytest -q

run-api:
	$(VENV)/bin/uvicorn vantage_server.api:app --host 127.0.0.1 --port 8641

run-mcp:
	$(PY) -m vantage_server.mcp_server

# Same servers with live Stooq quotes overlaid (fixture fallback on failure).
run-api-live:
	VANTAGE_QUOTES=stooq $(VENV)/bin/uvicorn vantage_server.api:app --host 127.0.0.1 --port 8641

run-mcp-live:
	VANTAGE_QUOTES=stooq $(PY) -m vantage_server.mcp_server

clean:
	rm -rf $(VENV) *.egg-info .pytest_cache
	find . -name __pycache__ -type d -exec rm -rf {} +
