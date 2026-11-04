import { getGTB777SketchColor } from "./sketchGTB777.js";
import {
  DIMENSIONS,
  LABEL_DOMAIN,
  HIGHLIGHT_OUTLINE_COLOR,
  SELECTION_COLOR,
  formatDimensionTitle,
  formatValue,
  getLabelColor
} from "./gtb777Dimensions.js";

// Box & violin plot by feasibility label: one small panel per column, one violin per
// label inside it. Each violin is scaled to its own peak so the *shape* of every label's
// distribution is comparable, even for Level 1-1 (143 designs) next to Level 2-2 (31k).
// The box inside is Tukey's: Q1-Q3, median line, whiskers at the last value within
// 1.5 x IQR.

const PANEL_WIDTH = 250;
const PANEL_HEIGHT = 236;
const PANEL_MARGIN = { top: 30, right: 10, bottom: 24, left: 46 };
const DENSITY_POINTS = 128;
const VIEW_OPTIONS = [
  { id: "all", label: "All columns" },
  { id: "input", label: "Design variables" },
  { id: "output", label: "Outputs" }
];

function quantileSorted(sorted, p) {
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

// Binned Gaussian KDE: linear-bin the values onto a regular grid, then convolve with a
// Gaussian kernel in grid units. O(n + grid * kernel) instead of O(n * grid), which
// keeps 31k-row groups cheap. Density is cut at the group's own min/max.
function computeDensity(sorted, domainMin, domainMax, sd, iqr) {
  const n = sorted.length;
  const grid = new Float64Array(DENSITY_POINTS);
  const step = (domainMax - domainMin) / (DENSITY_POINTS - 1) || 1;
  if (!n) return { step, grid, min: 0, max: 0 };

  for (let i = 0; i < n; i++) {
    const position = (sorted[i] - domainMin) / step;
    const lower = Math.max(0, Math.min(DENSITY_POINTS - 1, Math.floor(position)));
    const upper = Math.min(DENSITY_POINTS - 1, lower + 1);
    const weight = Math.max(0, Math.min(1, position - lower));
    grid[lower] += 1 - weight;
    grid[upper] += weight;
  }

  // Silverman's rule of thumb, floored so tiny or degenerate groups still draw a shape.
  const spread = Math.min(sd, iqr / 1.34) || sd || step;
  const bandwidth = Math.max(0.9 * spread * Math.pow(n, -0.2), step * 0.75);
  const sigma = bandwidth / step;
  const radius = Math.ceil(sigma * 3.5);
  const kernel = new Float64Array(radius * 2 + 1);
  for (let k = -radius; k <= radius; k++) {
    kernel[k + radius] = Math.exp(-0.5 * (k / sigma) * (k / sigma));
  }

  const smoothed = new Float64Array(DENSITY_POINTS);
  for (let i = 0; i < DENSITY_POINTS; i++) {
    if (!grid[i]) continue;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < DENSITY_POINTS) {
        smoothed[j] += grid[i] * kernel[k + radius];
      }
    }
  }

  return { step, grid: smoothed, min: sorted[0], max: sorted[n - 1] };
}

function computeGroupStats(values, domainMin, domainMax) {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  if (!n) return null;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const mean = sum / n;
  let squares = 0;
  for (let i = 0; i < n; i++) squares += (sorted[i] - mean) ** 2;
  const sd = Math.sqrt(squares / Math.max(1, n - 1));

  const q1 = quantileSorted(sorted, 0.25);
  const median = quantileSorted(sorted, 0.5);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;

  let whiskerLow = sorted[0];
  for (let i = 0; i < n; i++) {
    if (sorted[i] >= lowFence) {
      whiskerLow = sorted[i];
      break;
    }
  }
  let whiskerHigh = sorted[n - 1];
  for (let i = n - 1; i >= 0; i--) {
    if (sorted[i] <= highFence) {
      whiskerHigh = sorted[i];
      break;
    }
  }

  const density = computeDensity(sorted, domainMin, domainMax, sd, iqr);
  let peak = 0;
  for (const value of density.grid) peak = Math.max(peak, value);

  const points = [];
  for (let i = 0; i < DENSITY_POINTS; i++) {
    const value = domainMin + i * density.step;
    if (value < density.min - density.step || value > density.max + density.step) continue;
    points.push([Math.min(Math.max(value, density.min), density.max), peak ? density.grid[i] / peak : 0]);
  }

  return {
    n,
    mean,
    sd,
    q1,
    median,
    q3,
    whiskerLow,
    whiskerHigh,
    min: sorted[0],
    max: sorted[n - 1],
    outliers: n - countBetween(sorted, whiskerLow, whiskerHigh),
    densityPoints: points
  };
}

function countBetween(sorted, low, high) {
  let count = 0;
  for (const value of sorted) {
    if (value >= low && value <= high) count++;
  }
  return count;
}

export function createBoxViolinPlot(data, controller = null, contentController = null) {
  const innerWidth = PANEL_WIDTH - PANEL_MARGIN.left - PANEL_MARGIN.right;
  const innerHeight = PANEL_HEIGHT - PANEL_MARGIN.top - PANEL_MARGIN.bottom;
  // The Content box already maps point ids to rows; a second 1M-entry map costs ~0.5 s
  let rowsById = null;
  const rowForPointId = (pointId) => {
    if (contentController?.getRowByPointId) return contentController.getRowByPointId(pointId);
    rowsById ??= new Map(data.map((row) => [`point-${row.__rowId}`, row]));
    return rowsById.get(pointId);
  };
  const labelCounts = new Map(LABEL_DOMAIN.map((label) => [label, 0]));
  for (const row of data) {
    labelCounts.set(row.Label, (labelCounts.get(row.Label) ?? 0) + 1);
  }

  // Filled with the stats below; panels only render once those exist.
  const yScales = new Map();

  // Stats never depend on the label filter (filtering only hides whole labels), so they
  // are computed once, lazily, the first time the section comes near the viewport.
  let statsByDimension = null;
  let view = "all";
  let showViolin = true;
  let showBox = true;

  const root = document.createElement("div");
  root.className = "violin-container";

  const header = document.createElement("div");
  header.className = "violin-header";
  const title = document.createElement("div");
  title.className = "violin-title";
  title.textContent = "GTB777 Box & Violin Plot by Label";
  const subtitle = document.createElement("div");
  subtitle.className = "violin-subtitle";
  subtitle.textContent =
    "Distribution of every column within each feasibility label. Each violin is scaled to its own peak; boxes show Q1–Q3, the median and 1.5×IQR whiskers.";
  header.append(title, subtitle);

  const controls = document.createElement("div");
  controls.className = "violin-controls";

  const viewGroup = document.createElement("div");
  viewGroup.className = "violin-segmented";
  viewGroup.setAttribute("role", "group");
  viewGroup.setAttribute("aria-label", "Columns to show");
  const viewButtons = VIEW_OPTIONS.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "violin-segment";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      view = option.id;
      render();
    });
    viewGroup.appendChild(button);
    return [option.id, button];
  });

  function createToggle(text, initial, onChange) {
    const label = document.createElement("label");
    label.className = "violin-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = initial;
    input.addEventListener("change", () => onChange(input.checked));
    const span = document.createElement("span");
    span.textContent = text;
    label.append(input, span);
    return { label, input };
  }

  const violinToggle = createToggle("Violin", true, (checked) => {
    showViolin = checked;
    if (!showViolin && !showBox) {
      showBox = true;
      boxToggle.input.checked = true;
    }
    render();
  });
  const boxToggle = createToggle("Box", true, (checked) => {
    showBox = checked;
    if (!showViolin && !showBox) {
      showViolin = true;
      violinToggle.input.checked = true;
    }
    render();
  });

  controls.append(viewGroup, violinToggle.label, boxToggle.label);

  const legend = document.createElement("div");
  legend.className = "violin-legend";

  const grid = document.createElement("div");
  grid.className = "violin-grid";

  const tooltip = document.createElement("div");
  tooltip.className = "violin-tooltip";
  tooltip.hidden = true;

  const status = document.createElement("div");
  status.className = "violin-status";
  status.textContent = "Computing distributions…";
  grid.appendChild(status);

  root.append(header, controls, legend, grid, tooltip);

  function getSelectedLabels() {
    if (!contentController) return [...LABEL_DOMAIN];
    const selected = contentController.getSelectedLabels();
    return LABEL_DOMAIN.filter((label) => selected.has(label));
  }

  function computeAllStats() {
    const labelIndex = new Map(LABEL_DOMAIN.map((label, index) => [label, index]));
    const codes = new Int8Array(data.length);
    const sizes = new Int32Array(LABEL_DOMAIN.length);
    for (let index = 0; index < data.length; index++) {
      const code = labelIndex.get(data[index].Label) ?? -1;
      codes[index] = code;
      if (code >= 0) sizes[code]++;
    }
    statsByDimension = new Map();
    for (const dimension of DIMENSIONS) {
      const key = dimension.key;
      // One in-order pass per column gives the axis range (as d3.extent did, over every
      // row) and each label's values; reading the rows grouped by label was 3x slower.
      const groups = Array.from(sizes, (size) => new Float64Array(size));
      const cursors = new Int32Array(LABEL_DOMAIN.length);
      let min;
      let max;
      for (let index = 0; index < data.length; index++) {
        const value = Number(data[index][key]);
        if (value >= value) {
          if (min === undefined || min > value) min = value;
          if (max === undefined || max < value) max = value;
        }
        const code = codes[index];
        if (code >= 0) groups[code][cursors[code]++] = value;
      }
      const span = max - min || 1;
      const y = d3.scaleLinear()
        .domain([min - span * 0.03, max + span * 0.03])
        .range([innerHeight, 0]);
      yScales.set(key, y);
      const [domainMin, domainMax] = y.domain();
      const byLabel = new Map();
      LABEL_DOMAIN.forEach((label, code) => {
        byLabel.set(label, computeGroupStats(groups[code], domainMin, domainMax));
      });
      statsByDimension.set(key, byLabel);
    }
  }

  function showTooltip(event, html) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const bounds = root.getBoundingClientRect();
    const x = event.clientX - bounds.left + 14;
    const y = event.clientY - bounds.top + 14;
    const maxX = bounds.width - tooltip.offsetWidth - 8;
    tooltip.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function renderLegend(selectedLabels) {
    legend.replaceChildren();
    for (const label of LABEL_DOMAIN) {
      const item = document.createElement("span");
      item.className = "violin-legend-item";
      item.dataset.inactive = String(!selectedLabels.includes(label));
      const swatch = document.createElement("span");
      swatch.className = "violin-legend-swatch";
      swatch.style.setProperty("--legend-color", getLabelColor(label));
      const text = document.createElement("span");
      text.textContent = `${label} (n = ${(labelCounts.get(label) ?? 0).toLocaleString()})`;
      item.append(swatch, text);
      legend.appendChild(item);
    }
    const selectionItem = document.createElement("span");
    selectionItem.className = "violin-legend-item";
    const dot = document.createElement("span");
    dot.className = "violin-legend-dot";
    dot.style.setProperty("--legend-color", SELECTION_COLOR);
    const dotText = document.createElement("span");
    dotText.textContent = "Selected design";
    selectionItem.append(dot, dotText);
    legend.appendChild(selectionItem);
  }

  function getMarkers(selectedLabels) {
    if (!controller) return [];
    const selected = new Set(selectedLabels);
    const pinned = controller.getAllPinnedIds?.() ?? new Set();
    const highlighted = controller.getHighlightedPointIds?.() ?? new Set();
    const drawn = controller.getDrawnPointIds?.() ?? new Set();
    const ids = new Set([...pinned, ...highlighted, ...drawn]);
    const markers = [];
    for (const pointId of ids) {
      const row = rowForPointId(pointId);
      if (!row || !selected.has(row.Label)) continue;
      const drawIndex = drawn.has(pointId)
        ? controller.getDrawnPointColorIndex?.(pointId)
        : null;
      markers.push({
        pointId,
        row,
        highlighted: highlighted.has(pointId),
        fill: drawn.has(pointId)
          ? getGTB777SketchColor(drawIndex ?? 0)
          : pinned.has(pointId)
            ? SELECTION_COLOR
            : getLabelColor(row.Label)
      });
    }
    // Highlighted markers last so they sit on top.
    return markers.sort((a, b) => Number(a.highlighted) - Number(b.highlighted));
  }

  let panelLayers = [];

  function renderPanel(dimension, selectedLabels) {
    const panel = document.createElement("div");
    panel.className = "violin-panel";

    const svg = d3.select(panel).append("svg")
      .attr("class", "violin-svg")
      .attr("viewBox", `0 0 ${PANEL_WIDTH} ${PANEL_HEIGHT}`)
      .attr("role", "img")
      .attr("aria-label", `${formatDimensionTitle(dimension)} distribution by label`);

    svg.append("text")
      .attr("class", "violin-panel-title")
      .attr("x", PANEL_MARGIN.left)
      .attr("y", 16)
      .text(formatDimensionTitle(dimension));

    svg.append("text")
      .attr("class", "violin-panel-kind")
      .attr("x", PANEL_WIDTH - PANEL_MARGIN.right)
      .attr("y", 16)
      .attr("text-anchor", "end")
      .text(dimension.group === "input" ? "design variable" : "output");

    const chart = svg.append("g")
      .attr("transform", `translate(${PANEL_MARGIN.left},${PANEL_MARGIN.top})`);

    const y = yScales.get(dimension.key);
    const x = d3.scaleBand().domain(selectedLabels).range([0, innerWidth]).paddingInner(0.14).paddingOuter(0.08);

    chart.append("g")
      .attr("class", "violin-grid-lines")
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""))
      .call((axis) => axis.select(".domain").remove());

    chart.append("g")
      .attr("class", "violin-axis")
      .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("~g")))
      .call((axis) => axis.select(".domain").remove());

    if (!selectedLabels.length) {
      chart.append("text")
        .attr("class", "violin-empty")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight / 2)
        .attr("text-anchor", "middle")
        .text("No labels selected");
      return panel;
    }

    const stats = statsByDimension.get(dimension.key);
    const halfBand = x.bandwidth() / 2;

    for (const label of selectedLabels) {
      const groupStats = stats.get(label);
      if (!groupStats) continue;
      const cx = x(label) + halfBand;
      const color = getLabelColor(label);
      const group = chart.append("g").attr("class", "violin-group");

      if (showViolin) {
        const area = d3.area()
          .x0((point) => cx - point[1] * halfBand * 0.92)
          .x1((point) => cx + point[1] * halfBand * 0.92)
          .y((point) => y(point[0]))
          .curve(d3.curveBasis);
        group.append("path")
          .attr("class", "violin-shape")
          .attr("d", area(groupStats.densityPoints))
          .style("--violin-color", color);
      }

      if (showBox) {
        const boxHalf = showViolin ? Math.min(halfBand * 0.16, 6) : Math.min(halfBand * 0.45, 18);
        group.append("line")
          .attr("class", "violin-whisker")
          .attr("x1", cx).attr("x2", cx)
          .attr("y1", y(groupStats.whiskerLow)).attr("y2", y(groupStats.whiskerHigh));
        for (const value of [groupStats.whiskerLow, groupStats.whiskerHigh]) {
          group.append("line")
            .attr("class", "violin-whisker")
            .attr("x1", cx - boxHalf * 0.7).attr("x2", cx + boxHalf * 0.7)
            .attr("y1", y(value)).attr("y2", y(value));
        }
        group.append("rect")
          .attr("class", showViolin ? "violin-box" : "violin-box violin-box-solo")
          .attr("x", cx - boxHalf)
          .attr("width", boxHalf * 2)
          .attr("y", y(groupStats.q3))
          .attr("height", Math.max(1, y(groupStats.q1) - y(groupStats.q3)))
          .attr("rx", 2)
          .style("--violin-color", color);
        group.append("line")
          .attr("class", "violin-median")
          .attr("x1", cx - boxHalf).attr("x2", cx + boxHalf)
          .attr("y1", y(groupStats.median)).attr("y2", y(groupStats.median));
      }

      // Generous invisible hit target covering the label's whole band.
      group.append("rect")
        .attr("class", "violin-hit")
        .attr("x", x(label))
        .attr("width", x.bandwidth())
        .attr("y", 0)
        .attr("height", innerHeight)
        .on("mousemove", (event) => {
          showTooltip(event, `
            <strong>${label}</strong> · ${formatDimensionTitle(dimension)}<br>
            n = ${groupStats.n.toLocaleString()}<br>
            Median: ${formatValue(groupStats.median)}<br>
            Q1–Q3: ${formatValue(groupStats.q1)} – ${formatValue(groupStats.q3)}<br>
            Whiskers: ${formatValue(groupStats.whiskerLow)} – ${formatValue(groupStats.whiskerHigh)}<br>
            Mean ± SD: ${formatValue(groupStats.mean)} ± ${formatValue(groupStats.sd)}<br>
            Beyond whiskers: ${groupStats.outliers.toLocaleString()}
          `);
        })
        .on("mouseleave", hideTooltip);
    }

    panelLayers.push({
      dimension,
      x,
      y,
      layer: chart.append("g").attr("class", "violin-marker-layer")
    });

    return panel;
  }

  // Selected / highlighted / drawn designs from the Content box, placed on their label.
  // Redrawn on their own layer so hover events elsewhere never rebuild the panels.
  function renderMarkers() {
    const markers = getMarkers(getSelectedLabels());
    for (const { dimension, x, y, layer } of panelLayers) {
      layer.selectAll("*").remove();
      renderPanelMarkers(dimension, x, y, layer, markers);
    }
  }

  function renderPanelMarkers(dimension, x, y, chart, markers) {
    const halfBand = x.bandwidth() / 2;
    for (const marker of markers) {
      if (!x.domain().includes(marker.row.Label)) continue;
      const cx = x(marker.row.Label) + halfBand;
      const cy = y(Number(marker.row[dimension.key]));
      chart.append("circle")
        .attr("class", marker.highlighted ? "violin-marker violin-marker-highlight" : "violin-marker")
        .attr("cx", cx)
        .attr("cy", cy)
        .attr("r", marker.highlighted ? 5.5 : 4.5)
        .style("--marker-fill", marker.fill)
        .style("--marker-outline", HIGHLIGHT_OUTLINE_COLOR)
        .on("mouseenter", (event) => {
          controller?.setHighlightedPointId?.(marker.pointId);
          showTooltip(event, `
            <strong>Design ${marker.row.__rowId + 1}</strong> · ${marker.row.Label}<br>
            ${formatDimensionTitle(dimension)}: ${formatValue(Number(marker.row[dimension.key]))}
          `);
        })
        .on("mouseleave", () => {
          controller?.clearHighlightedPointId?.();
          hideTooltip();
        });
    }
  }

  function render() {
    for (const [id, button] of viewButtons) {
      button.dataset.active = String(id === view);
    }
    const selectedLabels = getSelectedLabels();
    renderLegend(selectedLabels);
    if (!statsByDimension) return;

    panelLayers = [];
    const dimensions = DIMENSIONS.filter((dimension) => view === "all" || dimension.group === view);
    grid.replaceChildren(...dimensions.map((dimension) => renderPanel(dimension, selectedLabels)));
    renderMarkers();
  }

  function ensureComputed() {
    if (statsByDimension) return;
    computeAllStats();
    render();
  }

  // Defer the one-off stats pass until the section is close to the viewport so it never
  // competes with the scatterplot matrix's first paint.
  if (typeof IntersectionObserver !== "undefined") {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        ensureComputed();
      }
    }, { rootMargin: "800px 0px" });
    requestAnimationFrame(() => observer.observe(root));
  } else {
    setTimeout(ensureComputed, 0);
  }

  contentController?.subscribe?.((event) => {
    if (event.type === "labels") render();
  });

  controller?.subscribe?.((event) => {
    if (
      event.type === "pins" ||
      event.type === "highlightedPoint" ||
      event.type === "pinnedHighlight" ||
      event.type === "drawPoints"
    ) {
      renderMarkers();
    }
  });

  render();
  return root;
}
