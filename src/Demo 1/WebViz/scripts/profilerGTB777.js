import { createLogLinearModel } from "./profilerModel.js";
import { createProfiler } from "./profiler.js";

const FACTORS = [
  { key: "ARHT", label: "ARHT" },
  { key: "TRHT", label: "TRHT" },
  { key: "TCHT", label: "TCHT" },
  { key: "SWPHT (deg)", label: "SWPHT", unit: "deg" },
  { key: "SHT (sqft)", label: "SHT", unit: "sqft" },
  { key: "ETAIE", label: "ETAIE" },
  { key: "ETAOE", label: "ETAOE" },
  { key: "CRE", label: "CRE" }
];

const RESPONSES = [
  { key: "OEW (1000 lbm)", label: "OEW", unit: "1000 lbm" },
  { key: "Block Fuel (1000 lbm)", label: "Block Fuel", unit: "1000 lbm" },
  { key: "Cruise CD (count)", label: "Cruise CD", unit: "count" }
];

export function createGTB777ProfilerModel(data) {
  return createLogLinearModel({ factors: FACTORS, responses: RESPONSES, rows: data });
}

function attachSyncControl(profiler, controller, contentController) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "profiler-button";
  button.textContent = "Sync to selection";

  function getSelectedPointId() {
    const ids = Array.from(controller.getAllPinnedIds?.() ?? []);
    return ids.length === 1 ? ids[0] : null;
  }

  function updateButton() {
    const count = controller.getAllPinnedIds?.().size ?? 0;
    button.disabled = getSelectedPointId() === null;
    button.title = count === 0
      ? "Select one design in the scatterplot matrix to load its values here"
      : count === 1
        ? "Move every factor to the selected design's values"
        : `Select exactly one design (${count} are selected)`;
  }

  button.addEventListener("click", () => {
    const pointId = getSelectedPointId();
    const row = pointId ? contentController.getRowByPointId(pointId) : null;
    if (!row) {
      return;
    }

    const values = {};
    for (const factor of FACTORS) {
      values[factor.key] = row[factor.key];
    }
    profiler.setCrosshair(values);
  });

  controller.subscribe((event) => {
    if (event.type === "pins") {
      updateButton();
    }
  });

  updateButton();
  profiler.controlsNode.prepend(button);
}

function attachFilterNotice(profiler, contentController, sampleCount) {
  function updateNotice() {
    const selected = contentController.getSelectedLabels().size;
    const total = contentController.getLabels().length;
    profiler.setNotice(
      selected === total
        ? null
        : `Label filter applies to the linked plots above only. These curves still come from the fit over all ${sampleCount} designs.`
    );
  }

  contentController.subscribe((event) => {
    if (event.type === "labels") {
      updateNotice();
    }
  });

  updateNotice();
}

export function createGTB777Profiler(data, controller = null, contentController = null, model = null) {
  const fitted = model ?? createGTB777ProfilerModel(data);

  const profiler = createProfiler({
    factors: FACTORS,
    responses: RESPONSES,
    model: fitted,
    title: "GTB777 Prediction Profiler",
    subtitle: `Fitted response surface over all ${fitted.getSampleCount()} designs. Curves come from the regression, not the sampled points.`
  });

  if (controller?.subscribe && contentController?.getRowByPointId) {
    attachSyncControl(profiler, controller, contentController);
  }

  if (contentController?.subscribe) {
    attachFilterNotice(profiler, contentController, fitted.getSampleCount());
  }

  return profiler;
}
