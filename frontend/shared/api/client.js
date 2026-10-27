// Thin fetch wrapper: JSON in and out, a timeout, and one error shape.
//
//   import { API } from "./endpoints.js";
//   const info = await apiGet(API.info);
//   const run  = await apiPost(API.evtol.size, { baseline: "Archer_Midnight", overrides: {} });
//   await apiStream(API.evtol.feasibility, body, { onLine: (obj) => ... });   // NDJSON, one object per line

export class ApiError extends Error {
  constructor(status, detail) {
    const message =
      (detail && typeof detail === "object" && detail.message) ||
      (typeof detail === "string" ? detail : `Request failed (${status})`);
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

// One AbortController that fires on the caller's signal or on the timeout.
function armed(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  };
  return { controller, cleanup };
}

function parseBody(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function errorDetail(data) {
  // FastAPI puts our structured errors under "detail"; validation errors are a list.
  let detail = data?.detail ?? data;
  if (Array.isArray(detail)) {
    detail = { code: "validation_error", message: detail.map((d) => `${d.loc?.slice(1).join(".")}: ${d.msg}`).join("; ") };
  }
  return detail;
}

function translate(error, controller, signal) {
  if (error instanceof ApiError) return error;
  if (error?.name === "AbortError" && signal?.aborted) return error; // caller cancelled
  if (error?.name === "TimeoutError" || controller.signal.reason?.name === "TimeoutError") {
    return new ApiError(0, { code: "timeout", message: "The server took too long to answer." });
  }
  if (error instanceof SyntaxError) return new ApiError(0, { code: "bad_response", message: "The server sent an unreadable line." });
  return new ApiError(0, { code: "network", message: "Cannot reach the backend. Is it running on port 8000?" });
}

async function request(method, path, { body, timeoutMs = 120000, signal } = {}) {
  const { controller, cleanup } = armed(signal, timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const data = parseBody(await response.text());
    if (!response.ok) throw new ApiError(response.status, errorDetail(data));
    return data;
  } catch (error) {
    throw translate(error, controller, signal);
  } finally {
    cleanup();
  }
}

export const apiGet = (path, options) => request("GET", path, options);
export const apiPost = (path, body, options) => request("POST", path, { ...options, body });

// POST and read an NDJSON stream: `onLine(object)` for every line as it arrives.
// Resolves with the last line (the backend's summary line) when the stream ends.
// A non-2xx status is raised as an ApiError before any line is read.
export async function apiStream(path, body, { onLine, timeoutMs = 120000, signal } = {}) {
  const { controller, cleanup } = armed(signal, timeoutMs);
  let last = null;
  const emit = (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    last = JSON.parse(trimmed);
    onLine?.(last);
  };
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new ApiError(response.status, errorDetail(parseBody(await response.text())));

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        emit(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    emit(buffer + decoder.decode());
    return last;
  } catch (error) {
    throw translate(error, controller, signal);
  } finally {
    cleanup();
  }
}
