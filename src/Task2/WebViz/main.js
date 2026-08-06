import { loadGTB777Data } from "./filteredGTB777.js";
import { createScatterplotMatrix } from "./splomGTB777.js";
import { createToolController, createToolsBar } from "./tools.js";

const app = document.getElementById("app");
const controller = createToolController();

async function init() {
  try {
    const data = await loadGTB777Data("../../../data/GTB777.csv");
    const shell = document.createElement("div");
    shell.style.display = "flex";
    shell.style.flexDirection = "column";
    shell.style.gap = "14px";
    shell.style.width = "100%";

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
