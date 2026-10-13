// Thin fetch wrapper: JSON in and out, a timeout, and one error shape.
//
//   import { API } from "./endpoints.js";
//   const info = await apiGet(API.info);
//   const run  = await apiPost(API.evtol.size, { baseline: "Archer_Midnight", overrides: {} });

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

async function request(method, path, { body, timeoutMs = 120000, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      // FastAPI puts our structured errors under "detail"; validation errors are a list.
      let detail = data?.detail ?? data;
      if (Array.isArray(detail)) {
        detail = { code: "validation_error", message: detail.map((d) => `${d.loc?.slice(1).join(".")}: ${d.msg}`).join("; ") };
      }
      throw new ApiError(response.status, detail);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError" && signal?.aborted) throw error; // caller cancelled
    if (error?.name === "TimeoutError" || controller.signal.reason?.name === "TimeoutError") {
      throw new ApiError(0, { code: "timeout", message: "The server took too long to answer." });
    }
    throw new ApiError(0, { code: "network", message: "Cannot reach the backend. Is it running on port 8000?" });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export const apiGet = (path, options) => request("GET", path, options);
export const apiPost = (path, body, options) => request("POST", path, { ...options, body });
