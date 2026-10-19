import { getGTB777SketchColor } from "./sketchGTB777.js";
import { getHighlightOutlineColor } from "./colorUtils.js";
import { HIGHLIGHT_OUTLINE_COLOR, LABEL_COLORS, SELECTION_COLOR } from "./gtb777Dimensions.js";

const drawOrder = {
  "Infeasible": 0,
  "Level 2-2": 1,
  "Level 2-1": 2,
  "Level 1-1": 3
};

const colorDomain = ["Infeasible", "Level 2-2", "Level 2-1", "Level 1-1"];
const colorRange = LABEL_COLORS;

const dimensions = [
  { key: "ARHT", label: "ARHT" },
  { key: "TRHT", label: "TRHT" },
  { key: "TCHT", label: "TCHT" },
  { key: "SWPHT (deg)", label: "SWPHT (deg)" },
  { key: "SHT (sqft)", label: "SHT (sqft)" },
  { key: "ETAIE", label: "ETAIE" },
  { key: "ETAOE", label: "ETAOE" },
  { key: "CRE", label: "CRE" },
  { key: "OEW (1000 lbm)", label: "OEW (1000 lbm)" },
  { key: "Block Fuel (1000 lbm)", label: "Block Fuel (1000 lbm)" },
  { key: "Cruise CD (count)", label: "Cruise CD (count)" }
];

// The background density layer is rasterized at a reduced resolution and then scaled up
// on composite. At the low opacity these lines already draw at, the softening from that
// upscale is close to invisible, while the pixel-fill cost of rasterizing drops roughly
// with the square of RENDER_SCALE. Sharp overlay lines (hover/pin/drawn highlights) are
// unaffected -- they are drawn separately, directly at full resolution.
const RENDER_SCALE = 0.6;

const WORKER_CHUNK_ROWS = 1500;
const WORKER_PROGRESS_INTERVAL_MS = 48;
const BACKGROUND_ALPHA = 0.27;
const BACKGROUND_LINE_WIDTH = 1.25;

// Outline color for hover/pinned-highlight lines -- matches the dark outline zoomablePlot.js
// (the scatterplot matrix) already draws around a highlighted point, so a point reads as
// "the same point" whether you're looking at the splom or the parallel coordinates plot.
const HIGHLIGHT_OUTLINE_WIDTH = 4;
const HIGHLIGHT_LINE_WIDTH = 2;

// A point becomes "added to the Content box" the moment it is click-selected on any plot
// (controller.getAllPinnedIds() -- the same set the Content box's "Manage Highlighted Points"
// list is built from). This is deliberately the same selection color zoomablePlot.js outlines
// a click-selected point with, so a design reads as "added to Content" consistently across
// both plots, independent of whether it is currently hovered or list-pinned on top of that.
const SELECTION_LINE_COLOR = SELECTION_COLOR;
const SELECTION_LINE_WIDTH = 2;

const supportsOffThreadRender =
  typeof Worker !== "undefined" &&
  typeof OffscreenCanvas !== "undefined" &&
  typeof createImageBitmap === "function";

export function createParallelCoordinates(data, controller = null, contentController = null) {
  const sortedData = [...data].sort((a, b) => {
    const orderDelta = (drawOrder[a.Label] ?? 99) - (drawOrder[b.Label] ?? 99);
    return orderDelta || String(a.Label ?? "").localeCompare(String(b.Label ?? ""));
  });
  const width = 1060;
  const height = 560;
  // Axis titles are rotated -32deg, so they rise up and to the right of their axis.
  // The top margin holds the tallest title ("Block Fuel (1000 lbm)") and the right
  // margin holds the last one, so neither is clipped by the frame; the bottom only
  // needs room for the lowest tick label.
  const margin = { top: 112, right: 112, bottom: 28, left: 44 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const color = d3.scaleOrdinal(colorDomain, colorRange);
  const x = d3.scalePoint(dimensions.map((dimension) => dimension.key), [0, innerWidth]);
  const scales = new Map(dimensions.map((dimension) => {
    const values = sortedData.map((row) => Number(row[dimension.key]));
    const extent = d3.extent(values);
    const range = extent[1] - extent[0] || 1;
    return [dimension.key, d3.scaleLinear()
      .domain([extent[0] - range * 0.03, extent[1] + range * 0.03])
      .range([innerHeight, 0])];
  }));

  const root = document.createElement("div");
  root.className = "parallel-container";

  const header = document.createElement("div");
  header.className = "parallel-header";
  const title = document.createElement("div");
  title.className = "parallel-title";
  title.textContent = "GTB777 Parallel Coordinates";
  const subtitle = document.createElement("div");
  subtitle.className = "parallel-subtitle";
  subtitle.textContent = "Each line represents one aircraft design; colors indicate feasibility level.";
  header.append(title, subtitle);

  const frame = document.createElement("div");
  frame.className = "parallel-frame";
  const canvas = document.createElement("canvas");
  canvas.className = "parallel-canvas";
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("aria-hidden", "true");
  const svg = d3.select(frame).append("svg")
    .attr("class", "parallel-svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Parallel coordinates plot for the GTB777 dataset");
  const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const axisLayer = chart.append("g").attr("class", "parallel-axes");
  const context = canvas.getContext("2d");
  const rowsById = new Map();
  const highlightedPathCache = new Map();
  const rowsByLabel = new Map(colorDomain.map((label) => [label, []]));
  const labelCanvasCache = new Map();
  const rasterCanvasCache = new Map();
  let visibleData = [];

  function getVisibleData() {
    return contentController ? contentController.getFilteredData(sortedData) : sortedData;
  }

  for (const row of sortedData) {
    const pointId = `point-${row.__rowId}`;
    rowsById.set(pointId, row);
    rowsByLabel.get(row.Label)?.push(row);
  }

  function getRowPoints(row) {
    return dimensions.map((dimension) => [
      margin.left + x(dimension.key),
      margin.top + scales.get(dimension.key)(Number(row[dimension.key]))
    ]);
  }

  function getRowPath(pointId, row) {
    let path = highlightedPathCache.get(pointId);
    if (!path) {
      path = new Path2D();
      getRowPoints(row).forEach(([pointX, pointY], index) => {
        if (index === 0) {
          path.moveTo(pointX, pointY);
        } else {
          path.lineTo(pointX, pointY);
        }
      });
      highlightedPathCache.set(pointId, path);
    }
    return path;
  }

  // Mirrors the splom's click-to-select pins (controller.getAllPinnedIds()) -- the same set
  // that populates the Content box's "Manage Highlighted Points" list. Drawn beneath the
  // hover/pinned-highlight layer so a point that is both selected and currently hovered still
  // reads clearly as "hovered" on top of its "in Content box" selection color.
  function drawContentBoxSelectionLines(visibleLabels) {
    const pinnedPointIds = controller?.getAllPinnedIds?.() ?? new Set();
    if (!pinnedPointIds.size) {
      return;
    }

    for (const pointId of pinnedPointIds) {
      const row = rowsById.get(pointId);
      if (!row || !visibleLabels.has(row.Label)) {
        continue;
      }
      const path = getRowPath(pointId, row);

      context.globalAlpha = 1;
      context.lineWidth = SELECTION_LINE_WIDTH;
      context.strokeStyle = SELECTION_LINE_COLOR;
      context.stroke(path);
    }
  }

  // Mirrors the splom's and the content box's shared hover/pinned-highlight state
  // (controller.getHighlightedPointIds(): the current hover plus anything pinned via the
  // Content panel's highlight list). Drawn on top of the cached background but below the
  // "Draw aircraft sketch" overlay, as a dark halo behind the row's own label color, so a
  // highlighted line visibly stands out from the density field without losing its color.
  function drawHoverAndPinHighlights(visibleLabels) {
    const highlightedPointIds = controller?.getHighlightedPointIds?.() ?? new Set();
    if (!highlightedPointIds.size) {
      return;
    }

    for (const pointId of highlightedPointIds) {
      const row = rowsById.get(pointId);
      if (!row || !visibleLabels.has(row.Label)) {
        continue;
      }
      const path = getRowPath(pointId, row);

      context.globalAlpha = 1;
      context.lineWidth = HIGHLIGHT_OUTLINE_WIDTH;
      // Fall back to a light grey outline when the row's own label color is already
      // dark/black (e.g. GTB777's "Level 2-1") so the outline stays visible against it.
      context.strokeStyle = getHighlightOutlineColor(color(row.Label), { dark: HIGHLIGHT_OUTLINE_COLOR });
      context.stroke(path);

      context.lineWidth = HIGHLIGHT_LINE_WIDTH;
      context.strokeStyle = color(row.Label);
      context.stroke(path);
    }
  }

  function drawHighlightedLines(visibleLabels) {
    const drawnPointIds = controller?.getDrawnPointIds?.() ?? new Set();
    for (const [pointId, drawIndex] of drawnPointIds.entries()) {
      const row = rowsById.get(pointId);
      if (!row || !visibleLabels.has(row.Label)) {
        continue;
      }
      const path = getRowPath(pointId, row);

      context.globalAlpha = 1;
      context.lineWidth = 3;
      context.strokeStyle = getGTB777SketchColor(
        controller?.getDrawnPointColorIndex?.(pointId) ?? drawIndex
      );
      context.stroke(path);
    }
  }

  function drawCachedBackground(visibleLabels) {
    if (controller?.getDrawnPointIds?.().size) {
      return;
    }

    context.globalAlpha = 1;
    for (const label of colorDomain) {
      const cachedCanvas = labelCanvasCache.get(label);
      if (visibleLabels.has(label) && cachedCanvas) {
        context.drawImage(cachedCanvas, 0, 0);
      }
    }
  }

  function render() {
    visibleData = getVisibleData();
    context.clearRect(0, 0, width, height);
    const visibleLabels = new Set(visibleData.map((row) => row.Label));
    drawCachedBackground(visibleLabels);
    drawContentBoxSelectionLines(visibleLabels);
    drawHoverAndPinHighlights(visibleLabels);
    drawHighlightedLines(visibleLabels);
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

  // --- Off-main-thread build (preferred path) ---------------------------------------
  //
  // A dedicated Worker (one per plot instance, from the generic lineDensityWorker
  // module) does all point-projection and rasterization work. The main thread only ever
  // receives a finished bitmap and blits it -- it never runs the heavy
  // per-row math itself. That keeps this plot's initial build from ever competing with
  // the scatterplot matrix's own rendering for main-thread time, no matter how slow the
  // build is on a given machine.

  const axisPositions = new Float32Array(dimensions.map((dimension) => margin.left + x(dimension.key)));
  const axisScales = new Float32Array(dimensions.length * 4);
  dimensions.forEach((dimension, index) => {
    const scale = scales.get(dimension.key);
    const [domainMin, domainMax] = scale.domain();
    const [rangeAtDomainMin, rangeAtDomainMax] = scale.range();
    axisScales[index * 4 + 0] = domainMin;
    axisScales[index * 4 + 1] = domainMax;
    axisScales[index * 4 + 2] = margin.top + rangeAtDomainMin;
    axisScales[index * 4 + 3] = margin.top + rangeAtDomainMax;
  });

  function buildRowsFloatArray(labelRows) {
    const flat = new Float32Array(labelRows.length * dimensions.length);
    labelRows.forEach((row, rowIndex) => {
      dimensions.forEach((dimension, dimIndex) => {
        flat[rowIndex * dimensions.length + dimIndex] = Number(row[dimension.key]);
      });
    });
    return flat;
  }

  let worker = null;
  let nextRequestId = 0;
  const requestIdByKey = new Map();
  const pendingBitmaps = new Map();
  let paintScheduled = false;

  function schedulePaint() {
    if (paintScheduled) {
      return;
    }
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
    worker = new Worker(new URL("./lineDensityWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const message = event.data;
      if (message?.type !== "progress") {
        return;
      }
      if (requestIdByKey.get(message.canvasKey) !== message.requestId) {
        message.bitmap.close();
        return;
      }
      const previous = pendingBitmaps.get(message.canvasKey);
      if (previous) {
        previous.close();
      }
      pendingBitmaps.set(message.canvasKey, message.bitmap);
      schedulePaint();
    };

    for (const label of colorDomain) {
      const labelRows = rowsByLabel.get(label) ?? [];
      if (!labelRows.length) {
        continue;
      }
      const requestId = ++nextRequestId;
      requestIdByKey.set(label, requestId);
      const rowsFloatArray = buildRowsFloatArray(labelRows);
      worker.postMessage({
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
        style: { color: color(label), alpha: BACKGROUND_ALPHA, lineWidth: BACKGROUND_LINE_WIDTH },
        chunkRows: WORKER_CHUNK_ROWS,
        progressIntervalMs: WORKER_PROGRESS_INTERVAL_MS
      }, [rowsFloatArray.buffer]);
    }
  }

  // --- Main-thread fallback (only when Worker/OffscreenCanvas is unavailable) --------
  //
  // Same chunked-over-requestAnimationFrame shape as before, still gets the resolution
  // scaling benefit, but does not get the thread isolation -- there is no way to
  // rasterize off-thread without OffscreenCanvas support.

  function buildBackgroundsOnMainThread(labelIndex = 0, rowIndex = 0) {
    if (labelIndex >= colorDomain.length) {
      render();
      return;
    }

    const label = colorDomain[labelIndex];
    const labelRows = rowsByLabel.get(label) ?? [];
    if (!labelRows.length) {
      window.requestAnimationFrame(() => buildBackgroundsOnMainThread(labelIndex + 1, 0));
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
        if (pointIndex === 0) {
          path.moveTo(scaledX, scaledY);
        } else {
          path.lineTo(scaledX, scaledY);
        }
      });
    }

    rasterContext.globalAlpha = BACKGROUND_ALPHA;
    rasterContext.lineWidth = Math.max(0.5, BACKGROUND_LINE_WIDTH * RENDER_SCALE);
    rasterContext.strokeStyle = color(label);
    rasterContext.lineJoin = "round";
    rasterContext.lineCap = "round";
    rasterContext.stroke(path);

    const cacheContext = cache.getContext("2d");
    cacheContext.clearRect(0, 0, width, height);
    cacheContext.drawImage(raster, 0, 0, width, height);
    render();

    if (endIndex < labelRows.length) {
      window.requestAnimationFrame(() => buildBackgroundsOnMainThread(labelIndex, endIndex));
    } else {
      window.requestAnimationFrame(() => buildBackgroundsOnMainThread(labelIndex + 1, 0));
    }
  }

  function getCanvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return [
      (event.clientX - bounds.left) * width / bounds.width,
      (event.clientY - bounds.top) * height / bounds.height
    ];
  }

  function distanceToSegment(pointX, pointY, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared
      ? Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared))
      : 0;
    const nearestX = startX + progress * deltaX;
    const nearestY = startY + progress * deltaY;
    return Math.hypot(pointX - nearestX, pointY - nearestY);
  }

  function getRowAtPointer(event) {
    const [pointerX, pointerY] = getCanvasPoint(event);
    let nearestRow = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const row of visibleData) {
      const rowPoints = getRowPoints(row);
      let previousPoint = null;
      for (const currentPoint of rowPoints) {
        if (previousPoint) {
          const distance = distanceToSegment(
            pointerX,
            pointerY,
            previousPoint[0],
            previousPoint[1],
            currentPoint[0],
            currentPoint[1]
          );
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestRow = row;
          }
        }
        previousPoint = currentPoint;
      }
    }

    return nearestDistance <= 7 ? nearestRow : null;
  }

  canvas.addEventListener("click", (event) => {
    if (!controller || (controller.getTool?.() !== "move" && controller.getTool?.() !== "select")) {
      return;
    }

    const row = getRowAtPointer(event);
    if (row) {
      controller.togglePin?.("plot-parallel-coordinates", `point-${row.__rowId}`, event.ctrlKey);
    } else if (!event.ctrlKey) {
      controller.clearPins?.("plot-parallel-coordinates");
    }
  });

  for (const dimension of dimensions) {
    const axis = axisLayer.append("g")
      .attr("class", "parallel-axis")
      .attr("transform", `translate(${x(dimension.key)},0)`)
      .call(d3.axisLeft(scales.get(dimension.key)).ticks(5));
    axis.append("text")
      .attr("class", "parallel-axis-label")
      .attr("text-anchor", "start")
      .attr("transform", "rotate(-32)")
      .attr("y", -14)
      .text(dimension.label);
  }

  render();
  if (supportsOffThreadRender) {
    buildBackgroundsOnWorker();
  } else {
    window.requestAnimationFrame(() => buildBackgroundsOnMainThread());
  }

  if (contentController) {
    contentController.subscribe((event) => {
      if (event.type === "labels") {
        render();
      } else if (event.type === "drawPoints") {
        render();
      }
    });
  }

  controller?.subscribe?.((event) => {
    if (
      event.type === "drawPoints" ||
      event.type === "highlightedPoint" ||
      event.type === "pinnedHighlight" ||
      event.type === "pins"
    ) {
      render();
    }
  });

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

  frame.prepend(canvas);
  root.append(header, frame, legend);
  return root;
}
