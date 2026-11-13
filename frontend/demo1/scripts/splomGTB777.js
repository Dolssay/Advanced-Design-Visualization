import { zoomablePlot } from "./zoomablePlot.js";
import { createGTB777Sketch } from "./sketchGTB777.js";
import { DIMENSIONS, LABEL_COLORS, formatDimensionTitle } from "./gtb777Dimensions.js";

const colorDomain = ["Infeasible", "Level 2-2", "Level 2-1", "Level 1-1"];
const colorRange = LABEL_COLORS;

// Outputs keep their original order; inputs follow the dataset's column order.
const OUTPUT_KEYS = ["OEW (1000 lbm)", "Block Fuel (1000 lbm)", "Cruise CD (count)"];
const INPUT_KEYS = DIMENSIONS.filter((dimension) => dimension.group === "input").map((dimension) => dimension.key);
const DEFAULT_INPUT_COUNT = 4;

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

function titleOf(key) {
  const dimension = DIMENSIONS.find((entry) => entry.key === key);
  return dimension ? formatDimensionTitle(dimension) : key;
}

// Three variables keep the original 375px cells; more variables share the available width
// (4px grid gaps), down to a readable minimum, below which the matrix scrolls sideways.
function cellSizeFor(n, availableWidth) {
  if (n <= 3) return 375;
  const fit = Math.floor((availableWidth - (n - 2) * 4 - 8) / (n - 1));
  return Math.min(375, Math.max(150, fit));
}

const pairCount = (n) => (n * (n - 1)) / 2;

export function createScatterplotMatrix(data, controller, contentController = null) {
  // Draw order (later labels on top) comes from colorDomain inside zoomablePlot.
  const sortedData = data;

  const state = {
    mode: "outputs",
    order: { outputs: OUTPUT_KEYS.slice(), inputs: INPUT_KEYS.slice() },
    selected: new Set(INPUT_KEYS.slice(0, DEFAULT_INPUT_COUNT))
  };

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

  // --- Configuration ----------------------------------------------------------------

  const controls = document.createElement("div");
  controls.className = "splom-controls";

  const modeGroup = document.createElement("div");
  modeGroup.className = "splom-mode";
  modeGroup.setAttribute("role", "group");
  modeGroup.setAttribute("aria-label", "Variables to compare");
  const modeButtons = [
    { mode: "outputs", text: "Outputs" },
    { mode: "inputs", text: "Input pairs" }
  ].map(({ mode, text }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "splom-mode-button";
    button.textContent = text;
    button.addEventListener("click", () => {
      if (state.mode === mode) return;
      state.mode = mode;
      rebuild();
    });
    modeGroup.appendChild(button);
    return { mode, button };
  });

  // Tick the inputs to compare, styled like the Tools bar's Tooltips menu.
  const countLabel = document.createElement("details");
  countLabel.className = "tool-details splom-vars";
  const countSummary = document.createElement("summary");
  countSummary.className = "tool-menu-button splom-vars-button";
  const countMenu = document.createElement("div");
  countMenu.className = "tool-menu";
  const varInputs = new Map(INPUT_KEYS.map((key) => {
    const label = document.createElement("label");
    label.className = "tool-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => {
      if (input.checked) state.selected.add(key);
      else state.selected.delete(key);
      rebuild();
    });
    const text = document.createElement("span");
    text.textContent = titleOf(key);
    label.append(input, text);
    countMenu.appendChild(label);
    return [key, input];
  }));
  countLabel.append(countSummary, countMenu);
  document.addEventListener("click", (event) => {
    if (!countLabel.contains(event.target)) countLabel.open = false;
  });

  const orderGroup = document.createElement("div");
  orderGroup.className = "splom-order";
  const orderText = document.createElement("span");
  orderText.className = "splom-order-label";
  orderText.textContent = "Axis order";
  const chipList = document.createElement("ol");
  chipList.className = "splom-chips";
  chipList.setAttribute("aria-label", "Axis order. Drag a variable, or focus it and use the arrow keys, to move it.");
  orderGroup.append(orderText, chipList);

  controls.append(modeGroup, countLabel, orderGroup);

  const hint = document.createElement("div");
  hint.className = "splom-order-hint";
  hint.textContent = "Drag a variable to reorder the axes; the first ones in the list are plotted.";

  // Chips list only the plotted variables; indices are positions among them. Unticked
  // inputs keep their place in the full order, so re-ticking one puts it back where it was.
  function moveVariable(from, to) {
    const keys = visibleKeys();
    if (from === to || to < 0 || to >= keys.length) return false;
    const order = state.order[state.mode];
    const key = keys[from];
    order.splice(order.indexOf(key), 1);
    order.splice(order.indexOf(keys[to]) + (to > from ? 1 : 0), 0, key);
    return true;
  }

  let draggedIndex = null;

  function renderChips(focusIndex = null) {
    chipList.replaceChildren(...visibleKeys().map((key, index) => {
      const chip = document.createElement("li");
      chip.className = "splom-chip";
      chip.textContent = titleOf(key);
      chip.draggable = true;
      chip.tabIndex = 0;
      chip.title = `Axis ${index + 1}`;

      chip.addEventListener("dragstart", (event) => {
        draggedIndex = index;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", key);
        chip.classList.add("is-dragging");
      });
      chip.addEventListener("dragend", () => {
        draggedIndex = null;
        chip.classList.remove("is-dragging");
      });
      chip.addEventListener("dragover", (event) => {
        if (draggedIndex === null) return;
        event.preventDefault();
        chip.classList.add("is-drop-target");
      });
      chip.addEventListener("dragleave", () => chip.classList.remove("is-drop-target"));
      chip.addEventListener("drop", (event) => {
        event.preventDefault();
        if (draggedIndex !== null && moveVariable(draggedIndex, index)) rebuild();
      });
      chip.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        if (!step) return;
        event.preventDefault();
        if (moveVariable(index, index + step)) rebuild(index + step);
      });
      return chip;
    }));
    if (focusIndex !== null) chipList.children[focusIndex]?.focus();
  }

  // --- Matrix -----------------------------------------------------------------------

  const grid = document.createElement("div");
  grid.className = "splom-grid";
  const gridScroll = document.createElement("div");
  gridScroll.className = "splom-grid-scroll";
  gridScroll.appendChild(grid);

  let plots = [];
  let sketch = null;
  const domains = new Map();

  function getVisibleData() {
    return contentController ? contentController.getFilteredData(sortedData) : sortedData;
  }

  function domainOf(key) {
    if (!domains.has(key)) domains.set(key, d3Extent(sortedData, key));
    return domains.get(key);
  }

  function visibleKeys() {
    const order = state.order[state.mode];
    return state.mode === "inputs" ? order.filter((key) => state.selected.has(key)) : order;
  }

  // Lower triangle, one row per variable after the first: a staircase descending to the right.
  function buildGrid() {
    for (const plot of plots) plot.destroy?.();
    plots = [];
    grid.replaceChildren();

    const keys = visibleKeys();
    const n = keys.length;
    // Before the plot is on the page its width is 0; 1120px matches the outputs matrix.
    const cellSize = cellSizeFor(n, gridScroll.clientWidth || 1120);
    const visibleData = getVisibleData();
    grid.style.setProperty("--splom-columns", n - 1);
    grid.style.setProperty("--splom-cell-size", `${cellSize}px`);

    // The aircraft sketch fills the largest k x k square of empty cells in the top-right
    // corner. It is built once and moved, so it is not re-subscribed on each rebuild.
    const sketchSpan = contentController ? Math.floor((n - 1) / 2) : 0;
    const inSketch = (gridRow, col) => gridRow < sketchSpan && col >= n - 1 - sketchSpan;
    if (sketchSpan > 0) {
      const size = sketchSpan * cellSize + (sketchSpan - 1) * 4;
      const host = document.createElement("div");
      host.className = "splom-cell splom-cell-blank splom-sketch-cell";
      host.style.setProperty("--plot-width", `${size}px`);
      host.style.setProperty("--plot-height", `${size}px`);
      host.style.gridColumn = `${n - sketchSpan} / span ${sketchSpan}`;
      host.style.gridRow = `1 / span ${sketchSpan}`;
      sketch ??= createGTB777Sketch({ contentController, plotController: controller, width: 375, height: 375 });
      host.appendChild(sketch);
      grid.appendChild(host);
    }

    for (let row = 1; row < n; row++) {
      for (let col = 0; col < n - 1; col++) {
        if (col > row - 1) {
          if (inSketch(row - 1, col)) continue;
          const blank = document.createElement("div");
          blank.className = "splom-cell splom-cell-blank";
          blank.style.setProperty("--plot-width", `${cellSize}px`);
          blank.style.setProperty("--plot-height", `${cellSize}px`);
          grid.appendChild(blank);
          continue;
        }
        const xKey = keys[col];
        const yKey = keys[row];
        const plot = zoomablePlot({
          data: visibleData,
          xKey,
          yKey,
          xDomain: domainOf(xKey),
          yDomain: domainOf(yKey),
          width: cellSize,
          height: cellSize,
          // Every cell keeps room for its own tick labels (left and bottom), not just the
          // edge cells; the first column also holds the axis title.
          margin: n <= 3 ? 24 : 14,
          marginLeft: col === 0 ? 68 : 44,
          marginBottom: row === n - 1 ? 45 : 24,
          xLabel: row === n - 1 ? titleOf(xKey) : null,
          yLabel: col === 0 ? titleOf(yKey) : null,
          colorDomain,
          colorRange,
          controller,
          // Keyed by the pair, so a cell keeps its local pins when the axes are reordered.
          plotId: `${xKey}|${yKey}`
        });
        plot.classList.add("splom-cell");
        plots.push(plot);
        grid.appendChild(plot);
      }
    }
  }

  function rebuild(focusChip = null) {
    for (const { mode, button } of modeButtons) {
      button.setAttribute("aria-pressed", String(state.mode === mode));
    }
    countLabel.hidden = state.mode !== "inputs";
    const n = state.selected.size;
    countSummary.textContent = `Variables · ${n} of ${INPUT_KEYS.length} · ${pairCount(n)} pair${n === 2 ? "" : "s"}`;
    for (const [key, input] of varInputs) {
      input.checked = state.selected.has(key);
      // A matrix needs two variables, so the last two ticked cannot be unticked.
      input.disabled = input.checked && n <= 2;
    }
    hint.textContent = state.mode === "inputs"
      ? "Tick the inputs to compare under Variables; drag a variable to reorder the axes."
      : "Drag a variable to reorder the axes.";
    renderChips(focusChip);
    buildGrid();
  }

  rebuild();
  main.append(header, controls, hint, gridScroll, createLegend());
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
  // d3.extent, not Math.min(...values): spreading 1M values overflows the call stack
  const [min, max] = d3.extent(data, (d) => d[key]);
  const range = max - min;
  return [min - 0.02 * range, max + 0.02 * range];
}
