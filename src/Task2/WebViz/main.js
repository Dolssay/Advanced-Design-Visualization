import { loadGTB777Data } from "./filteredGTB777.js";
import { createScatterplotMatrix } from "./splomGTB777.js";

const app = document.getElementById("app");

async function init() {
  try {
    const data = await loadGTB777Data("../../../data/GTB777.csv");
    const matrix = createScatterplotMatrix(data);
    app.appendChild(matrix);
  } catch (error) {
    console.error(error);
    const message = document.createElement("div");
    message.className = "error";
    message.textContent = `Failed to load GTB777 dataset: ${error.message}`;
    app.appendChild(message);
  }
}

init();
