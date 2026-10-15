// Demo 2 entry point: wires the parameter form to the backend's /api/v1/evtol/* routes.
import "../shared/d3-global.js";
import { API } from "../shared/api/endpoints.js";
import { apiGet, apiPost } from "../shared/api/client.js";
import { constraintWarnings, createParameterForm } from "./scripts/form.js";
import { el } from "./scripts/format.js";
import { createResultView } from "./scripts/resultView.js";
import { createSweepView } from "./scripts/sweepView.js";
import { createSensitivityView } from "./scripts/sensitivityView.js";
import { createEnsembleView } from "./scripts/ensembleView.js";

const $ = (id) => document.getElementById(id);
const chip = $("status-chip");
const baselineSelect = $("baseline-select");
const sizeButton = $("size-button");
const warningsList = $("constraint-warnings");

let baselines = [];
let reference = null; // sized baseline, for deltas
let inFlight = null;

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
  const specByKey = Object.fromEntries(catalogue.parameters.map((p) => [p.key, p]));
  const form = createParameterForm($("param-form"), catalogue, {
    onChange: (design) => {
      const warnings = constraintWarnings(design);
      warningsList.replaceChildren(...warnings.map((w) => el("li", {}, [el("strong", { text: `${w.id} ` }), w.message])));
    }
  });
  const getRequest = () => ({ baseline: baselineSelect.value, overrides: form.getOverrides() });

  const result = createResultView($("view-result"));
  createSweepView($("view-sweep"), catalogue, {
    getRequest,
    onPick: (key, value) => { form.setValues({ [key]: value }); showView("result"); sizeCurrent(); }
  });
  createSensitivityView($("view-sensitivity"), catalogue, { getRequest });
  createEnsembleView($("view-ensemble"), catalogue, {
    getBaseline: () => baselineSelect.value,
    onPickDesign: (design) => {
      const clamped = {};
      for (const [k, v] of Object.entries(design)) {
        const s = specByKey[k];
        clamped[k] = Math.min(s.max, Math.max(s.min, s.integer ? Math.round(v) : v));
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
    form.setValues(b.design, { asBaseline: true });
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
      result.render(run, reference);
    } catch (error) {
      if (error.name !== "AbortError") result.renderError(error);
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
