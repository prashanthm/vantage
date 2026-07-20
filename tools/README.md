# tools/

## CodeGraph — local code map (token-efficient navigation)

`@colbymchenry/codegraph` indexes the repo into a local SQLite symbol/call graph
(`.codegraph/`, gitignored) so agents locate code without grepping/reading whole files.
**CLI-only — no MCP server, no global config edits** (evaluated + chosen that way;
see `codegraph-eval.md`).

### Use it
```
codegraph query <name>        # where a symbol/route/file is + signature
codegraph callers <symbol>    # who calls it
codegraph callees <symbol>    # its dependencies
codegraph impact <symbol>     # blast radius before editing
codegraph explore "<phrase>"  # semantic context + call flow
codegraph sync                # incremental re-index (also runs auto on commit)
codegraph index --force       # full rebuild
```

### Setup (once per clone)
```
npm i -g @colbymchenry/codegraph   # CLI binary (do NOT run `codegraph install` — that's the MCP/global path)
codegraph init                     # build .codegraph/ in this repo
codegraph telemetry off            # no phone-home
bash .githooks/install.sh          # auto-sync the graph on every commit
```

- `.githooks/post-commit` runs `codegraph sync` (backgrounded, no-op if codegraph
  absent) so the graph never drifts. `.githooks/install.sh` points git at it.
- `codegraph-eval.md` — the evaluation (accuracy, token win, install-footprint audit).
