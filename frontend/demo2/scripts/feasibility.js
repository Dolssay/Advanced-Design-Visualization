// Feasibility slices for the form: streams POST /api/v1/evtol/feasibility and keeps
// one slice per parameter. A slice for p does not depend on p's own value, so when
// the user drags p only the other slices go stale (dimmed until their new line
// arrives). Every change aborts the running stream and, 600 ms after the last
// change, starts a new one with the changed slider first.

import { API } from "../../shared/api/endpoints.js";
import { apiStream } from "../../shared/api/client.js";

export function createFeasibility(keys, { getRequest, onSlice, onDone, onError, debounceMs = 600 }) {
  const slices = new Map(); // key -> { slice, stale }
  let controller = null;
  let timer = null;

  function schedule(changedKey) {
    controller?.abort(); // lines still in flight describe the previous design
    controller = null;
    for (const [key, entry] of slices) {
      if (key !== changedKey && !entry.stale) {
        entry.stale = true;
        onSlice(key, entry);
      }
    }
    clearTimeout(timer);
    timer = setTimeout(() => run(changedKey ? [changedKey] : []), debounceMs);
  }

  async function run(priority) {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    try {
      await apiStream(API.evtol.feasibility, { ...getRequest(), priority }, {
        signal: mine.signal,
        onLine: (line) => {
          if (controller !== mine) return;
          if (line.param) {
            const entry = { slice: line, stale: false };
            slices.set(line.param, entry);
            onSlice(line.param, entry);
          } else if (line.done) {
            onDone?.(line);
          } else if (line.error) {
            onError?.(line.error);
          }
        }
      });
    } catch (error) {
      if (controller !== mine || error.name === "AbortError") return;
      onError?.(error);
    } finally {
      if (controller === mine) controller = null;
    }
  }

  function reset() {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
    slices.clear();
    for (const key of keys) onSlice(key, null);
  }

  return {
    schedule,
    reset,
    get: (key) => slices.get(key) ?? null,
    all: () => slices,
    isFresh: (key) => Boolean(slices.get(key) && !slices.get(key).stale)
  };
}
