import { zoomablePlot } from "./zoomablePlot.js";

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
  legend.style.display = "flex";
  legend.style.gap = "12px";
  legend.style.flexWrap = "wrap";
  legend.style.justifyContent = "center";

  colorDomain.forEach((label, index) => {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.gap = "6px";

    const swatch = document.createElement("span");
    swatch.style.width = "14px";
    swatch.style.height = "14px";
    swatch.style.backgroundColor = colorRange[index];
    swatch.style.border = "1px solid #999";
    swatch.style.display = "inline-block";

    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    labelNode.style.fontSize = "13px";
    labelNode.style.color = "#222";

    item.append(swatch, labelNode);
    legend.appendChild(item);
  });

  return legend;
}

export function createScatterplotMatrix(data) {
  const sortedData = [...data].sort((a, b) => drawOrder[a.Label] - drawOrder[b.Label]);
  const variables = [
    { key: "OEW (1000 lbm)" },
    { key: "Block Fuel (1000 lbm)" },
    { key: "Cruise CD (count)" }
  ];

  const cellSize = 250;
  const n = variables.length;

  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.gap = "16px";

  const header = document.createElement("div");
  header.style.textAlign = "center";
  header.innerHTML = `<div style="font-family:'Times New Roman', serif; font-size:20px; font-weight:700; margin-bottom:6px;">GTB777 Scatterplot Matrix</div>
    <div style="font-family:Arial, sans-serif; font-size:13px; color:#666;">Scroll or pinch to zoom, drag to pan, double-click to reset.</div>`;

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = `repeat(${n - 1}, ${cellSize}px)`;
  grid.style.gap = "4px";

  for (let row = 1; row < n; row++) {
    for (let col = 0; col < n - 1; col++) {
      if (col > row - 1) {
        const blank = document.createElement("div");
        blank.style.width = `${cellSize}px`;
        blank.style.height = `${cellSize}px`;
        grid.appendChild(blank);
        continue;
      }
      const xVar = variables[col];
      const yVar = variables[row];
      const plot = zoomablePlot({
        data: sortedData,
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
        colorRange
      });
      plot.style.border = "1px solid #ccc";
      grid.appendChild(plot);
    }
  }

  container.append(header, grid, createLegend());
  return container;
}

function d3Extent(data, key) {
  const values = data.map((d) => d[key]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return [min - 0.02 * range, max + 0.02 * range];
}
