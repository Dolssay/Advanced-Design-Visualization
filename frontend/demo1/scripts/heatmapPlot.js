import { getGTB777SketchColor } from "./sketchGTB777.js";
import { binHeatmap, colorizeHeatmap } from "./heatmapBinning.js";
import {
  DIMENSIONS,
  LABEL_DOMAIN,
  HIGHLIGHT_OUTLINE_COLOR,
  SELECTION_COLOR,
  formatDimensionTitle,
  formatValue,
  getLabelColor
} from "./gtb777Dimensions.js";

// Design-space heatmap: bins every design on two chosen columns and colors each cell by
// a metric (count, share of a label, or mean of an output).
//
// Drawing pipeline (kept off the main thread and cheap to repaint):
//   1. Rows are posted to heatmapWorker.js once, as transferred Float32Array columns.
//   2. Each view change posts only the settings; the worker bins, smooths and colorizes
//      the grid and encodes it as a PNG with one pixel per cell.
//   3. The main thread swaps an SVG <image> href. The browser stretches that tiny image
//      over the plot area on the GPU -- nearest-neighbour for crisp cells, or bilinear for
//      a smooth surface -- so a redraw is one image decode, not thousands of rects.
// Only the latest request is ever painted; stale worker results are dropped.

const WIDTH = 780;
const HEIGHT = 600;
const MARGIN = { top: 16, right: 118, bottom: 58, left: 78 };
const INNER_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const INNER_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const MIN_COUNT = 3;
const LUT_SIZE = 256;

const RESOLUTIONS = [16, 24, 32, 48, 64];
const SMOOTHING = [
  { id: "off", label: "Off", sigma: 0 },
  { id: "light", label: "Light", sigma: 0.8 },
  { id: "strong", label: "Strong", sigma: 1.6 }
];

function buildMetrics() {
  const metrics = [{ id: "count", label: "Design count", kind: "count", format: "count" }];
  metrics.push({
    id: "share-feasible",
    label: "Share feasible (any Level)",
    kind: "share",
    labels: LABEL_DOMAIN.filter((label) => label !== "Infeasible"),
    format: "percent"
  });
  for (const label of [...LABEL_DOMAIN].reverse()) {
    metrics.push({
      id: `share-${label}`,
      label: `Share ${label}`,
      kind: "share",
      labels: [label],
      format: "percent"
    });
  }
  for (const dimension of DIMENSIONS.filter((entry) => entry.group === "output")) {
    metrics.push({
      id: `mean-${dimension.key}`,
      label: `Mean ${formatDimensionTitle(dimension)}`,
      kind: "mean",
      col: DIMENSIONS.indexOf(dimension),
      format: "value"
    });
  }
  return metrics;
}

// Sequential single-hue ramp (light -> dark purple). Purple is not one of the label
// colors, so a heatmap cell is never mistaken for a label identity.
function buildLut() {
  const lut = new Uint8ClampedArray(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const color = d3.rgb(d3.interpolatePurples(0.16 + 0.84 * (i / (LUT_SIZE - 1))));
    lut[i * 4] = color.r;
    lut[i * 4 + 1] = color.g;
    lut[i * 4 + 2] = color.b;
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

function createSelect(labelText, options, initialValue, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "heatmap-control";
  const text = document.createElement("span");
  text.className = "heatmap-control-label";
  text.textContent = labelText;
  const select = document.createElement("select");
  select.className = "heatmap-select";
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
  select.value = initialValue;
  select.addEventListener("change", () => onChange(select.value));
  wrapper.append(text, select);
  return { wrapper, select };
}

export function createHeatmapPlot(data, controller = null, contentController = null) {
  const metrics = buildMetrics();
  const lut = buildLut();
  // The Content box already maps point ids to rows; a second 1M-entry map costs ~0.5 s
  let rowsById = null;
  const rowForPointId = (pointId) => {
    if (contentController?.getRowByPointId) return contentController.getRowByPointId(pointId);
    rowsById ??= new Map(data.map((row) => [`point-${row.__rowId}`, row]));
    return rowsById.get(pointId);
  };

  const state = {
    xCol: DIMENSIONS.findIndex((dimension) => dimension.key === "SHT (sqft)"),
    yCol: DIMENSIONS.findIndex((dimension) => dimension.key === "SWPHT (deg)"),
    metricId: "share-Level 1-1",
    bins: 32,
    smoothing: "light",
    interpolate: true
  };

  // One plain pass per column fills the worker's Float32 column and the axis range
  // (from the full-precision values, as d3.extent did). Reading 1M row objects is the cost.
  const columns = [];
  const domains = DIMENSIONS.map((dimension) => {
    const key = dimension.key;
    const column = new Float32Array(data.length);
    let min;
    let max;
    for (let index = 0; index < data.length; index++) {
      const value = Number(data[index][key]);
      column[index] = value;
      if (value >= value) {
        if (min === undefined || min > value) min = value;
        if (max === undefined || max < value) max = value;
      }
    }
    columns.push(column);
    const span = max - min || 1;
    // Nudge the max so the largest value lands inside the last bin.
    return [min, max + span * 1e-6];
  });

  // --- DOM ---------------------------------------------------------------------------

  const root = document.createElement("div");
  root.className = "heatmap-container";

  const header = document.createElement("div");
  header.className = "heatmap-header";
  const title = document.createElement("div");
  title.className = "heatmap-title";
  title.textContent = "GTB777 Design-Space Heatmap";
  const subtitle = document.createElement("div");
  subtitle.className = "heatmap-subtitle";
  subtitle.textContent =
    `Designs binned on two columns; each cell is colored by the chosen metric. Hatched cells hold fewer than ${MIN_COUNT} designs.`;
  header.append(title, subtitle);

  const controls = document.createElement("div");
  controls.className = "heatmap-controls";

  const dimensionOptions = DIMENSIONS.map((dimension, index) => ({
    value: String(index),
    label: formatDimensionTitle(dimension)
  }));

  const xSelect = createSelect("X", dimensionOptions, String(state.xCol), (value) => {
    state.xCol = Number(value);
    requestBin();
  });
  const ySelect = createSelect("Y", dimensionOptions, String(state.yCol), (value) => {
    state.yCol = Number(value);
    requestBin();
  });
  const metricSelect = createSelect(
    "Color",
    metrics.map((metric) => ({ value: metric.id, label: metric.label })),
    state.metricId,
    (value) => {
      state.metricId = value;
      requestBin();
    }
  );
  const binSelect = createSelect(
    "Bins",
    RESOLUTIONS.map((bins) => ({ value: String(bins), label: `${bins} × ${bins}` })),
    String(state.bins),
    (value) => {
      state.bins = Number(value);
      requestBin();
    }
  );
  const smoothingSelect = createSelect(
    "Smoothing",
    SMOOTHING.map((entry) => ({ value: entry.id, label: entry.label })),
    state.smoothing,
    (value) => {
      state.smoothing = value;
      requestBin();
    }
  );

  const interpolateLabel = document.createElement("label");
  interpolateLabel.className = "heatmap-toggle";
  const interpolateInput = document.createElement("input");
  interpolateInput.type = "checkbox";
  interpolateInput.checked = state.interpolate;
  interpolateInput.addEventListener("change", () => {
    state.interpolate = interpolateInput.checked;
    applyInterpolation();
  });
  const interpolateText = document.createElement("span");
  interpolateText.textContent = "Smooth shading";
  interpolateLabel.append(interpolateInput, interpolateText);

  const swapButton = document.createElement("button");
  swapButton.type = "button";
  swapButton.className = "heatmap-button";
  swapButton.textContent = "Swap X/Y";
  swapButton.addEventListener("click", () => {
    [state.xCol, state.yCol] = [state.yCol, state.xCol];
    xSelect.select.value = String(state.xCol);
    ySelect.select.value = String(state.yCol);
    requestBin();
  });

  controls.append(
    xSelect.wrapper,
    ySelect.wrapper,
    swapButton,
    metricSelect.wrapper,
    binSelect.wrapper,
    smoothingSelect.wrapper,
    interpolateLabel
  );

  const frame = document.createElement("div");
  frame.className = "heatmap-frame";

  const svg = d3.select(frame).append("svg")
    .attr("class", "heatmap-svg")
    .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
    .attr("role", "img")
    .attr("aria-label", "Design-space heatmap for the GTB777 dataset");

  const defs = svg.append("defs");
  const hatchId = `heatmap-hatch-${Math.random().toString(36).slice(2, 8)}`;
  const gradientId = `heatmap-gradient-${Math.random().toString(36).slice(2, 8)}`;
  defs.append("pattern")
    .attr("id", hatchId)
    .attr("width", 7)
    .attr("height", 7)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("patternTransform", "rotate(45)")
    .call((pattern) => {
      pattern.append("rect").attr("width", 7).attr("height", 7).attr("class", "heatmap-hatch-bg");
      pattern.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 7).attr("class", "heatmap-hatch-line");
    });
  const gradient = defs.append("linearGradient")
    .attr("id", gradientId)
    .attr("x1", 0).attr("y1", 1).attr("x2", 0).attr("y2", 0);
  for (let i = 0; i <= 10; i++) {
    const index = Math.round((i / 10) * (LUT_SIZE - 1)) * 4;
    gradient.append("stop")
      .attr("offset", `${i * 10}%`)
      .attr("stop-color", `rgb(${lut[index]},${lut[index + 1]},${lut[index + 2]})`);
  }

  const chart = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  chart.append("rect")
    .attr("class", "heatmap-empty-bg")
    .attr("width", INNER_WIDTH)
    .attr("height", INNER_HEIGHT)
    .attr("fill", `url(#${hatchId})`);
  const image = chart.append("image")
    .attr("class", "heatmap-image")
    .attr("width", INNER_WIDTH)
    .attr("height", INNER_HEIGHT)
    .attr("preserveAspectRatio", "none");
  const xAxisLayer = chart.append("g").attr("class", "heatmap-axis").attr("transform", `translate(0,${INNER_HEIGHT})`);
  const yAxisLayer = chart.append("g").attr("class", "heatmap-axis");
  const xLabel = chart.append("text")
    .attr("class", "heatmap-axis-label")
    .attr("x", INNER_WIDTH / 2)
    .attr("y", INNER_HEIGHT + 44)
    .attr("text-anchor", "middle");
  const yLabel = chart.append("text")
    .attr("class", "heatmap-axis-label")
    .attr("transform", `translate(${-58},${INNER_HEIGHT / 2}) rotate(-90)`)
    .attr("text-anchor", "middle");
  const hoverCell = chart.append("rect").attr("class", "heatmap-hover-cell").attr("visibility", "hidden");
  const markerLayer = chart.append("g").attr("class", "heatmap-marker-layer");
  const hitRect = chart.append("rect")
    .attr("class", "heatmap-hit")
    .attr("width", INNER_WIDTH)
    .attr("height", INNER_HEIGHT);
  // Markers must stay above the hit rect so they can be hovered.
  markerLayer.raise();

  const legend = svg.append("g")
    .attr("class", "heatmap-legend")
    .attr("transform", `translate(${MARGIN.left + INNER_WIDTH + 30},${MARGIN.top + 8})`);
  const legendHeight = INNER_HEIGHT - 60;
  legend.append("rect")
    .attr("width", 14)
    .attr("height", legendHeight)
    .attr("rx", 3)
    .attr("fill", `url(#${gradientId})`);
  const legendAxis = legend.append("g").attr("class", "heatmap-legend-axis").attr("transform", "translate(14,0)");
  const legendTitle = legend.append("text")
    .attr("class", "heatmap-legend-title")
    .attr("x", 0)
    .attr("y", legendHeight + 22);
  const legendHatch = legend.append("g").attr("transform", `translate(0,${legendHeight + 34})`);
  legendHatch.append("rect").attr("width", 14).attr("height", 14).attr("rx", 3).attr("fill", `url(#${hatchId})`).attr("class", "heatmap-legend-hatch");
  legendHatch.append("text").attr("class", "heatmap-legend-note").attr("x", 20).attr("y", 11).text(`< ${MIN_COUNT} designs`);

  const status = document.createElement("div");
  status.className = "heatmap-status";

  const tooltip = document.createElement("div");
  tooltip.className = "heatmap-tooltip";
  tooltip.hidden = true;

  frame.append(tooltip);
  root.append(header, controls, frame, status);

  // --- Worker plumbing -----------------------------------------------------------------

  const labelIndex = new Map(LABEL_DOMAIN.map((label, index) => [label, index]));
  const labelCodes = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index++) {
    labelCodes[index] = labelIndex.get(data[index].Label) ?? LABEL_DOMAIN.length;
  }

  let worker = null;
  let fallbackDataset = null;
  let latestRequestId = 0;
  let latest = null;
  let currentObjectUrl = null;
  const pendingSnapshots = new Map();

  try {
    worker = new Worker(new URL("./heatmapWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => handleResult(event.data);
    worker.onerror = (event) => {
      console.warn("Heatmap worker failed; binning on the main thread instead.", event.message);
      worker = null;
      fallbackDataset = { columns, labelCodes };
      requestBin();
    };
    // Columns are transferred (zero-copy); the worker owns them from here on. Keep a
    // lightweight copy only if we ever need the fallback.
    const transferColumns = columns.map((column) => column.slice());
    const transferCodes = labelCodes.slice();
    worker.postMessage(
      { type: "init", columns: transferColumns, labelCodes: transferCodes, lut },
      [...transferColumns.map((column) => column.buffer), transferCodes.buffer]
    );
  } catch (error) {
    console.warn("Module workers unavailable; heatmap bins on the main thread.", error);
    worker = null;
    fallbackDataset = { columns, labelCodes };
  }

  function getMetric() {
    return metrics.find((metric) => metric.id === state.metricId) ?? metrics[0];
  }

  function getSelectedLabels() {
    return contentController ? contentController.getSelectedLabels() : new Set(LABEL_DOMAIN);
  }

  function buildRequest() {
    const metric = getMetric();
    const selected = getSelectedLabels();
    const labelMask = new Uint8Array(LABEL_DOMAIN.length + 1);
    LABEL_DOMAIN.forEach((label, index) => {
      labelMask[index] = selected.has(label) ? 1 : 0;
    });
    const metricPayload = { kind: metric.kind };
    if (metric.kind === "mean") metricPayload.col = metric.col;
    if (metric.kind === "share") {
      metricPayload.labelMask = new Uint8Array(LABEL_DOMAIN.length + 1);
      for (const label of metric.labels) metricPayload.labelMask[labelIndex.get(label)] = 1;
    }
    return {
      xCol: state.xCol,
      yCol: state.yCol,
      xDomain: domains[state.xCol],
      yDomain: domains[state.yCol],
      nx: state.bins,
      ny: state.bins,
      metric: metricPayload,
      labelMask,
      smoothing: SMOOTHING.find((entry) => entry.id === state.smoothing)?.sigma ?? 0,
      minCount: MIN_COUNT
    };
  }

  function requestBin() {
    const requestId = ++latestRequestId;
    const request = buildRequest();
    const snapshot = { ...state, metric: getMetric(), selected: getSelectedLabels() };
    pendingSnapshots.set(requestId, snapshot);
    status.textContent = "Updating…";
    root.dataset.busy = "true";

    if (worker) {
      worker.postMessage({ type: "bin", requestId, request });
      return;
    }

    // Main-thread fallback: same code, deferred a frame so the control stays responsive.
    requestAnimationFrame(() => {
      if (requestId !== latestRequestId) return;
      const started = performance.now();
      const result = binHeatmap(fallbackDataset, request);
      const rgba = colorizeHeatmap(result, lut);
      handleResult({
        type: "result",
        requestId,
        ...result,
        rgba,
        blob: null,
        elapsedMs: performance.now() - started
      });
    });
  }

  function rgbaToDataUrl(rgba, nx, ny) {
    const canvas = document.createElement("canvas");
    canvas.width = nx;
    canvas.height = ny;
    canvas.getContext("2d").putImageData(new ImageData(rgba, nx, ny), 0, 0);
    return canvas.toDataURL("image/png");
  }

  function handleResult(message) {
    if (message?.type !== "result") return;
    const snapshot = pendingSnapshots.get(message.requestId);
    pendingSnapshots.delete(message.requestId);
    // Drop anything superseded by a newer request.
    if (message.requestId !== latestRequestId || !snapshot) return;

    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    let href;
    if (message.blob) {
      currentObjectUrl = URL.createObjectURL(message.blob);
      href = currentObjectUrl;
    } else {
      href = rgbaToDataUrl(message.rgba, message.nx, message.ny);
    }
    image.attr("href", href);

    latest = { ...message, snapshot };
    root.dataset.busy = "false";
    renderAxes();
    renderLegend();
    renderMarkers();
    renderStatus();
  }

  // --- Rendering -----------------------------------------------------------------------

  function applyInterpolation() {
    image.classed("heatmap-image-crisp", !state.interpolate);
  }

  function getScales() {
    const xDomain = domains[latest?.snapshot.xCol ?? state.xCol];
    const yDomain = domains[latest?.snapshot.yCol ?? state.yCol];
    return {
      x: d3.scaleLinear().domain(xDomain).range([0, INNER_WIDTH]),
      y: d3.scaleLinear().domain(yDomain).range([INNER_HEIGHT, 0])
    };
  }

  function renderAxes() {
    const { x, y } = getScales();
    xAxisLayer.call(d3.axisBottom(x).ticks(7).tickSizeOuter(0));
    yAxisLayer.call(d3.axisLeft(y).ticks(7).tickSizeOuter(0));
    xLabel.text(formatDimensionTitle(DIMENSIONS[latest.snapshot.xCol]));
    yLabel.text(formatDimensionTitle(DIMENSIONS[latest.snapshot.yCol]));
  }

  function formatMetric(value, metric) {
    if (!Number.isFinite(value)) return "–";
    if (metric.format === "percent") return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
    if (metric.format === "count") return d3.format(",.1~f")(value);
    return formatValue(value);
  }

  function renderLegend() {
    const metric = latest.snapshot.metric;
    const scale = d3.scaleLinear().domain([latest.vmin, latest.vmax]).range([legendHeight, 0]);
    const tickFormat = metric.format === "percent"
      ? d3.format(".0%")
      : metric.format === "count"
        ? d3.format("~s")
        : (value) => formatValue(value);
    legendAxis.call(d3.axisRight(scale).ticks(6).tickFormat(tickFormat));
    const smoothingLabel = latest.snapshot.smoothing === "off" ? "" : " (smoothed)";
    legendTitle.text(`${metric.label}${smoothingLabel}`);
    wrapLegendTitle();
  }

  // Legend titles such as "Mean Block Fuel (1000 lbm)" are wider than the legend column.
  function wrapLegendTitle() {
    const words = legendTitle.text().split(/\s+/);
    legendTitle.text(null);
    let line = [];
    let tspan = legendTitle.append("tspan").attr("x", 0).attr("dy", 0);
    for (const word of words) {
      line.push(word);
      tspan.text(line.join(" "));
      if (tspan.node().getComputedTextLength?.() > MARGIN.right - 34 && line.length > 1) {
        line.pop();
        tspan.text(line.join(" "));
        line = [word];
        tspan = legendTitle.append("tspan").attr("x", 0).attr("dy", "1.2em").text(word);
      }
    }
    legendHatch.attr("transform", `translate(0,${legendHeight + 34 + (legendTitle.selectAll("tspan").size() - 1) * 14})`);
  }

  function renderStatus() {
    const snapshot = latest.snapshot;
    const metric = snapshot.metric;
    const messages = [
      `${latest.used.toLocaleString()} designs binned into ${latest.nx} × ${latest.ny} cells in ${latest.elapsedMs.toFixed(1)} ms ${worker ? "on a worker thread" : "on the main thread"}.`
    ];
    if (metric.kind === "share") {
      const missing = metric.labels.filter((label) => !snapshot.selected.has(label));
      if (missing.length === metric.labels.length) {
        messages.push(`${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} filtered out in the Content box, so this share is 0 everywhere.`);
      } else if (snapshot.selected.size < LABEL_DOMAIN.length) {
        messages.push("Shares are computed among the labels selected in the Content box.");
      }
    }
    status.textContent = messages.join(" ");
  }

  function getMarkers() {
    if (!controller) return [];
    const selected = getSelectedLabels();
    const pinned = controller.getAllPinnedIds?.() ?? new Set();
    const highlighted = controller.getHighlightedPointIds?.() ?? new Set();
    const drawn = controller.getDrawnPointIds?.() ?? new Set();
    const markers = [];
    for (const pointId of new Set([...pinned, ...highlighted, ...drawn])) {
      const row = rowForPointId(pointId);
      if (!row || !selected.has(row.Label)) continue;
      markers.push({
        pointId,
        row,
        highlighted: highlighted.has(pointId),
        fill: drawn.has(pointId)
          ? getGTB777SketchColor(controller.getDrawnPointColorIndex?.(pointId) ?? 0)
          : pinned.has(pointId)
            ? SELECTION_COLOR
            : getLabelColor(row.Label)
      });
    }
    return markers.sort((a, b) => Number(a.highlighted) - Number(b.highlighted));
  }

  // Selected / highlighted / drawn designs from the Content box, as dots on top.
  function renderMarkers() {
    if (!latest) return;
    const { x, y } = getScales();
    const xKey = DIMENSIONS[latest.snapshot.xCol].key;
    const yKey = DIMENSIONS[latest.snapshot.yCol].key;
    markerLayer.selectAll("circle")
      .data(getMarkers(), (marker) => marker.pointId)
      .join("circle")
      .attr("class", (marker) => marker.highlighted ? "heatmap-marker heatmap-marker-highlight" : "heatmap-marker")
      .attr("cx", (marker) => x(Number(marker.row[xKey])))
      .attr("cy", (marker) => y(Number(marker.row[yKey])))
      .attr("r", (marker) => marker.highlighted ? 6 : 4.5)
      .style("--marker-fill", (marker) => marker.fill)
      .style("--marker-outline", HIGHLIGHT_OUTLINE_COLOR)
      .on("mouseenter", (event, marker) => {
        controller?.setHighlightedPointId?.(marker.pointId);
        showTooltip(event, `
          <strong>Design ${marker.row.__rowId + 1}</strong> · ${marker.row.Label}<br>
          ${formatDimensionTitle(DIMENSIONS[latest.snapshot.xCol])}: ${formatValue(Number(marker.row[xKey]))}<br>
          ${formatDimensionTitle(DIMENSIONS[latest.snapshot.yCol])}: ${formatValue(Number(marker.row[yKey]))}
        `);
      })
      .on("mouseleave", () => {
        controller?.clearHighlightedPointId?.();
        hideTooltip();
      });
  }

  function showTooltip(event, html) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const bounds = frame.getBoundingClientRect();
    const left = event.clientX - bounds.left + 14;
    const maxLeft = bounds.width - tooltip.offsetWidth - 8;
    tooltip.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
    tooltip.style.top = `${event.clientY - bounds.top + 14}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  hitRect
    .on("mousemove", (event) => {
      if (!latest) return;
      const [px, py] = d3.pointer(event, hitRect.node());
      const i = Math.min(latest.nx - 1, Math.max(0, Math.floor((px / INNER_WIDTH) * latest.nx)));
      const jFromTop = Math.min(latest.ny - 1, Math.max(0, Math.floor((py / INNER_HEIGHT) * latest.ny)));
      const j = latest.ny - 1 - jFromTop;
      const cell = j * latest.nx + i;
      const cellWidth = INNER_WIDTH / latest.nx;
      const cellHeight = INNER_HEIGHT / latest.ny;
      hoverCell
        .attr("visibility", "visible")
        .attr("x", i * cellWidth)
        .attr("y", jFromTop * cellHeight)
        .attr("width", cellWidth)
        .attr("height", cellHeight);

      const snapshot = latest.snapshot;
      const xDomain = domains[snapshot.xCol];
      const yDomain = domains[snapshot.yCol];
      const xStep = (xDomain[1] - xDomain[0]) / latest.nx;
      const yStep = (yDomain[1] - yDomain[0]) / latest.ny;
      const count = latest.rawCounts[cell];
      const value = latest.values[cell];
      const valueText = Number.isNaN(value)
        ? `fewer than ${MIN_COUNT} designs`
        : formatMetric(value, snapshot.metric);
      showTooltip(event, `
        <strong>${snapshot.metric.label}: ${valueText}</strong><br>
        ${formatDimensionTitle(DIMENSIONS[snapshot.xCol])}: ${formatValue(xDomain[0] + i * xStep)} – ${formatValue(xDomain[0] + (i + 1) * xStep)}<br>
        ${formatDimensionTitle(DIMENSIONS[snapshot.yCol])}: ${formatValue(yDomain[0] + j * yStep)} – ${formatValue(yDomain[0] + (j + 1) * yStep)}<br>
        Designs in cell: ${count.toLocaleString()}
      `);
    })
    .on("mouseleave", () => {
      hoverCell.attr("visibility", "hidden");
      hideTooltip();
    });

  // --- Wiring ----------------------------------------------------------------------------

  contentController?.subscribe?.((event) => {
    if (event.type === "labels") requestBin();
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

  applyInterpolation();
  requestBin();
  return root;
}
