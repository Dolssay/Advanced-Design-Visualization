// Demo 2 entry point: wires the parameter form to the backend's /api/v1/evtol/* routes.
import "../shared/d3-global.js";
import { API } from "../shared/api/endpoints.js";
import { apiGet, apiPost } from "../shared/api/client.js";
import { constraintWarnings, createParameterForm } from "./scripts/form.js";
import { createFeasibility } from "./scripts/feasibility.js";
import { bannerItems } from "./scripts/feasibilityModel.js";
import { createFeasibilityBanner } from "./scripts/banner.js";
import { el } from "./scripts/format.js";
import { createResultView } from "./scripts/resultView.js";
import { createSweepView } from "./scripts/sweepView.js";
import { createSensitivityView } from "./scripts/sensitivityView.js";
import { createEnsembleView } from "./scripts/ensembleView.js";

const $ = (id) => document.getElementById(id);
const chip = $("status-chip");
const baselineSelect = $("baseline-select");
const sizeButton = $("size-button");

let baselines = [];
let reference = null; // sized baseline, for deltas
let inFlight = null;
let sizeError = null; // message of the last failed /size, shown in the banner until the next success

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
      redrawBanner();
      feasibility.schedule(changedKey);
    }
  });
  const getRequest = () => ({ baseline: baselineSelect.value, overrides: form.getOverrides() });

  // Reasons banner (top of the panel) and the slider shading share one data source:
  // the feasibility slices streamed for the current design.
  const banner = createFeasibilityBanner($("feasibility-banner"), { onFix: (patch) => form.setValues(patch) });
  const feasibility = createFeasibility(specs.map((s) => s.key), {
    getRequest,
    onSlice: (key, entry) => { form.setFeasibility(key, entry); redrawBanner(); },
    onDone: redrawBanner,
    onError: (error) => { console.warn("feasibility stream failed", error); redrawBanner(); }
  });
  function redrawBanner() {
    const design = form.getDesign();
    banner.render(bannerItems({ design, specs, slices: feasibility.all(), warnings: constraintWarnings(design), sizeError }));
  }

  const result = createResultView($("view-result"));
  createSweepView($("view-sweep"), catalogue, {
    getRequest,
    onPick: (key, value) => { form.setValues({ [key]: value }); showView("result"); sizeCurrent(); }
  });
  createSensitivityView($("view-sensitivity"), catalogue, { getRequest });
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
    form.setValues(b.design, { asBaseline: true }); // onChange -> schedule(null): all 12 slices
    reference = null;
    await sizeCurrent();
  }

  async function sizeCurrent() {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    sizeButton.disabled = true;
    result.renderLoading();
    const body = getRequest();
    try {
      const run = await apiPost(API.evtol.size, body, { signal: controller.signal });
      if (!Object.keys(body.overrides).length) reference = run;
      sizeError = null;
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
        sizeButton.disabled = false;
      }
    }
  }

  baselineSelect.addEventListener("change", loadBaseline);
  sizeButton.addEventListener("click", sizeCurrent);
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
