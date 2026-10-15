import { zoomablePlot } from "./zoomablePlot.js";
import { createGTB777Sketch } from "./sketchGTB777.js";

const drawOrder = {
  "Infeasible": 0,
  "Level 2-2": 1,
  "Level 2-1": 2,
  "Level 1-1": 3
};
const colorDomain = ["Infeasible", "Level 2-2", "Level 2-1", "Level 1-1"];
const colorRange = ["#b0b0b0", "#d62728", "#000000", "#4a90e2"];

function createLegend() {
  const legend = document.createElement("div");
  legend.className = "splom-legend";

  colorDomain.forEach((label, index) => {
    const item = document.createElement("div");
    item.className = "splom-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "splom-legend-swatch";
    swatch.style.setProperty("--legend-color", colorRange[index]);

    const labelNode = document.createElement("span");
    labelNode.className = "splom-legend-label";
    labelNode.textContent = label;

    item.append(swatch, labelNode);
    legend.appendChild(item);
  });

  return legend;
}

export function createScatterplotMatrix(data, controller, contentController = null) {
  const getLabelOrder = (label) => (label in drawOrder ? drawOrder[label] : Number.POSITIVE_INFINITY);
  const sortedData = [...data].sort((a, b) => {
    const orderDelta = getLabelOrder(a.Label) - getLabelOrder(b.Label);
    if (orderDelta !== 0) {
      return orderDelta;
    }
    return String(a.Label ?? "").localeCompare(String(b.Label ?? ""));
  });
  const variables = [
    { key: "OEW (1000 lbm)" },
    { key: "Block Fuel (1000 lbm)" },
    { key: "Cruise CD (count)" }
  ];

  const cellSize = 375;
  const n = variables.length;

  const container = document.createElement("div");
  container.className = "splom-container";

  const layout = document.createElement("div");
  layout.className = "splom-layout";

  const main = document.createElement("div");
  main.className = "splom-main";

  const header = document.createElement("div");
  header.className = "splom-header";
  const title = document.createElement("div");
  title.className = "splom-title";
  title.textContent = "GTB777 Scatterplot Matrix";
  const subtitle = document.createElement("div");
  subtitle.className = "splom-subtitle";
  subtitle.textContent = "Use the Tools bar to move, select, zoom, brush, or lasso. Double-click resets the plot.";
  header.append(title, subtitle);

  const grid = document.createElement("div");
  grid.className = "splom-grid";
  grid.style.setProperty("--splom-columns", n - 1);
  grid.style.setProperty("--splom-cell-size", `${cellSize}px`);

  const plots = [];
  let sketchAdded = false;

  function getVisibleData() {
    return contentController ? contentController.getFilteredData(sortedData) : sortedData;
  }

  for (let row = 1; row < n; row++) {
    for (let col = 0; col < n - 1; col++) {
      if (col > row - 1) {
        const blank = document.createElement("div");
        blank.className = "splom-cell splom-cell-blank";
        blank.style.setProperty("--plot-width", `${cellSize}px`);
        blank.style.setProperty("--plot-height", `${cellSize}px`);
        if (!sketchAdded && contentController) {
          blank.appendChild(createGTB777Sketch({
            contentController,
            plotController: controller,
            width: cellSize,
            height: cellSize
          }));
          sketchAdded = true;
        }
        grid.appendChild(blank);
        continue;
      }
      const xVar = variables[col];
      const yVar = variables[row];
      const plot = zoomablePlot({
        data: getVisibleData(),
        xKey: xVar.key,
        yKey: yVar.key,
        xDomain: d3Extent(sortedData, xVar.key),
        yDomain: d3Extent(sortedData, yVar.key),
        width: cellSize,
        height: cellSize,
        margin: 30,
        marginLeft: col === 0 ? 60 : 30,
        marginBottom: row === n - 1 ? 45 : 20,
        xLabel: row === n - 1 ? xVar.key : null,
        yLabel: col === 0 ? yVar.key : null,
        colorDomain,
        colorRange,
        controller,
        plotId: `r${row}c${col}`
      });
      plot.classList.add("splom-cell");
      plots.push(plot);
      grid.appendChild(plot);
    }
  }

  main.append(header, grid, createLegend());
  layout.append(main);

  // The Content box itself is created once in main.js and shared by every linked plot.
  if (contentController) {
    contentController.subscribe((event) => {
      if (event.type !== "labels") {
        return;
      }
      const filteredData = getVisibleData();
      for (const plot of plots) {
        plot.setData?.(filteredData);
      }
    });
  }

  container.append(layout);
  return container;
}

function d3Extent(data, key) {
  const values = data.map((d) => d[key]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return [min - 0.02 * range, max + 0.02 * range];
}
