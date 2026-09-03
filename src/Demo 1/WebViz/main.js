import { loadGTB777Data } from "./scripts/filteredGTB777.js";
import { createScatterplotMatrix } from "./scripts/splomGTB777.js";
import { createContentController } from "./scripts/contentbox.js";
import { createToolController, createToolsBar } from "./scripts/tools.js";
import { createPlotSection, createTitleTab } from "./scripts/tiltleTab.js";

const app = document.getElementById("app");
const controller = createToolController();

const PLOTS = [
  { id: "plot-scatterplot-matrix", title: "Scatterplot Matrix" }
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
