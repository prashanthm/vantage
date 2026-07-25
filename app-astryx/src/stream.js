// Mira streaming client (ported from src/live.js streamTurn + src/
// use_stream_turn.js collectTurn for the Astryx shell). Same wire protocol:
// POST {miraUrl}/turn, SSE frames, exactly one terminal event unless aborted.
import { parseMira } from "./mira.jsx";

const miraBase = () =>
  (JSON.parse(localStorage.getItem("vantage-settings") || "{}").miraUrl
    || "http://127.0.0.1:8080").replace(/\/+$/, "");

function parseSseFrame(frame) {
  let kind = null;
  const dataLines = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) kind = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!kind && dataLines.length === 0) return null;
  let data = {};
  if (dataLines.length) {
    const raw = dataLines.join("\n");
    try { data = JSON.parse(raw); } catch (e) { data = { text: raw }; }
  }
  if (typeof data !== "object" || data === null) data = { text: String(data) };
  return { ...data, kind: kind || "message" };
}

export function streamTurn(prompt, thread, onEvent) {
  const ctrl = new AbortController();
  let terminal = false;
  const emit = (evt) => {
    if (terminal || !evt) return;
    if (evt.kind === "done" || evt.kind === "error") terminal = true;
    try { onEvent(evt); } catch (e) { /* a view error must not kill the stream */ }
  };
  (async () => {
    let res;
    try {
      res = await fetch(`${miraBase()}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, thread_id: thread }),
        signal: ctrl.signal,
      });
    } catch (e) {
      emit({ kind: "error", code: "unreachable", message: "Mira is not reachable" });
      return;
    }
    if (!res.ok || !res.body) {
      emit({ kind: "error", code: "unreachable", message: `Mira answered ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf("\n\n")) !== -1) {
          emit(parseSseFrame(buf.slice(0, cut)));
          buf = buf.slice(cut + 2);
        }
      }
      emit(parseSseFrame(buf));
      emit({ kind: "done" });
    } catch (e) {
      emit({ kind: "error", code: "unreachable", message: "stream interrupted" });
    }
  })();
  return () => { terminal = true; ctrl.abort(); };
}

// Accumulate one streamTurn to completion. Resolves {text, data, error?};
// never rejects. onToken(partial) fires per delta.
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
        if (evt.text && !text) text = evt.text;
        resolve({ text, data: text ? parseMira(text) : null, corr: evt.correlation_id || null });
      }
    });
    if (setAbort) setAbort(abort);
  });
}
