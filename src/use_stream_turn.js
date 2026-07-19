// useStreamTurn — one home for the Mira streaming lifecycle that ~5 analyze panes
// (portfolio actions, forecast, replay generate/grade, journal reads) each hand-rolled:
// abortRef + token accumulation + the "done text fallback" + parseMira. The global
// ChatPanel (plan_step + corr + chat history + canned fallback) is deliberately NOT
// folded in — it's a different shape; over-generalizing it would cost more than it saves.
import { parseMira } from "./mira-render.jsx";
import { streamTurn } from "./live.js";

const { useState, useRef, useEffect, useCallback } = React;

// Accumulate one streamTurn to completion. Resolves { text, data } (data = parseMira
// of the full text, or null). onToken(partialText) fires per delta for live rendering.
// Returns the abort fn via opts.setAbort so a caller/hook can cancel. Never rejects —
// an error resolves { text:"", data:null, error }.
export function collectTurn(prompt, thread, { onToken, setAbort } = {}) {
  return new Promise((resolve) => {
    let text = "";
    const abort = streamTurn(prompt, thread, (evt) => {
      if (evt.kind === "error") {
        if (setAbort) setAbort(null);
        resolve({ text, data: text ? parseMira(text) : null, error: evt.message || evt.text || "Mira error" });
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
