import { loadGTB777Data } from "./scripts/filteredGTB777.js";
import { createScatterplotMatrix } from "./scripts/splomGTB777.js";
import { createParallelCoordinates } from "./scripts/parallelCoordinates.js";
import { createTornadoPlot } from "./scripts/tornadoPlot.js";
import { createBoxViolinPlot } from "./scripts/boxViolinPlot.js";
import { createHeatmapPlot } from "./scripts/heatmapPlot.js";
import { createContentController, createContentBox } from "./scripts/contentbox.js";
import { createToolController, createToolsBar } from "./scripts/tools.js";
import { createPlotSection, createTitleTab } from "./scripts/tiltleTab.js";
import { createGTB777Profiler, createGTB777ProfilerModel } from "./scripts/profilerGTB777.js";

const app = document.getElementById("app");
const controller = createToolController();

// Plots that react to the Content box (label filter and/or highlighted points) come
// first and share one layout column with the sticky Content box on their right.
// Plots that ignore it (the profiler always uses the fit over all designs) follow
// below at full width.
const LINKED_PLOTS = [
  { id: "plot-scatterplot-matrix", title: "Scatterplot Matrix" },
  { id: "plot-parallel-coordinates", title: "Parallel Coordinates" },
  { id: "plot-box-violin", title: "Box & Violin by Label" },
  { id: "plot-heatmap", title: "Design-Space Heatmap" },
  // Filter-only: reacts to the label filter but not to highlighted points.
  { id: "plot-tornado", title: "Tornado Plot" }
];

const STANDALONE_PLOTS = [
  { id: "plot-prediction-profiler", title: "Prediction Profiler" }
];

async function init() {
  try {
    const data = await loadGTB777Data("../../../data/GTB777.csv");
    const contentController = createContentController(data);
    // Fit once; the profiler and tornado plot share the same response model.
    const profilerModel = createGTB777ProfilerModel(data);

    const page = document.createElement("div");
    page.className = "webviz-page";

    const shell = document.createElement("div");
    shell.className = "webviz-shell";

    const linkedNodes = {
      "plot-scatterplot-matrix": () => createScatterplotMatrix(data, controller, contentController),
      "plot-parallel-coordinates": () => createParallelCoordinates(data, controller, contentController),
      "plot-tornado": () => createTornadoPlot(data, contentController, profilerModel),
      "plot-box-violin": () => createBoxViolinPlot(data, controller, contentController),
      "plot-heatmap": () => createHeatmapPlot(data, controller, contentController)
    };

    const standaloneNodes = {
      "plot-prediction-profiler": () =>
        createGTB777Profiler(data, controller, contentController, profilerModel)
    };

    const linkedGroup = document.createElement("div");
    linkedGroup.className = "webviz-linked-group";

    const linkedColumn = document.createElement("div");
    linkedColumn.className = "webviz-linked-plots";
    linkedColumn.append(
      ...LINKED_PLOTS.map((plot) =>
        createPlotSection({ id: plot.id, title: plot.title, node: linkedNodes[plot.id]() })
      )
    );

    const contentColumn = document.createElement("div");
    contentColumn.className = "webviz-content-column";
    contentColumn.appendChild(createContentBox(contentController, controller));

    linkedGroup.append(linkedColumn, contentColumn);

    const standaloneSections = STANDALONE_PLOTS.map((plot) =>
      createPlotSection({ id: plot.id, title: plot.title, node: standaloneNodes[plot.id]() })
    );

    shell.append(createToolsBar(controller), linkedGroup, ...standaloneSections);

    page.append(
      createTitleTab([...LINKED_PLOTS, ...STANDALONE_PLOTS]),
      shell
    );

    app.appendChild(page);
  } catch (error) {
    console.error(error);

    const message = document.createElement("div");
    message.className = "error";
    message.textContent =
      `Failed to load GTB777 dataset: ${error.message}`;

    app.appendChild(message);
  }
}

init();
