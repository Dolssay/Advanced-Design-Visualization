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
  const rowsById = new Map();
  const highlightedPathCache = new Map();
  const rowsByLabel = new Map(colorDomain.map((label) => [label, []]));
  const labelCanvasCache = new Map();
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

  function drawHighlightedLines(visibleLabels) {
    const drawnPointIds = controller?.getDrawnPointIds?.() ?? new Set();
    for (const [pointId, drawIndex] of drawnPointIds.entries()) {
      const row = rowsById.get(pointId);
      if (!row || !visibleLabels.has(row.Label)) {
        continue;
      }
      const rowPoints = getRowPoints(row);
      let path = highlightedPathCache.get(pointId);
      if (!path) {
        path = new Path2D();
        rowPoints.forEach(([pointX, pointY], index) => {
          if (index === 0) {
            path.moveTo(pointX, pointY);
          } else {
            path.lineTo(pointX, pointY);
          }
        });
        highlightedPathCache.set(pointId, path);
      }

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
    drawHighlightedLines(visibleLabels);
  }

  function buildLabelCache(labelIndex = 0, rowIndex = 0) {
    if (labelIndex >= colorDomain.length) {
      render();
      return;
    }

    const label = colorDomain[labelIndex];
    let cache = labelCanvasCache.get(label);
    if (!cache) {
      cache = document.createElement("canvas");
      cache.width = width;
      cache.height = height;
      labelCanvasCache.set(label, cache);
    }

    const cacheContext = cache.getContext("2d");
    const labelRows = rowsByLabel.get(label) ?? [];
    const endIndex = Math.min(rowIndex + 350, labelRows.length);
    const path = new Path2D();
    for (let index = rowIndex; index < endIndex; index++) {
      getRowPoints(labelRows[index]).forEach(([pointX, pointY], pointIndex) => {
        if (pointIndex === 0) {
          path.moveTo(pointX, pointY);
        } else {
          path.lineTo(pointX, pointY);
        }
      });
    }

    cacheContext.globalAlpha = 0.27;
    cacheContext.lineWidth = 1.25;
    cacheContext.strokeStyle = color(label);
    cacheContext.stroke(path);
    render();

    if (endIndex < labelRows.length) {
      window.requestAnimationFrame(() => buildLabelCache(labelIndex, endIndex));
    } else {
      window.requestAnimationFrame(() => buildLabelCache(labelIndex + 1, 0));
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
  window.requestAnimationFrame(() => buildLabelCache());

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
    if (event.type === "drawPoints") {
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