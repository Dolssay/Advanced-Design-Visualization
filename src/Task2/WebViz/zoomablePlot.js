export function zoomablePlot({
  data,
  xKey,
  yKey,
  xDomain,
  yDomain,
  width = 250,
  height = 250,
  margin = 30,
  marginLeft = 30,
  marginBottom = 30,
  xLabel = null,
  yLabel = null,
  colorDomain,
  colorRange,
  scaleExtent = [1, 60]
}) {
  const x0 = d3.scaleLinear().domain(xDomain).range([marginLeft, width - margin]);
  const y0 = d3.scaleLinear().domain(yDomain).range([height - marginBottom, margin]);

  let currentXDomain = xDomain;
  let currentYDomain = yDomain;
  let currentTransform = d3.zoomIdentity;
  let currentQuadtree = null;
  let currentRenderedPointsById = new Map();
  let renderQueued = false;
  let pinnedPointIds = [];
  let pinnedTooltipNodes = new Map();
  let altHeld = false;

  const fill = colorDomain
    ? d3.scaleOrdinal().domain(colorDomain).range(colorRange)
    : () => "steelblue";

  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.overflow = "hidden";

  const canvas = document.createElement("canvas");
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.display = "block";
  canvas.style.cursor = "crosshair";

  const pinnedTooltipLayer = document.createElement("div");
  pinnedTooltipLayer.style.position = "absolute";
  pinnedTooltipLayer.style.inset = "0";
  pinnedTooltipLayer.style.pointerEvents = "none";

  function createTooltip(backgroundColor) {
    const node = document.createElement("div");
    node.style.position = "absolute";
    node.style.pointerEvents = "none";
    node.style.display = "none";
    node.style.visibility = "hidden";
    node.style.background = backgroundColor;
    node.style.color = "#fff";
    node.style.padding = "6px 8px";
    node.style.borderRadius = "4px";
    node.style.fontSize = "12px";
    node.style.lineHeight = "1.35";
    node.style.whiteSpace = "pre-line";
    node.style.zIndex = "3";
    node.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.18)";
    return node;
  }

  const hoverTooltip = createTooltip("rgba(36, 36, 36, 0.92)");

  const canvasContext = canvas.getContext("2d");
  const plotLeft = marginLeft;
  const plotTop = margin;
  const plotRight = width - margin;
  const plotBottom = height - marginBottom;

  const groupedPoints = colorDomain
    ? colorDomain.map((label) => ({
        color: fill(label),
        rows: data.filter((d) => d.Label === label)
      }))
    : [{ color: "steelblue", rows: data }];

  const pointData = [];
  for (const group of groupedPoints) {
    for (const row of group.rows) {
      pointData.push({
        id: `point-${pointData.length}`,
        color: group.color,
        label: row.Label ?? "",
        x: row[xKey],
        y: row[yKey],
        title: `${row.Label ?? ""}\n${xKey}: ${row[xKey]}\n${yKey}: ${row[yKey]}`
      });
    }
  }

  function getScales() {
    return {
      xScale: d3.scaleLinear().domain(currentXDomain).range([plotLeft, plotRight]),
      yScale: d3.scaleLinear().domain(currentYDomain).range([plotBottom, plotTop])
    };
  }

  function drawAxes(context, xScale, yScale) {
    const xTicks = xScale.ticks(5);
    const yTicks = yScale.ticks(5);

    context.save();
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.strokeStyle = "#e6e6e6";
    context.fillStyle = "#222";
    context.lineWidth = 1;
    context.font = "12px Arial, sans-serif";

    context.beginPath();
    for (const tick of xTicks) {
      const x = xScale(tick);
      context.moveTo(x, plotTop);
      context.lineTo(x, plotBottom);
    }
    for (const tick of yTicks) {
      const y = yScale(tick);
      context.moveTo(plotLeft, y);
      context.lineTo(plotRight, y);
    }
    context.stroke();

    context.strokeStyle = "#999";
    context.beginPath();
    context.moveTo(plotLeft, plotBottom);
    context.lineTo(plotRight, plotBottom);
    context.moveTo(plotLeft, plotTop);
    context.lineTo(plotLeft, plotBottom);
    context.stroke();

    context.textAlign = "center";
    context.textBaseline = "top";
    for (const tick of xTicks) {
      context.fillText(String(tick), xScale(tick), plotBottom + 6);
    }

    context.textAlign = "right";
    context.textBaseline = "middle";
    for (const tick of yTicks) {
      context.fillText(String(tick), plotLeft - 6, yScale(tick));
    }

    if (xLabel) {
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(xLabel, (plotLeft + plotRight) / 2, height - 16);
    }

    if (yLabel) {
      context.save();
      context.translate(14, (plotTop + plotBottom) / 2);
      context.rotate(-Math.PI / 2);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(yLabel, 0, 0);
      context.restore();
    }

    context.restore();
  }

  function drawPoints(context, xScale, yScale) {
    const renderedPoints = [];
    currentRenderedPointsById = new Map();
    context.save();
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.globalAlpha = 0.75;

    for (const point of pointData) {
      const cx = xScale(point.x);
      const cy = yScale(point.y);

      if (cx < plotLeft - 4 || cx > plotRight + 4 || cy < plotTop - 4 || cy > plotBottom + 4) {
        continue;
      }

      context.fillStyle = point.color;
      context.fillRect(cx - 1.5, cy - 1.5, 4.5, 4.5);
      const renderedPoint = { ...point, cx, cy };
      renderedPoints.push(renderedPoint);
      currentRenderedPointsById.set(point.id, renderedPoint);
    }

    for (const pinnedPointId of pinnedPointIds) {
      const pinnedPoint = currentRenderedPointsById.get(pinnedPointId);
      if (!pinnedPoint) {
        continue;
      }

      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.strokeRect(pinnedPoint.cx - 3, pinnedPoint.cy - 3, 7, 7);
      context.strokeStyle = "#2ecc71";
      context.lineWidth = 3;
      context.strokeRect(pinnedPoint.cx - 3, pinnedPoint.cy - 3, 7, 7);
    }

    context.restore();

    currentQuadtree = d3.quadtree()
      .x((d) => d.cx)
      .y((d) => d.cy)
      .addAll(renderedPoints);
  }

  function hideTooltip(node) {
    node.style.display = "none";
    node.style.visibility = "hidden";
  }

  function getTooltipBox(node) {
    const left = Number.parseFloat(node.style.left) || 0;
    const top = Number.parseFloat(node.style.top) || 0;
    return {
      left,
      top,
      right: left + node.offsetWidth,
      bottom: top + node.offsetHeight
    };
  }

  function boxesOverlap(a, b) {
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }

  function positionTooltip(node, point, mouseX, mouseY, avoidNodes = []) {
    node.textContent = point.title;
    node.style.display = "block";
    node.style.visibility = "hidden";

    const offset = 12;
    const padding = 8;
    const tooltipWidth = node.offsetWidth;
    const tooltipHeight = node.offsetHeight;
    const avoidBoxes = avoidNodes
      .filter((avoidNode) => avoidNode && avoidNode.style.display !== "none")
      .map(getTooltipBox);
    const candidates = [
      { left: mouseX + offset, top: mouseY + offset },
      { left: mouseX - tooltipWidth - offset, top: mouseY + offset },
      { left: mouseX + offset, top: mouseY - tooltipHeight - offset },
      { left: mouseX - tooltipWidth - offset, top: mouseY - tooltipHeight - offset }
    ];

    let chosen = candidates[0];
    for (const candidate of candidates) {
      const left = Math.max(padding, Math.min(candidate.left, width - tooltipWidth - padding));
      const top = Math.max(padding, Math.min(candidate.top, height - tooltipHeight - padding));
      const box = {
        left,
        top,
        right: left + tooltipWidth,
        bottom: top + tooltipHeight
      };

      if (!avoidBoxes.some((avoidBox) => boxesOverlap(box, avoidBox))) {
        chosen = { left, top };
        break;
      }
    }

    node.style.left = `${chosen.left}px`;
    node.style.top = `${chosen.top}px`;
    node.style.visibility = "visible";
  }

  function hideAllPinnedTooltips() {
    for (const node of pinnedTooltipNodes.values()) {
      hideTooltip(node);
    }
  }

  function render() {
    renderQueued = false;
    const { xScale, yScale } = getScales();
    canvasContext.clearRect(0, 0, width, height);
    drawAxes(canvasContext, xScale, yScale);
    drawPoints(canvasContext, xScale, yScale);

    if (altHeld) {
      hideTooltip(hoverTooltip);
      hideAllPinnedTooltips();
      return;
    }

    const nextPinnedNodes = new Map();
    const placedNodes = [hoverTooltip];

    for (const pinnedPointId of pinnedPointIds) {
      const pinnedPoint = currentRenderedPointsById.get(pinnedPointId);
      if (!pinnedPoint) {
        continue;
      }

      let pinnedNode = pinnedTooltipNodes.get(pinnedPointId);
      if (!pinnedNode) {
        pinnedNode = createTooltip("rgba(20, 20, 20, 0.95)");
        pinnedTooltipLayer.appendChild(pinnedNode);
      }

      nextPinnedNodes.set(pinnedPointId, pinnedNode);
      positionTooltip(pinnedNode, pinnedPoint, xScale(pinnedPoint.x), yScale(pinnedPoint.y), placedNodes);
      placedNodes.push(pinnedNode);
    }

    for (const [pinnedPointId, node] of pinnedTooltipNodes.entries()) {
      if (!nextPinnedNodes.has(pinnedPointId)) {
        node.remove();
      }
    }

    pinnedTooltipNodes = nextPinnedNodes;
  }

  function scheduleRender() {
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    requestAnimationFrame(render);
  }

  function updateHover(event) {
    if (altHeld) {
      hideTooltip(hoverTooltip);
      return;
    }

    const [mouseX, mouseY] = d3.pointer(event, canvas);
    if (mouseX < plotLeft || mouseX > plotRight || mouseY < plotTop || mouseY > plotBottom) {
      hideTooltip(hoverTooltip);
      return;
    }

    if (!currentQuadtree) {
      hideTooltip(hoverTooltip);
      return;
    }

    const hoveredPoint = currentQuadtree.find(mouseX, mouseY, 6);
    if (!hoveredPoint) {
      hideTooltip(hoverTooltip);
      return;
    }

    const dx = hoveredPoint.cx - mouseX;
    const dy = hoveredPoint.cy - mouseY;
    if ((dx * dx) + (dy * dy) > 36) {
      hideTooltip(hoverTooltip);
      return;
    }

    if (pinnedPointIds.includes(hoveredPoint.id)) {
      hideTooltip(hoverTooltip);
      return;
    }

    positionTooltip(hoverTooltip, hoveredPoint, mouseX, mouseY, Array.from(pinnedTooltipNodes.values()));
  }

  function clearPins() {
    pinnedPointIds = [];
    for (const node of pinnedTooltipNodes.values()) {
      node.remove();
    }
    pinnedTooltipNodes = new Map();
    hideTooltip(hoverTooltip);
  }

  function handleClick(event) {
    if (altHeld) {
      return;
    }

    const [mouseX, mouseY] = d3.pointer(event, canvas);
    const hoveredPoint = currentQuadtree?.find(mouseX, mouseY, 6) ?? null;
    if (!hoveredPoint) {
      if (!event.ctrlKey) {
        clearPins();
      }
      return;
    }

    const dx = hoveredPoint.cx - mouseX;
    const dy = hoveredPoint.cy - mouseY;
    if ((dx * dx) + (dy * dy) > 36) {
      if (!event.ctrlKey) {
        clearPins();
      }
      return;
    }

    if (event.ctrlKey) {
      if (pinnedPointIds.includes(hoveredPoint.id)) {
        pinnedPointIds = pinnedPointIds.filter((id) => id !== hoveredPoint.id);
        const node = pinnedTooltipNodes.get(hoveredPoint.id);
        if (node) {
          node.remove();
          pinnedTooltipNodes.delete(hoveredPoint.id);
        }
      } else {
        pinnedPointIds = [...pinnedPointIds, hoveredPoint.id];
      }
    } else {
      clearPins();
      pinnedPointIds = [hoveredPoint.id];
    }

    hideTooltip(hoverTooltip);
    scheduleRender();
  }

  canvas.addEventListener("mousemove", updateHover);
  canvas.addEventListener("mouseleave", () => {
    hideTooltip(hoverTooltip);
  });
  canvas.addEventListener("click", handleClick);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Alt" && !altHeld) {
      event.preventDefault();
      event.stopPropagation();
      altHeld = true;
      hideTooltip(hoverTooltip);
      hideAllPinnedTooltips();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "Alt") {
      event.preventDefault();
      event.stopPropagation();
      altHeld = false;
      scheduleRender();
    }
  });

  window.addEventListener("blur", () => {
    if (altHeld) {
      altHeld = false;
      scheduleRender();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && altHeld) {
      altHeld = false;
      scheduleRender();
    }
  });

  const zoom = d3.zoom()
    .scaleExtent(scaleExtent)
    .translateExtent([[plotLeft, plotTop], [plotRight, plotBottom]])
    .extent([[plotLeft, plotTop], [plotRight, plotBottom]])
    .on("zoom", (event) => {
      currentTransform = event.transform;
      currentXDomain = currentTransform.rescaleX(x0).domain();
      currentYDomain = currentTransform.rescaleY(y0).domain();
      scheduleRender();
    })
    .on("end", (event) => {
      currentTransform = event.transform;
      currentXDomain = currentTransform.rescaleX(x0).domain();
      currentYDomain = currentTransform.rescaleY(y0).domain();
      scheduleRender();
    });

  d3.select(canvas).call(zoom);
  canvas.__zoom = currentTransform;

  d3.select(canvas).on("dblclick.zoom", null);
  canvas.addEventListener("dblclick", (event) => {
    event.preventDefault();
    clearPins();
    d3.select(canvas).call(zoom.transform, d3.zoomIdentity);
  });

  container.append(canvas, pinnedTooltipLayer, hoverTooltip);
  render();
  return container;
}
