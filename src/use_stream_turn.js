// useStreamTurn — one home for the AI streaming lifecycle that ~5 analyze panes
// (portfolio actions, forecast, replay generate/grade, journal reads) each hand-rolled:
// abortRef + token accumulation + the "done text fallback" + parseMira. The global
// ChatPanel (plan_step + corr + chat history + canned fallback) is deliberately NOT
// folded in — it's a different shape; over-generalizing it would cost more than it saves.
import { parseMira } from "./mira-render.jsx";
import { streamTurn, streamClaudeForecast, buildForecastPrompt } from "./live.js";

const { useState, useRef, useEffect, useCallback } = React;

// Accumulate one SSE stream (started by `start(onEvent)` → abort fn) to
// completion. Resolves { text, data } (data = parseMira of the full text, or
// null). onToken(partialText) fires per delta for live rendering. Returns the
// abort fn via opts.setAbort so a caller/hook can cancel. Never rejects —
// an error resolves { text:"", data:null, error }.
function collectStream(start, { onToken, setAbort } = {}) {
  return new Promise((resolve) => {
    let text = "";
    const abort = start((evt) => {
      if (evt.kind === "error") {
        if (setAbort) setAbort(null);
        resolve({ text, data: text ? parseMira(text) : null, error: evt.message || evt.text || "AI error" });
        return;
      }
      if ((evt.kind === "token" || evt.kind === "delta" || evt.kind === "message") && evt.text) {
        text += evt.text;
        if (onToken) onToken(text);
        return;
      }
      if (evt.kind === "done") {
        if (setAbort) setAbort(null);
        if (evt.text && !text) text = evt.text;   // some backends deliver the whole answer on done
        resolve({ text, data: text ? parseMira(text) : null, corr: evt.correlation_id || null });
      }
    });
    if (setAbort) setAbort(abort);
  });
}

// Accumulate one Mira /turn to completion (the general chat/analyze path).
export function collectTurn(prompt, thread, opts = {}) {
  return collectStream((onEvent) => streamTurn(prompt, thread, onEvent), opts);
}

// Accumulate one FORECAST to completion — Claude first (the backend's enriched
// prompt + Anthropic API), falling back to Mira's forecast_analyst when Claude
// is unconfigured/unreachable so the forecast button still works on a box
// without an ANTHROPIC_API_KEY. Resolves { text, data, provider, error? }.
export function collectForecast(symbol, snapshot, opts = {}) {
  const day = snapshot && snapshot.day;
  const asOf = snapshot && snapshot.as_of;
  return collectStream(
    (onEvent) => streamClaudeForecast({ symbol, day, asOf, snapshot }, onEvent), opts,
  ).then((r) => {
    if (!r.error || r.text) return { ...r, provider: "claude" };
    // Claude produced nothing — fall back to Mira, which resolves the snapshot
    // ref itself via the vantage MCP tools.
    const ref = `SPX_SNAPSHOT_REF day=${day} as_of=${asOf} underlying=${symbol}`;
    return collectTurn(buildForecastPrompt(symbol, ref), `forecast-${symbol}-${asOf}`, opts)
      .then((m) => ({ ...m, provider: "mira" }));
  });
}

// UI hook for a fire-and-render analyze pane. `run(prompt, thread)` streams a turn;
// `state` is null | {loading, text} | {text, data} | {error, text}. Aborts on unmount.
// Pass `deps` whose change should reset the pane (e.g. the account/symbol scope).
export function useStreamTurn(deps = []) {
  const [state, setState] = useState(null);
  const abortRef = useRef(null);
  const setAbort = useCallback((fn) => { abortRef.current = fn; }, []);

  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);
  // a scope change invalidates the prior read.
  useEffect(() => { setState(null); }, deps);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback((prompt, thread) => {
    setState({ loading: true, text: "" });
    collectTurn(prompt, thread, {
      onToken: (text) => setState({ loading: true, text }),
      setAbort,
    }).then(({ text, data, error }) => {
      setState(error ? { error, text } : { text, data });
    });
  }, [setAbort]);

  const abort = useCallback(() => { if (abortRef.current) abortRef.current(); }, []);
  const running = !!state && state.loading;
  return { state, run, running, abort, reset: () => setState(null) };
}
