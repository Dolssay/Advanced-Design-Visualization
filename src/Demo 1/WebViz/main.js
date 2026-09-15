import { loadGTB777Data } from "./scripts/filteredGTB777.js";
import { createScatterplotMatrix } from "./scripts/splomGTB777.js";
import { createParallelCoordinates } from "./scripts/parallelCoordinates.js";
import { createContentController } from "./scripts/contentbox.js";
import { createToolController, createToolsBar } from "./scripts/tools.js";
import { createPlotSection, createTitleTab } from "./scripts/tiltleTab.js";
import { createGTB777Profiler } from "./scripts/profilerGTB777.js";

const app = document.getElementById("app");
const controller = createToolController();

const PLOTS = [
  { id: "plot-scatterplot-matrix", title: "Scatterplot Matrix" },
  { id: "plot-parallel-coordinates", title: "Parallel Coordinates" },
  { id: "plot-prediction-profiler", title: "Prediction Profiler" }
];

async function init() {
  try {
    const data = await loadGTB777Data("../../../data/GTB777.csv");
    const contentController = createContentController(data);
    const page = document.createElement("div");
    page.className = "webviz-page";

    const shell = document.createElement("div");
    shell.className = "webviz-shell";

    const plots = [
      createPlotSection({
        id: PLOTS[0].id,
        title: PLOTS[0].title,
        node: createScatterplotMatrix(data, controller, contentController)
      }),
      createPlotSection({
        id: PLOTS[1].id,
        title: PLOTS[1].title,
        node: createParallelCoordinates(data, controller, contentController)
      }),
      createPlotSection({
        id: PLOTS[2].id,
        title: PLOTS[2].title,
        node: createGTB777Profiler(data, controller, contentController)
      })
    ];

    shell.append(createToolsBar(controller), ...plots);
    page.append(createTitleTab(PLOTS), shell);
    app.appendChild(page);
  } catch (error) {
    console.error(error);
    const message = document.createElement("div");
    message.className = "error";
    message.textContent = `Failed to load GTB777 dataset: ${error.message}`;
    app.appendChild(message);
  }
}

init();
