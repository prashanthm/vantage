.PHONY: setup test run run-live clean

PY := $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)

# One-time: venv + the engine package (editable, from ../server) + this package.
setup:
	@if command -v uv >/dev/null 2>&1; then \
		uv venv .venv --python 3.12 --seed; \
		uv pip install --python .venv/bin/python -e ../server -e ".[dev]"; \
	else \
		python3.12 -m venv .venv; \
		.venv/bin/python -m pip install -e ../server -e ".[dev]"; \
	fi
	@echo "Done. Run 'make run' to serve MCP on 127.0.0.1:8640/mcp."

test:
	$(PY) -m pytest -q

# Serve the vantage.* tool surface (fixture quotes).
run:
	$(PY) -m vantage_mcp.server

# Same, with the live delayed quote feed.
run-live:
	VANTAGE_QUOTES=stooq $(PY) -m vantage_mcp.server

clean:
	rm -rf .venv vantage_mcp/__pycache__ tests/__pycache__ .pytest_cache
