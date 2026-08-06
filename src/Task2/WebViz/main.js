import { loadGTB777Data } from "./scripts/filteredGTB777.js";
import { createScatterplotMatrix } from "./scripts/splomGTB777.js";
import { createToolController, createToolsBar } from "./scripts/tools.js";

const app = document.getElementById("app");
const controller = createToolController();

async function init() {
  try {
    const data = await loadGTB777Data("../../../data/GTB777.csv");
    const shell = document.createElement("div");
    shell.className = "webviz-shell";

    shell.append(createToolsBar(controller), createScatterplotMatrix(data, controller));
    app.appendChild(shell);
  } catch (error) {
    console.error(error);
    const message = document.createElement("div");
    message.className = "error";
    message.textContent = `Failed to load GTB777 dataset: ${error.message}`;
    app.appendChild(message);
  }
}

init();
