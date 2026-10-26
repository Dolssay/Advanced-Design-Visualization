// Demo 2 entry point: wires the parameter form to the backend's /api/v1/evtol/* routes.
import "../shared/d3-global.js";
import { API } from "../shared/api/endpoints.js";
import { apiGet, apiPost } from "../shared/api/client.js";
import { constraintWarnings, createParameterForm } from "./scripts/form.js";
import { createFeasibility } from "./scripts/feasibility.js";
import { bannerItems } from "./scripts/feasibilityModel.js";
import { createFeasibilityBanner } from "./scripts/banner.js";
import { createConstraintsBox } from "./scripts/constraints.js";
import { el } from "./scripts/format.js";
import { createResultView } from "./scripts/resultView.js";
import { createSweepView } from "./scripts/sweepView.js";
import { createSensitivityView } from "./scripts/sensitivityView.js";
import { createScreeningView } from "./scripts/screeningView.js";
import { createEnsembleView } from "./scripts/ensembleView.js";

const $ = (id) => document.getElementById(id);
const chip = $("status-chip");
const baselineSelect = $("baseline-select");
const sizeButton = $("size-button");
const autoToggle = $("auto-size");
const rangeToggle = $("range-finder");

// Auto-size: call /size by itself after the sliders settle. A cold /size renders
// five plots and takes ~0.5-0.7 s, so the debounce is longer than the 600 ms one
// for feasibility: the moved slider's verdict is in before we decide to size.
const AUTO_SIZE_KEY = "demo2.autoSize";
const RANGE_FINDER_KEY = "demo2.rangeFinder";
const AUTO_SIZE_DEBOUNCE_MS = 900;

let baselines = [];
let reference = null; // sized baseline, for deltas
let inFlight = null;
let inFlightAuto = false; // the request in flight was started by auto-size
let autoTimer = null;
let sizeError = null; // message of the last failed /size for the current design, shown in the banner
let lastItems = []; // banner items for the current design
let lastChanged = null; // the slider changed most recently; its banner item leads
let shownRequest = null; // JSON of the request behind the result on screen

function loadToggle(key) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

function saveToggle(key, on) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // private mode or blocked storage: the toggle still works for this page load
  }
}

async function init() {
  try {
    const [info, catalogue, list] = await Promise.all([
      apiGet(API.info), apiGet(API.evtol.parameters), apiGet(API.evtol.baselines)
    ]);
    setChip(info);
    baselines = list.baselines;
    start(catalogue);
  } catch (error) {
    chip.className = "chip chip-bad";
    chip.textContent = "Backend offline";
    $("view-result").replaceChildren(el("div", { class: "error-box", role: "alert" }, [
      el("strong", { text: "Cannot load Demo 2." }),
      el("p", { text: error.message }),
      el("p", { class: "hint", text: "Start the backend: cd backend && uvicorn app.main:app --reload --port 8000" })
    ]));
  }
}

function setChip(info) {
  chip.className = `chip ${info.ready ? "chip-ok" : "chip-pending"}`;
  chip.textContent = `API ${info.version} · ${info.ready ? "ready" : "starting"}`;
  chip.title = `git ${info.git_sha} · evtolpy ${info.evtolpy_sha}`;
}

function start(catalogue) {
  const specs = catalogue.parameters;
  const specByKey = Object.fromEntries(specs.map((p) => [p.key, p]));
  const form = createParameterForm($("param-form"), catalogue, {
    onChange: (design, changedKey) => {
      if (changedKey) {
        sizeError = null; // the last /size error was about the previous design
        lastChanged = changedKey;
      }
      redrawBanner();
      constraints.render(design);
      if (rangeToggle.checked) feasibility.schedule(changedKey);
      if (changedKey) scheduleAutoSize(); // baseline loads and ensemble picks size on their own
      updateStale();
    }
  });
  const getRequest = () => ({ baseline: baselineSelect.value, overrides: form.getOverrides() });

  // Reasons banner (top of the panel) and the slider shading share one data source:
  // the feasibility slices streamed for the current design.
  const constraints = createConstraintsBox($("constraints-box"));
  const banner = createFeasibilityBanner($("feasibility-banner"), { onFix: (patch) => form.setValues(patch) });
  const feasibility = createFeasibility(specs.map((s) => s.key), {
    getRequest,
    onSlice: (key, entry) => { form.setFeasibility(key, entry); redrawBanner(); },
    onDone: redrawBanner,
    onError: (error) => { console.warn("feasibility stream failed", error); redrawBanner(); }
  });
  function redrawBanner() {
    const design = form.getDesign();
    lastItems = bannerItems({ design, specs, slices: feasibility.all(), warnings: constraintWarnings(design), sizeError, first: lastChanged });
    // Range finder off: no slices will arrive, so drop the "Checking feasible ranges" line.
    if (!rangeToggle.checked) lastItems = lastItems.filter((item) => item.kind !== "pending");
    banner.render(lastItems);
  }

  // A red banner item: the current value of some input sits in a failing segment.
  // Sizing would only repeat what the banner already says, so auto-size waits.
  const designFails = () => lastItems.some((item) => item.kind === "feasibility" && !item.stale);

  function scheduleAutoSize() {
    clearTimeout(autoTimer);
    autoTimer = null;
    if (!autoToggle.checked) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (!autoToggle.checked || designFails()) return updateStale();
      sizeCurrent({ auto: true });
    }, AUTO_SIZE_DEBOUNCE_MS);
  }

  // The plot is out of date when the inputs moved since it was sized and no
  // sizing is queued or running (auto-size off, or held back by a failing input).
  function updateStale() {
    const moved = shownRequest !== null && JSON.stringify(getRequest()) !== shownRequest;
    result.setStale(moved && !inFlight && !autoTimer);
  }

  function cancelAutoSize() {
    clearTimeout(autoTimer);
    autoTimer = null;
    if (inFlightAuto) inFlight?.abort();
  }

  const result = createResultView($("view-result"), { onSize: () => sizeCurrent() });
  createSweepView($("view-sweep"), catalogue, {
    getRequest,
    onPick: (key, value) => { form.setValues({ [key]: value }); showView("result"); sizeCurrent(); }
  });
  createSensitivityView($("view-sensitivity"), catalogue, { getRequest });
  createScreeningView($("view-screening"), catalogue, {
    getBaseline: () => baselineSelect.value
  });
  createEnsembleView($("view-ensemble"), catalogue, {
    getBaseline: () => baselineSelect.value,
    onPickDesign: (design) => {
      // Clamp to the slider range (not the study box), so ensemble designs load unchanged.
      const clamped = {};
      for (const [k, v] of Object.entries(design)) {
        const [lo, hi] = form.range(k);
        clamped[k] = Math.min(hi, Math.max(lo, specByKey[k].integer ? Math.round(v) : v));
      }
      form.setValues(clamped);
      showView("result");
      sizeCurrent();
    }
  });

  baselineSelect.replaceChildren(...baselines.map((b) => el("option", { value: b.name, text: b.label })));
  baselineSelect.value = baselines.some((b) => b.name === "Archer_Midnight") ? "Archer_Midnight" : baselines[0].name;

  async function loadBaseline() {
    const b = baselines.find((x) => x.name === baselineSelect.value);
    feasibility.reset();
    sizeError = null;
    constraints.setBaselineRotors(b.rotors);
    form.setValues(b.design, { asBaseline: true }); // onChange -> schedule(null): all 12 slices
    reference = null;
    await sizeCurrent();
  }

  async function sizeCurrent({ auto = false } = {}) {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    inFlightAuto = auto;
    updateStale();
    sizeButton.disabled = true;
    if (result.hasResult()) result.setPending(true); // keep the cards, dim them until the new run lands
    else result.renderLoading();
    const body = getRequest();
    try {
      const run = await apiPost(API.evtol.size, body, { signal: controller.signal });
      if (!Object.keys(body.overrides).length) reference = run;
      sizeError = null;
      shownRequest = JSON.stringify(body);
      result.render(run, reference);
      redrawBanner();
    } catch (error) {
      if (error.name === "AbortError") return;
      result.renderError(error);
      if (error.detail?.code === "sizing_failed") {
        sizeError = error.message;
        redrawBanner();
      }
    } finally {
      if (inFlight === controller) {
        inFlight = null;
        inFlightAuto = false;
        sizeButton.disabled = false;
        result.setPending(false);
        updateStale();
      }
    }
  }

  // Off: abort the stream and clear the shading; on: stream all twelve slices again.
  const applyRangeFinder = () => {
    $("param-form").classList.toggle("range-off", !rangeToggle.checked);
    if (rangeToggle.checked) feasibility.schedule(null);
    else feasibility.reset();
    redrawBanner();
  };
  rangeToggle.checked = loadToggle(RANGE_FINDER_KEY);
  $("param-form").classList.toggle("range-off", !rangeToggle.checked);
  rangeToggle.addEventListener("change", () => {
    saveToggle(RANGE_FINDER_KEY, rangeToggle.checked);
    applyRangeFinder();
  });

  autoToggle.checked = loadToggle(AUTO_SIZE_KEY);
  autoToggle.addEventListener("change", () => {
    saveToggle(AUTO_SIZE_KEY, autoToggle.checked);
    if (!autoToggle.checked) cancelAutoSize();
    updateStale();
  });

  baselineSelect.addEventListener("change", loadBaseline);
  sizeButton.addEventListener("click", () => sizeCurrent());
  $("reset-button").addEventListener("click", loadBaseline);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sizeCurrent();
  });
  loadBaseline();
}

function showView(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    const on = tab.dataset.view === name;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", String(on));
  }
  for (const view of document.querySelectorAll(".view")) {
    const on = view.id === `view-${name}`;
    view.hidden = !on;
    view.classList.toggle("is-active", on);
  }
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => showView(tab.dataset.view));
}

init();
