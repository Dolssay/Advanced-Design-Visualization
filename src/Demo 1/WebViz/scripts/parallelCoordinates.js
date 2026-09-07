import { getGTB777SketchColor } from "./sketchGTB777.js";

const drawOrder = {
  "Infeasible": 0,
  "Level 2-2": 1,
  "Level 2-1": 2,
  "Level 1-1": 3
};

const colorDomain = ["Infeasible", "Level 2-2", "Level 2-1", "Level 1-1"];
const colorRange = ["#a5a5a5", "#d62728", "#111111", "#2f6fdd"];

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

function pointIdForRow(row) {
  return `point-${row.__rowId}`;
}

export function createParallelCoordinates(data, controller = null, contentController = null) {
  const sortedData = [...data].sort((a, b) => {
    const orderDelta = (drawOrder[a.Label] ?? 99) - (drawOrder[b.Label] ?? 99);
    return orderDelta || String(a.Label ?? "").localeCompare(String(b.Label ?? ""));
  });

  const width = 1180;
  const height = 570;
  const margin = { top: 54, right: 34, bottom: 92, left: 34 };
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

  const linePathsByLabel = new Map();
  const rowsByPointId = new Map();
  const pointsByPointId = new Map();
  let visibleData = [];
  let visiblePointIds = new Set();
  let visibleLabels = new Set();

  function getVisibleData() {
    return contentController ? contentController.getFilteredData(sortedData) : sortedData;
  }

  function refreshVisibleData() {
    visibleData = getVisibleData();
    visiblePointIds = new Set(visibleData.map(pointIdForRow));
    visibleLabels = new Set(visibleData.map((row) => row.Label));
  }

  // Build the dense background paths once. Also cache each row's screen-space
  // coordinates so selection/highlight rendering and hit testing do not have to
  // recompute all 11 scales on every interaction.
  for (const row of sortedData) {
    const pointId = pointIdForRow(row);
    rowsByPointId.set(pointId, row);

    const points = dimensions.map((dimension) => [
      margin.left + x(dimension.key),
      margin.top + scales.get(dimension.key)(Number(row[dimension.key]))
    ]);
    pointsByPointId.set(pointId, points);

    let path = linePathsByLabel.get(row.Label);
    if (!path) {
      path = new Path2D();
      linePathsByLabel.set(row.Label, path);
    }

    points.forEach(([pointX, pointY], index) => {
      if (index === 0) {
        path.moveTo(pointX, pointY);
      } else {
        path.lineTo(pointX, pointY);
      }
    });
  }

  function getSelectionState() {
    const pinnedIds = controller?.getAllPinnedIds?.() ?? new Set();
    const highlightedIds = controller?.getHighlightedPointIds?.() ?? new Set();
    const drawnIds = controller?.getDrawnPointIds?.() ?? new Set();
    const selectedIds = new Set([...pinnedIds, ...highlightedIds, ...drawnIds]);

    return {
      pinnedIds,
      highlightedIds,
      drawnIds,
      selectedIds
    };
  }

  function drawRow(pointId, strokeStyle, lineWidth, alpha = 1) {
    const points = pointsByPointId.get(pointId);
    if (!points || !visiblePointIds.has(pointId)) {
      return;
    }

    context.save();
    context.beginPath();
    points.forEach(([pointX, pointY], index) => {
      if (index === 0) {
        context.moveTo(pointX, pointY);
      } else {
        context.lineTo(pointX, pointY);
      }
    });
    context.globalAlpha = alpha;
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.stroke();
    context.restore();
  }

  function render() {
    const { pinnedIds, highlightedIds, drawnIds, selectedIds } = getSelectionState();
    const visibleSelectedIds = [...selectedIds].filter((pointId) => visiblePointIds.has(pointId));
    const hasSelection = visibleSelectedIds.length > 0;

    context.clearRect(0, 0, width, height);

    // Keep the full design-space context visible, but fade it whenever the user
    // has selected points in the scatterplot matrix so those same designs stand out.
    context.save();
    context.globalAlpha = hasSelection ? 0.08 : 0.27;
    context.lineWidth = hasSelection ? 0.9 : 1.25;
    for (const [label, path] of linePathsByLabel) {
      if (!visibleLabels.has(label)) {
        continue;
      }
      context.strokeStyle = color(label);
      context.stroke(path);
    }
    context.restore();

    // Pins made in any scatterplot are shown in green on the parallel plot.
    for (const pointId of pinnedIds) {
      drawRow(pointId, "#16a34a", 2.4, 0.95);
    }

    // Highlighted points retain their feasibility color with a dark outline,
    // matching the visual treatment used by the scatterplot matrix.
    for (const pointId of highlightedIds) {
      const row = rowsByPointId.get(pointId);
      if (!row || !visiblePointIds.has(pointId)) {
        continue;
      }
      drawRow(pointId, "#111827", 4.4, 1);
      drawRow(pointId, color(row.Label), 2.6, 1);
    }

    // "Draw" points use the same palette as the horizontal-tail sketch overlay.
    for (const pointId of drawnIds) {
      const drawColorIndex = controller?.getDrawnPointColorIndex?.(pointId) ?? 0;
      drawRow(pointId, "#ffffff", 5.2, 0.95);
      drawRow(pointId, getGTB777SketchColor(drawColorIndex), 3.2, 1);
    }

    if (hasSelection) {
      const drawnCount = [...drawnIds].filter((pointId) => visiblePointIds.has(pointId)).length;
      subtitle.textContent = `${visibleSelectedIds.length} selected design${visibleSelectedIds.length === 1 ? "" : "s"} highlighted${drawnCount ? `; ${drawnCount} drawn` : ""}.`;
    } else {
      subtitle.textContent = "Each line represents one aircraft design; colors indicate feasibility level.";
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

    // If points are already selected, test those first. This makes interaction
    // with highlighted designs much faster on the 40k+ row GTB777 dataset.
    const selectedIds = getSelectionState().selectedIds;
    const selectedRows = [...selectedIds]
      .filter((pointId) => visiblePointIds.has(pointId))
      .map((pointId) => rowsByPointId.get(pointId))
      .filter(Boolean);
    const rowsToSearch = selectedRows.length ? selectedRows : visibleData;

    for (const row of rowsToSearch) {
      const points = pointsByPointId.get(pointIdForRow(row));
      if (!points) {
        continue;
      }

      for (let index = 1; index < points.length; index++) {
        const previousPoint = points[index - 1];
        const currentPoint = points[index];
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
    }

    return nearestDistance <= 7 ? nearestRow : null;
  }

  canvas.addEventListener("click", (event) => {
    if (!controller || (controller.getTool?.() !== "move" && controller.getTool?.() !== "select")) {
      return;
    }

    const row = getRowAtPointer(event);
    if (row) {
      controller.togglePin?.("plot-parallel-coordinates", pointIdForRow(row), event.ctrlKey || event.metaKey);
    } else if (!event.ctrlKey && !event.metaKey) {
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

  refreshVisibleData();
  render();

  if (contentController) {
    contentController.subscribe((event) => {
      if (event.type === "labels") {
        refreshVisibleData();
        render();
      }
    });
  }

  controller?.subscribe?.((event) => {
    if (
      event.type === "pins" ||
      event.type === "highlightedPoint" ||
      event.type === "pinnedHighlight" ||
      event.type === "drawPoints"
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
