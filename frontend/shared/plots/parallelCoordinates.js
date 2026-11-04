import d3 from "../d3-global.js";

const DEFAULT_DRAW_ORDER = {
  Infeasible: 0,
  "Level 2-2": 1,
  "Level 2-1": 2,
  "Level 1-1": 3,
};

const HIGHLIGHT_OUTLINE_COLOR = "#111827";
const HIGHLIGHT_OUTLINE_WIDTH = 4;
const HIGHLIGHT_LINE_WIDTH = 2;
const SELECTION_LINE_COLOR = "#16a34a";
const SELECTION_LINE_WIDTH = 2;
const RENDER_SCALE = 0.6;
const WORKER_CHUNK_ROWS = 1500;
const WORKER_PROGRESS_INTERVAL_MS = 48;
const BACKGROUND_ALPHA = 0.27;
const BACKGROUND_LINE_WIDTH = 1.25;
// Lines per label drawn live while an axis is dragged (the full set is too slow per frame)
const PREVIEW_ROWS_PER_LABEL = 700;
const PREVIEW_ALPHA = 0.35;

const supportsOffThreadRender =
  typeof Worker !== "undefined" &&
  typeof OffscreenCanvas !== "undefined" &&
  typeof createImageBitmap === "function";

/**
 * Reusable Parallel Coordinates Plot.
 * Supports both Demo 1 (GTB777 with controller/contentController/worker) and
 * Demo 2 (eVTOL ensemble with 12 inputs + 5 outputs + status, brushing, no-value band).
 *
 * @param {Array<Object>} data - Array of row objects.
 * @param {Object} config - Configuration object.
 * @returns {HTMLElement & { element: HTMLElement, setRows: Function, setFilters: Function, highlight: Function, destroy: Function }}
 */
// Same order as comparing labels with localeCompare, but equal labels (nearly every pair
// at 1M designs) skip the string comparison.
function sortByDrawOrder(rows, drawOrder) {
  rows.sort((a, b) => {
    const aVal = a.Label ?? a.status;
    const bVal = b.Label ?? b.status;
    const orderDelta = (drawOrder[aVal] ?? 99) - (drawOrder[bVal] ?? 99);
    if (orderDelta || aVal === bVal) return orderDelta;
    return String(aVal ?? "").localeCompare(String(bVal ?? ""));
  });
}

export function createParallelCoordinates(data = [], config = {}) {
  const {
        dimensions: configDimensions = [],
    colorBy: customColorBy = null,
    drawOrder = DEFAULT_DRAW_ORDER,
    title: chartTitle = "Parallel Coordinates",
    subtitle: chartSubtitle = "",
    colorDomain = null,
    colorRange = null,
    controller = null,
    contentController = null,
    workerUrl = null,
    getSketchColor = null,
    getHighlightOutlineColor = null,
    gapBeforeIndex = -1,
    showControls = false,
    onFilter = null,
    onHover = null,
    onClick = null,
    width = 1180,
    height = 560,
        margin = null,
  } = config;

  // Own copy: Demo 1 reorders it in place when an axis is dragged
  const dimensions = configDimensions.slice();

  const isDemo1Mode = Boolean(controller || contentController || workerUrl);

  const finalMargin =
    margin ??
    (isDemo1Mode
      ? { top: 112, right: 112, bottom: 28, left: 44 }
      : { top: 90, right: 60, bottom: 44, left: 50 });

  const innerWidth = width - finalMargin.left - finalMargin.right;
  const innerHeight = height - finalMargin.top - finalMargin.bottom;
  const noValueY = innerHeight + 22; // "no value" band below the axis line

  let sourceRows = data; // same rows as currentRows, unsorted
  let currentRows = data.slice();
  if (drawOrder) {
    sortByDrawOrder(currentRows, drawOrder);
  }

  let activeFilters = {};
  let selectedIdSet = isDemo1Mode ? new Set() : new Set(currentRows.map((r) => r.run ?? r.__rowId));
  let hoveredId = null;
  let currentColorByMode = "status";
  let suppressBrushEvent = false;
  // Demo 1: when true, hide the full dataset and show only drawn/pinned lines
    let highlightedOnly = false;
  // Demo 1: true while an axis is dragged (the dense background is hidden)
  let axisDragging = false;
    let dragStartOrder = "";
  // x of the axis under the cursor, so lines follow it exactly during a drag
  let dragOverride = null;

  const root = document.createElement("div");
  root.className = "parallel-container";

  // Header
  const header = document.createElement("div");
  header.className = "parallel-header";
  if (showControls) {
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.flexWrap = "wrap";
    header.style.gap = "12px";
    header.style.marginBottom = "8px";
  }

  const titleGroup = document.createElement("div");
  if (chartTitle) {
    const titleEl = document.createElement("div");
    titleEl.className = "parallel-title";
    titleEl.textContent = chartTitle;
    titleGroup.appendChild(titleEl);
  }
  if (chartSubtitle) {
    const subEl = document.createElement("div");
    subEl.className = "parallel-subtitle";
    subEl.textContent = chartSubtitle;
    titleGroup.appendChild(subEl);
  }
  header.appendChild(titleGroup);

  // Controls (Demo 2 mode: Clear brushes & Colour by)
  let clearBrushesBtn = null;
  let colorBySelect = null;
  if (showControls) {
    const controlsGroup = document.createElement("div");
    controlsGroup.className = "parallel-controls";
    controlsGroup.style.display = "flex";
    controlsGroup.style.alignItems = "center";
    controlsGroup.style.gap = "10px";

    clearBrushesBtn = document.createElement("button");
    clearBrushesBtn.type = "button";
    clearBrushesBtn.className = "btn btn-sm";
    clearBrushesBtn.textContent = "Clear brushes";

    const colorByContainer = document.createElement("div");
    colorByContainer.style.display = "inline-flex";
    colorByContainer.style.alignItems = "center";
    colorByContainer.style.gap = "6px";
    colorByContainer.style.fontSize = "13px";

    const colorByLabel = document.createElement("label");
    colorByLabel.textContent = "Colour by:";
    colorByLabel.style.color = "var(--text-muted, #94a3b8)";

    colorBySelect = document.createElement("select");
    colorBySelect.className = "select-sm";
    colorBySelect.innerHTML = `
      <option value="status">status</option>
      <option value="cruise_l_p_d">cruise L/D</option>
      <option value="mtow_kg">MTOW</option>
    `;
    colorByContainer.append(colorByLabel, colorBySelect);

    controlsGroup.append(clearBrushesBtn, colorByContainer);
    header.appendChild(controlsGroup);
  }

  const frame = document.createElement("div");
  frame.className = "parallel-frame";
  frame.style.position = "relative";
  frame.style.width = "100%";
  frame.style.borderRadius = "var(--radius, 2px)";
  frame.style.background = "var(--surface, #ffffff)";
  frame.style.border = "1px solid var(--line, #d3d3cf)";
  if (!isDemo1Mode) {
    // Demo 2 overlays an absolute SVG on a fixed-height frame. In Demo 1 the
    // in-flow SVG sets the frame height, so the stretched canvas matches the axes.
    frame.style.height = `${height}px`;
    frame.style.overflow = "hidden";
  }

  const canvas = document.createElement("canvas");
  canvas.className = "parallel-canvas";
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("aria-hidden", "true");

  const svg = d3
    .select(frame)
    .append("svg")
    .attr("class", "parallel-svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", chartTitle || "Parallel coordinates plot");

  if (!isDemo1Mode) {
    svg
      .style("position", "absolute")
      .style("top", "0")
      .style("left", "0")
      .style("width", "100%")
      .style("height", "100%")
      .style("pointer-events", "none");
  }

  const chart = svg.append("g").attr("transform", `translate(${finalMargin.left},${finalMargin.top})`);
  const axesGroup = chart.append("g").attr("class", "parallel-axes");
  const brushesGroup = chart.append("g").attr("class", "parallel-brushes");

  frame.prepend(canvas);
  root.append(header, frame);

  const context = canvas.getContext("2d");

  // Determine x positions with optional visual gap
  const xPositions = new Map();
  const gapPx = 28;
  const dimCount = dimensions.length;
  const totalGap = gapBeforeIndex >= 0 && gapBeforeIndex < dimCount ? gapPx : 0;
  const availWidth = innerWidth - totalGap;
  const step = dimCount > 1 ? availWidth / (dimCount - 1) : 0;

    function layoutAxes() {
    dimensions.forEach((dim, idx) => {
      let px = idx * step;
      if (gapBeforeIndex >= 0 && idx >= gapBeforeIndex) {
        px += gapPx;
      }
      xPositions.set(dim.key, px);
    });
  }
  layoutAxes();

  // Scales
  const scales = new Map();
  const brushObjects = new Map();
  const brushNodes = new Map();

  function buildScales() {
    scales.clear();
    dimensions.forEach((dim) => {
      if (dim.type === "category") {
        const domain = dim.categories || ["diverged", "max_iter", "converged"];
        const sc = d3.scalePoint().domain(domain).range([innerHeight, 0]);
        scales.set(dim.key, sc);
      } else {
        // Plain loop over the rows in their given order: reading them in draw order and
        // through d3.extent's callback took ~2.4 s for 11 axes at 1M designs.
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < sourceRows.length; i++) {
          const v = Number(sourceRows[i][dim.key]);
          if (!Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        let extent = lo <= hi ? [lo, hi] : [undefined, undefined];
        if (!extent[0] && !extent[1]) {
          extent = [dim.min ?? 0, dim.max ?? 1];
        }
        const span = extent[1] - extent[0] || 1;
        const pad = span * 0.04;
        const sc = d3
          .scaleLinear()
          .domain([extent[0] - pad, extent[1] + pad])
          .range([innerHeight, 0]);
        scales.set(dim.key, sc);
      }
    });
  }

  buildScales();

  // Colors (matching app's Okabe-Ito tokens in tokens.css / charts.css)
  const defaultStatusColors = {
    converged: "#0072b2",
    max_iter: "#d55e00",
    diverged: "#5f5f5b",
    error: "#a3271d",
    Success: "#0072b2",
    NotConverged: "#d55e00",
    ValueError: "#5f5f5b",
  };

  const ldColorScale = d3.scaleSequential((t) => d3.interpolateBlues(0.35 + 0.60 * t)).domain([8.5, 13.0]);
  const mtowColorScale = d3.scaleSequential((t) => d3.interpolateBlues(0.35 + 0.60 * t)).domain([2000, 6500]);
  const fallbackColor = colorDomain && colorRange ? d3.scaleOrdinal(colorDomain, colorRange) : null;

  function getRowColor(row) {
    if (customColorBy) {
      return customColorBy(row);
    }
    if (fallbackColor && row.Label) {
      return fallbackColor(row.Label);
    }
    if (currentColorByMode === "cruise_l_p_d") {
      const v = row.cruise_l_p_d;
      return typeof v === "number" && Number.isFinite(v) ? ldColorScale(v) : "#64748b";
    }
    if (currentColorByMode === "mtow_kg") {
      const v = row.mtow_kg;
      return typeof v === "number" && Number.isFinite(v) ? mtowColorScale(v) : "#64748b";
    }
    const st = row.status ?? "converged";
    return defaultStatusColors[st] || "#38bdf8";
  }

  function getPointY(dim, row) {
    const val = row[dim.key];
    const sc = scales.get(dim.key);
    if (!sc) return noValueY;
    if (dim.type === "category") {
      const mapped = sc(val ?? "diverged");
      return mapped !== undefined ? mapped : noValueY;
    }
    if (val == null || !Number.isFinite(Number(val))) {
      return noValueY;
    }
    return sc(Number(val));
  }

    function axisX(dim) {
    return dragOverride && dragOverride.key === dim.key ? dragOverride.x : xPositions.get(dim.key);
  }

  function getRowPoints(row) {
    return dimensions.map((dim) => [
      finalMargin.left + axisX(dim),
      finalMargin.top + getPointY(dim, row),
    ]);
  }

  // --- Demo 1 Worker and Controller Support ---
  const rowsById = new Map();
  const highlightedPathCache = new Map();
  const rowsByLabel = new Map((colorDomain || []).map((l) => [l, []]));
  const labelCanvasCache = new Map();
  const rasterCanvasCache = new Map();

  for (const row of currentRows) {
    // Demo 1's Content box already maps point ids to rows; a second 1M-entry map is slow
    if (!contentController?.getRowByPointId) {
      rowsById.set(`point-${row.__rowId ?? row.run}`, row);
    }
    if (row.Label && rowsByLabel.has(row.Label)) {
      rowsByLabel.get(row.Label).push(row);
    }
  }

  function rowForPointId(pointId) {
    return contentController?.getRowByPointId ? contentController.getRowByPointId(pointId) : rowsById.get(pointId);
  }

  // Labels drawn right now. Read from the Content box rather than refiltering every row
  // on each redraw (hover, pin, paint), which took ~100 ms per redraw at 1M designs.
  let labelsInRows = null;
  function getVisibleLabels() {
    if (contentController) return contentController.getSelectedLabels();
    labelsInRows ??= new Set(currentRows.map((row) => row.Label));
    return labelsInRows;
  }

  function getVisibleData() {
    return contentController ? contentController.getFilteredData(currentRows) : currentRows;
  }

  function getRowPath(pointId, row) {
    let path = highlightedPathCache.get(pointId);
    if (!path) {
      path = new Path2D();
      getRowPoints(row).forEach(([pointX, pointY], index) => {
        if (index === 0) path.moveTo(pointX, pointY);
        else path.lineTo(pointX, pointY);
      });
      highlightedPathCache.set(pointId, path);
    }
    return path;
  }

  function drawContentBoxSelectionLines(visibleLabels) {
    const pinnedPointIds = controller?.getAllPinnedIds?.() ?? new Set();
    if (!pinnedPointIds.size) return;
    for (const pointId of pinnedPointIds) {
      const row = rowForPointId(pointId);
      if (!row || (visibleLabels && !visibleLabels.has(row.Label))) continue;
      const path = getRowPath(pointId, row);
      context.globalAlpha = 1;
      context.lineWidth = SELECTION_LINE_WIDTH;
      context.strokeStyle = SELECTION_LINE_COLOR;
      context.stroke(path);
    }
  }

  function drawHoverAndPinHighlights(visibleLabels) {
    const highlightedPointIds = controller?.getHighlightedPointIds?.() ?? new Set();
    if (!highlightedPointIds.size) return;
    for (const pointId of highlightedPointIds) {
      const row = rowForPointId(pointId);
      if (!row || (visibleLabels && !visibleLabels.has(row.Label))) continue;
      const path = getRowPath(pointId, row);
      context.globalAlpha = 1;
      context.lineWidth = HIGHLIGHT_OUTLINE_WIDTH;
      const outlineColor = getHighlightOutlineColor
        ? getHighlightOutlineColor(getRowColor(row), { dark: HIGHLIGHT_OUTLINE_COLOR })
        : HIGHLIGHT_OUTLINE_COLOR;
      context.strokeStyle = outlineColor;
      context.stroke(path);

      context.lineWidth = HIGHLIGHT_LINE_WIDTH;
      context.strokeStyle = getRowColor(row);
      context.stroke(path);
    }
  }

  function drawHighlightedLines(visibleLabels) {
    const drawnPointIds = controller?.getDrawnPointIds?.() ?? new Set();
    for (const [pointId, drawIndex] of drawnPointIds.entries()) {
      const row = rowForPointId(pointId);
      if (!row || (visibleLabels && !visibleLabels.has(row.Label))) continue;
      const path = getRowPath(pointId, row);
      const lineColor = getSketchColor
        ? getSketchColor(controller?.getDrawnPointColorIndex?.(pointId) ?? drawIndex)
        : "#2563eb";
      context.globalAlpha = 1;
      if (!highlightedOnly) {
        // outline so the drawn line stands out on top of the full dataset
        context.lineWidth = 5;
        context.strokeStyle = getHighlightOutlineColor
          ? getHighlightOutlineColor(lineColor, { dark: HIGHLIGHT_OUTLINE_COLOR })
          : HIGHLIGHT_OUTLINE_COLOR;
        context.stroke(path);
      }
      context.lineWidth = 3;
      context.strokeStyle = lineColor;
      context.stroke(path);
    }
  }

    // Evenly spaced sample of each label's rows, built on first use
  let previewRowsByLabel = null;
  function getPreviewRows(label) {
    if (!previewRowsByLabel) {
      previewRowsByLabel = new Map();
      for (const [key, rows] of rowsByLabel) {
        const stride = Math.max(1, rows.length / PREVIEW_ROWS_PER_LABEL);
        const sample = [];
        for (let i = 0; i < rows.length; i += stride) sample.push(rows[Math.floor(i)]);
        previewRowsByLabel.set(key, sample);
      }
    }
    return previewRowsByLabel.get(label) ?? [];
  }

  function drawPreviewLines(visibleLabels) {
    context.globalAlpha = PREVIEW_ALPHA;
    context.lineWidth = 1;
    for (const label of colorDomain) {
      if (!visibleLabels.has(label)) continue;
      const path = new Path2D();
      for (const row of getPreviewRows(label)) {
        getRowPoints(row).forEach(([pointX, pointY], index) => {
          if (index === 0) path.moveTo(pointX, pointY);
          else path.lineTo(pointX, pointY);
        });
      }
      context.strokeStyle = getRowColor({ Label: label });
      context.stroke(path);
    }
    context.globalAlpha = 1;
  }

  function drawCachedBackground(visibleLabels) {
    if (highlightedOnly) return;
    if (axisDragging || pendingRebuild.size) {
      // moving lines during a drag, and until the full redraw has finished
      drawPreviewLines(visibleLabels);
      return;
    }
    context.globalAlpha = 1;
    if (colorDomain) {
      for (const label of colorDomain) {
        const cachedCanvas = labelCanvasCache.get(label);
        if (visibleLabels.has(label) && cachedCanvas) {
          context.drawImage(cachedCanvas, 0, 0);
        }
      }
    }
  }

  function getOrCreateLabelCache(label) {
    let cache = labelCanvasCache.get(label);
    if (!cache) {
      cache = document.createElement("canvas");
      cache.width = width;
      cache.height = height;
      labelCanvasCache.set(label, cache);
    }
    return cache;
  }

  function buildRowsFloatArray(labelRows) {
    const count = dimensions.length;
    const flat = new Float32Array(labelRows.length * count);
    // Column by column: one key per pass reads the row objects much faster
    for (let dimIndex = 0; dimIndex < count; dimIndex++) {
      const key = dimensions[dimIndex].key;
      for (let rowIndex = 0; rowIndex < labelRows.length; rowIndex++) {
        flat[rowIndex * count + dimIndex] = Number(labelRows[rowIndex][key]);
      }
    }
    return flat;
  }

    let worker = null;
  // labels whose full background is still being redrawn after an axis move
  const pendingRebuild = new Set();
  let nextRequestId = 0;
  const requestIdByKey = new Map();
  const pendingBitmaps = new Map();
  let paintScheduled = false;

  function schedulePaint() {
    if (paintScheduled) return;
    paintScheduled = true;
    window.requestAnimationFrame(() => {
      paintScheduled = false;
      for (const [label, bitmap] of pendingBitmaps) {
        const cache = getOrCreateLabelCache(label);
        const cacheContext = cache.getContext("2d");
        cacheContext.clearRect(0, 0, width, height);
        cacheContext.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
      }
      pendingBitmaps.clear();
      render();
    });
  }

  function buildBackgroundsOnWorker() {
        if (!workerUrl || !colorDomain) return;
    if (!worker) {
    worker = new Worker(workerUrl, { type: "module" });
    worker.onmessage = (event) => {
      const message = event.data;
      if (message?.type !== "progress") return;
      if (requestIdByKey.get(message.canvasKey) !== message.requestId) {
        message.bitmap.close();
        return;
      }
      const prev = pendingBitmaps.get(message.canvasKey);
      if (prev) prev.close();
                        pendingBitmaps.set(message.canvasKey, message.bitmap);
      if (message.done) pendingRebuild.delete(message.canvasKey);
      schedulePaint();
    };
    }

    const axisPositions = new Float32Array(
      dimensions.map((dim) => finalMargin.left + xPositions.get(dim.key))
    );
    const axisScales = new Float32Array(dimensions.length * 4);
    dimensions.forEach((dim, index) => {
      const scale = scales.get(dim.key);
      const [domainMin, domainMax] = scale.domain();
      const [rangeAtDomainMin, rangeAtDomainMax] = scale.range();
      axisScales[index * 4 + 0] = domainMin;
      axisScales[index * 4 + 1] = domainMax;
      axisScales[index * 4 + 2] = finalMargin.top + rangeAtDomainMin;
      axisScales[index * 4 + 3] = finalMargin.top + rangeAtDomainMax;
    });

    for (const label of colorDomain) {
      const labelRows = rowsByLabel.get(label) ?? [];
      if (!labelRows.length) continue;
      const requestId = ++nextRequestId;
      requestIdByKey.set(label, requestId);
      const rowsFloatArray = buildRowsFloatArray(labelRows);
      worker.postMessage(
        {
          type: "buildBackground",
          requestId,
          canvasKey: label,
          width,
          height,
          renderScale: RENDER_SCALE,
          dimensionCount: dimensions.length,
          axisPositions,
          axisScales,
          rows: rowsFloatArray,
          style: {
            color: getRowColor({ Label: label }),
            alpha: BACKGROUND_ALPHA,
            lineWidth: BACKGROUND_LINE_WIDTH,
          },
          chunkRows: WORKER_CHUNK_ROWS,
          progressIntervalMs: WORKER_PROGRESS_INTERVAL_MS,
        },
        [rowsFloatArray.buffer]
      );
    }
  }

    let mainThreadGen = 0;
  function buildBackgroundsOnMainThread(labelIndex = 0, rowIndex = 0, gen = mainThreadGen) {
    if (gen !== mainThreadGen) return;
        if (!colorDomain || labelIndex >= colorDomain.length) {
      pendingRebuild.clear();
      render();
      return;
    }
    const label = colorDomain[labelIndex];
    const labelRows = rowsByLabel.get(label) ?? [];
    if (!labelRows.length) {
      window.requestAnimationFrame(() => buildBackgroundsOnMainThread(labelIndex + 1, 0, gen));
      return;
    }
    const cache = getOrCreateLabelCache(label);
    const rasterWidth = Math.max(1, Math.round(width * RENDER_SCALE));
    const rasterHeight = Math.max(1, Math.round(height * RENDER_SCALE));
    let raster = rasterCanvasCache.get(label);
    if (!raster) {
      raster = document.createElement("canvas");
      raster.width = rasterWidth;
      raster.height = rasterHeight;
      rasterCanvasCache.set(label, raster);
    }
    const rasterContext = raster.getContext("2d");
    const endIndex = Math.min(rowIndex + 350, labelRows.length);
    const path = new Path2D();
    for (let index = rowIndex; index < endIndex; index++) {
      getRowPoints(labelRows[index]).forEach(([pointX, pointY], pointIndex) => {
        const scaledX = pointX * RENDER_SCALE;
        const scaledY = pointY * RENDER_SCALE;
        if (pointIndex === 0) path.moveTo(scaledX, scaledY);
        else path.lineTo(scaledX, scaledY);
      });
    }
    rasterContext.globalAlpha = BACKGROUND_ALPHA;
    rasterContext.lineWidth = Math.max(0.5, BACKGROUND_LINE_WIDTH * RENDER_SCALE);
    rasterContext.strokeStyle = getRowColor({ Label: label });
    rasterContext.lineJoin = "round";
    rasterContext.lineCap = "round";
    rasterContext.stroke(path);

    const cacheContext = cache.getContext("2d");
    cacheContext.clearRect(0, 0, width, height);
    cacheContext.drawImage(raster, 0, 0, width, height);
    render();

    if (endIndex < labelRows.length) {
      window.requestAnimationFrame(() => buildBackgroundsOnMainThread(labelIndex, endIndex, gen));
    } else {
      window.requestAnimationFrame(() => buildBackgroundsOnMainThread(labelIndex + 1, 0, gen));
    }
  }

    // Redraw the dense background after the axes were reordered
    function rebuildBackgrounds() {
    pendingRebuild.clear();
    for (const label of colorDomain ?? []) {
      if ((rowsByLabel.get(label) ?? []).length) pendingRebuild.add(label);
    }
    for (const cache of labelCanvasCache.values()) {
      cache.getContext("2d").clearRect(0, 0, width, height);
    }
    rasterCanvasCache.clear();
    if (supportsOffThreadRender && workerUrl) {
      buildBackgroundsOnWorker();
    } else {
      mainThreadGen++;
      window.requestAnimationFrame(() => buildBackgroundsOnMainThread());
    }
  }

  // --- Rendering Pipeline ---
  function render() {
    if (isDemo1Mode) {
      context.clearRect(0, 0, width, height);
      const visibleLabels = getVisibleLabels();
      drawCachedBackground(visibleLabels);
      drawContentBoxSelectionLines(visibleLabels);
      drawHoverAndPinHighlights(visibleLabels);
      drawHighlightedLines(visibleLabels);
    } else {
      renderDemo2Canvas();
    }
  }

  function renderDemo2Canvas() {
    context.clearRect(0, 0, width, height);

    // Draw no-value guideline under output axes
    const outputDims = dimensions.filter((d) => d.hasNoValue);
    if (outputDims.length > 1) {
      const firstX = finalMargin.left + xPositions.get(outputDims[0].key);
      const lastX = finalMargin.left + xPositions.get(outputDims[outputDims.length - 1].key);
      context.save();
      context.strokeStyle = "rgba(100, 116, 139, 0.4)";
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(firstX, finalMargin.top + noValueY);
      context.lineTo(lastX, finalMargin.top + noValueY);
      context.stroke();
      context.restore();
    }

    const unselected = [];
    const selected = [];
    let highlightedRow = null;

    for (const r of currentRows) {
      const id = r.run ?? r.__rowId;
      if (id === hoveredId) {
        highlightedRow = r;
      }
      if (selectedIdSet.has(id)) {
        selected.push(r);
      } else {
        unselected.push(r);
      }
    }

    // 1. Unselected lines faint grey
    context.lineWidth = 1;
    context.globalAlpha = 0.08;
    context.strokeStyle = "#94a3b8";
    for (const row of unselected) {
      const points = getRowPoints(row);
      context.beginPath();
      points.forEach(([px, py], idx) => {
        if (idx === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.stroke();
    }

    // 2. Selected lines: failed designs in grey first, then converged designs
    selected.sort((a, b) => {
      const aConv = a.status === "converged" || a.status === "Success" ? 1 : 0;
      const bConv = b.status === "converged" || b.status === "Success" ? 1 : 0;
      return aConv - bConv;
    });

    const baseAlpha = selected.length > 500 ? 0.28 : selected.length > 100 ? 0.45 : 0.75;
    for (const row of selected) {
      if (row === highlightedRow) continue;
      const points = getRowPoints(row);
      const isFailed = row.status && row.status !== "converged" && row.status !== "Success";
      context.globalAlpha = isFailed ? Math.min(0.22, baseAlpha) : baseAlpha;
      context.lineWidth = isFailed ? 1 : 1.25;
      context.strokeStyle = isFailed ? "#64748b" : getRowColor(row);
      context.beginPath();
      points.forEach(([px, py], idx) => {
        if (idx === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.stroke();
    }

    // 3. Highlighted line
    if (highlightedRow) {
      const points = getRowPoints(highlightedRow);
      context.save();
      context.globalAlpha = 1;
      context.lineWidth = 4;
      context.strokeStyle = "#ffffff";
      context.beginPath();
      points.forEach(([px, py], idx) => {
        if (idx === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.stroke();

      context.lineWidth = 2.5;
      context.strokeStyle = getRowColor(highlightedRow);
      context.stroke();
      context.restore();
    }
  }

    // --- SVG Axes & Brushes ---
  function moveAxes(dragged, dragX) {
    axesGroup
      .selectAll(".parallel-axis")
      .attr("transform", (d) => `translate(${d === dragged ? dragX : xPositions.get(d.key)},0)`);
  }

  // Demo 1: drag an axis title sideways to reorder the axes
  const axisDrag = d3
    .drag()
    .subject((event, dim) => ({ x: xPositions.get(dim.key), y: 0 }))
    .on("start", (event, dim) => {
      axisDragging = true;
      dragStartOrder = dimensions.map((d) => d.key).join("|");
      axesGroup.selectAll(".parallel-axis-label").style("cursor", "grabbing");
      render();
    })
    .on("drag", (event, dim) => {
            const dragX = Math.max(0, Math.min(innerWidth, event.x));
      dragOverride = { key: dim.key, x: dragX };
      const at = (d) => (d === dim ? dragX : xPositions.get(d.key));
      dimensions.sort((a, b) => at(a) - at(b));
      layoutAxes();
      moveAxes(dim, dragX);
      highlightedPathCache.clear();
      render();
    })
    .on("end", () => {
            axisDragging = false;
      dragOverride = null;
      axesGroup.selectAll(".parallel-axis-label").style("cursor", "grab");
      moveAxes(null, 0);
      highlightedPathCache.clear();
      if (dimensions.map((d) => d.key).join("|") !== dragStartOrder) {
        rebuildBackgrounds();
      }
      render();
    });

  function renderAxes() {
    axesGroup.selectAll("*").remove();
    brushesGroup.selectAll("*").remove();

    dimensions.forEach((dim) => {
      const xPos = xPositions.get(dim.key);
      const sc = scales.get(dim.key);
      const axisG = axesGroup
        .append("g")
                .attr("class", "parallel-axis")
        .attr("transform", `translate(${xPos},0)`)
        .datum(dim);

      let axisGen;
      if (dim.type === "category") {
        axisGen = d3.axisLeft(sc).tickFormat((d) => {
          if (d === "converged") return "conv";
          if (d === "max_iter") return "iter";
          if (d === "diverged") return "div";
          return d;
        });
      } else {
        axisGen = d3
          .axisLeft(sc)
          .ticks(5)
          .tickFormat((v) => {
            if (Math.abs(v) >= 1000) return `${Math.round(v / 100) / 10}k`;
            return `${v}`;
          });
      }

      axisG.call(axisGen);

      if (!isDemo1Mode) {
        axisG.selectAll("text").style("fill", "var(--text-muted, #94a3b8)").style("font-size", "11px");
        axisG.selectAll("line, path").style("stroke", "rgba(148, 163, 184, 0.3)");
      }

      // Rotated axis title
      axisG
        .append("text")
        .attr("class", "parallel-axis-label")
        .attr("text-anchor", "start")
        .attr("transform", "rotate(-32)")
        .attr("x", 4)
        .attr("y", -14)
                .text(dim.label);

      if (isDemo1Mode) {
        // the SVG ignores the pointer so clicks reach the canvas; the title is the drag handle
        axisG.select(".parallel-axis-label").style("pointer-events", "all").style("cursor", "grab");
        axisG.call(axisDrag);
      }

      // No-value mark on output axes
      if (dim.hasNoValue) {
        axisG
          .append("text")
          .attr("class", "no-value-label")
          .attr("text-anchor", "middle")
          .attr("y", noValueY + 12)
          .style("fill", "var(--text-muted, #64748b)")
          .style("font-size", "10px")
          .text("no value");

        axisG
          .append("line")
          .attr("x1", -4)
          .attr("x2", 4)
          .attr("y1", noValueY)
          .attr("y2", noValueY)
          .style("stroke", "rgba(100, 116, 139, 0.6)");
      }

      // Brushing for Demo 2
      if (!isDemo1Mode && dim.type !== "category") {
        const brush = d3
          .brushY()
          .extent([
            [-14, 0],
            [14, innerHeight],
          ])
          .on("brush end", (event) => onAxisBrush(event, dim));

        const brushG = brushesGroup
          .append("g")
          .attr("class", `brush brush-${dim.key}`)
          .attr("transform", `translate(${xPos},0)`)
          .style("pointer-events", "all");

        brushG.call(brush);
        brushG.selectAll(".overlay, .selection, .handle").style("pointer-events", "all");
        brushObjects.set(dim.key, brush);
        brushNodes.set(dim.key, brushG);

        brushG.on("dblclick", () => {
          brushG.call(brush.move, null);
        });
      }
    });
  }

  function recomputeSelection() {
    const activeKeys = Object.keys(activeFilters);
    selectedIdSet = new Set();

    for (const r of currentRows) {
      let matches = true;
      for (const key of activeKeys) {
        const span = activeFilters[key];
        if (!span) continue;
        const val = r[key];
        if (val == null || !Number.isFinite(Number(val))) {
          matches = false;
          break;
        }
        const [lo, hi] = span;
        if (Number(val) < lo || Number(val) > hi) {
          matches = false;
          break;
        }
      }
      if (matches) {
        selectedIdSet.add(r.run ?? r.__rowId);
      }
    }

    render();
    if (!suppressBrushEvent) {
      onFilter?.(activeFilters, selectedIdSet);
    }
  }

  function onAxisBrush(event, dim) {
    if (suppressBrushEvent) return;
    const selection = event.selection;
    if (selection) {
      const sc = scales.get(dim.key);
      const [y0, y1] = selection;
      const v0 = sc.invert(y0);
      const v1 = sc.invert(y1);
      activeFilters[dim.key] = [Math.min(v0, v1), Math.max(v0, v1)];
    } else {
      delete activeFilters[dim.key];
    }
    recomputeSelection();
  }

  function clearAllBrushes() {
    suppressBrushEvent = true;
    brushNodes.forEach((node, key) => {
      const b = brushObjects.get(key);
      if (b && node) {
        node.call(b.move, null);
      }
    });
    activeFilters = {};
    suppressBrushEvent = false;
    recomputeSelection();
  }

  if (clearBrushesBtn) {
    clearBrushesBtn.addEventListener("click", clearAllBrushes);
  }

  if (colorBySelect) {
    colorBySelect.addEventListener("change", (e) => {
      currentColorByMode = e.target.value;
      render();
    });
  }

  // --- Interaction on Canvas ---
  function getCanvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return [
      ((event.clientX - bounds.left) * width) / bounds.width,
      ((event.clientY - bounds.top) * height) / bounds.height,
    ];
  }

  function distToSegment(p, v, w) {
    const l2 = (w[0] - v[0]) ** 2 + (w[1] - v[1]) ** 2;
    if (l2 === 0) return Math.hypot(p[0] - v[0], p[1] - v[1]);
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (v[0] + t * (w[0] - v[0])), p[1] - (v[1] + t * (w[1] - v[1])));
  }

  function getRowAtPointer(event) {
    const [mx, my] = getCanvasPoint(event);
    let closestDist = 8;
    let closestRow = null;
    const candidates = isDemo1Mode ? getVisibleData() : currentRows;
    // Only segments whose x span reaches within 8 px of the pointer can be closer than 8 px
    const xs = dimensions.map((dim) => finalMargin.left + axisX(dim));
    const near = [];
    for (let i = 0; i < xs.length - 1; i++) {
      if (mx >= Math.min(xs[i], xs[i + 1]) - closestDist && mx <= Math.max(xs[i], xs[i + 1]) + closestDist) {
        near.push(i);
      }
    }
    if (!near.length) return null;

    for (const row of candidates) {
      for (const i of near) {
        const v = [xs[i], finalMargin.top + getPointY(dimensions[i], row)];
        const w = [xs[i + 1], finalMargin.top + getPointY(dimensions[i + 1], row)];
        const d = distToSegment([mx, my], v, w);
        if (d < closestDist) {
          closestDist = d;
          closestRow = row;
        }
      }
    }
    return closestRow;
  }

  canvas.addEventListener("mousemove", (event) => {
    if (isDemo1Mode) return;
    const closestRow = getRowAtPointer(event);
    const newHoverId = closestRow ? closestRow.run ?? closestRow.__rowId : null;
    if (newHoverId !== hoveredId) {
      hoveredId = newHoverId;
      render();
      onHover?.(closestRow);
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if (isDemo1Mode) return;
    if (hoveredId !== null) {
      hoveredId = null;
      render();
      onHover?.(null);
    }
  });

  canvas.addEventListener("click", (event) => {
    if (isDemo1Mode) {
      if (!controller || (controller.getTool?.() !== "move" && controller.getTool?.() !== "select")) {
        return;
      }
      const row = getRowAtPointer(event);
      if (row) {
        controller.togglePin?.("plot-parallel-coordinates", `point-${row.__rowId ?? row.run}`, event.ctrlKey);
      } else if (!event.ctrlKey) {
        controller.clearPins?.("plot-parallel-coordinates");
      }
    } else {
      const row = getRowAtPointer(event);
      if (row) onClick?.(row);
    }
  });

  // Demo 1 Legend
  if (isDemo1Mode && colorDomain && colorRange) {
    const legend = document.createElement("div");
    legend.className = "parallel-legend";
    colorDomain.forEach((label, index) => {
      const item = document.createElement("span");
      item.className = "parallel-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "parallel-legend-swatch";
      swatch.style.setProperty("--legend-color", colorRange[index]);
      const text = document.createElement("span");
      text.textContent = label;
      item.append(swatch, text);
      legend.appendChild(item);
    });

    const toggle = document.createElement("label");
    toggle.className = "parallel-toggle";
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = highlightedOnly;
    toggleInput.addEventListener("change", () => {
      highlightedOnly = toggleInput.checked;
      render();
    });
    const toggleText = document.createElement("span");
    toggleText.textContent = "Highlighted only";
    toggle.append(toggleInput, toggleText);
    legend.appendChild(toggle);

    root.appendChild(legend);
  }

  // Demo 1 Controller Subscriptions
  if (contentController) {
    contentController.subscribe((event) => {
      if (event.type === "labels" || event.type === "drawPoints") {
        render();
      }
    });
  }

  if (controller) {
    controller.subscribe?.((event) => {
      if (
        event.type === "drawPoints" ||
        event.type === "highlightedPoint" ||
        event.type === "pinnedHighlight" ||
        event.type === "pins"
      ) {
        render();
      }
    });
  }

  // Initialize
  renderAxes();
  render();

  if (isDemo1Mode) {
    if (supportsOffThreadRender && workerUrl) {
      buildBackgroundsOnWorker();
    } else {
      window.requestAnimationFrame(() => buildBackgroundsOnMainThread());
    }
  }

  // Return DOM node with public API attached
  root.element = root;
  root.setRows = function (newRows) {
    sourceRows = newRows || [];
    currentRows = sourceRows.slice();
    if (drawOrder) {
      sortByDrawOrder(currentRows, drawOrder);
    }
    labelsInRows = null;
    buildScales();
    renderAxes();
    recomputeSelection();
  };

  root.setFilters = function (filters = {}) {
    suppressBrushEvent = true;
    activeFilters = { ...filters };
    brushNodes.forEach((node, key) => {
      const b = brushObjects.get(key);
      const sc = scales.get(key);
      if (b && node && sc) {
        if (activeFilters[key]) {
          const [lo, hi] = activeFilters[key];
          const y0 = sc(hi);
          const y1 = sc(lo);
          node.call(b.move, [Math.min(y0, y1), Math.max(y0, y1)]);
        } else {
          node.call(b.move, null);
        }
      }
    });
    suppressBrushEvent = false;
    recomputeSelection();
  };

  root.highlight = function (id) {
    if (hoveredId !== id) {
      hoveredId = id;
      render();
    }
  };

  root.destroy = function () {
    if (clearBrushesBtn) {
      clearBrushesBtn.removeEventListener("click", clearAllBrushes);
    }
    if (worker) {
      worker.terminate();
    }
    root.remove();
  };

  return root;
}
