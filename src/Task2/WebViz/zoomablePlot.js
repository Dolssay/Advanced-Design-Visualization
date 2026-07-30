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
  let pinnedPointId = null;

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

  function createTooltip(backgroundColor) {
    const node = document.createElement("div");
    node.style.position = "absolute";
    node.style.pointerEvents = "none";
    node.style.display = "none";
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

  const pinnedTooltip = createTooltip("rgba(20, 20, 20, 0.95)");
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

    context.restore();

    currentQuadtree = d3.quadtree()
      .x((d) => d.cx)
      .y((d) => d.cy)
      .addAll(renderedPoints);
  }

  function render() {
    renderQueued = false;
    const { xScale, yScale } = getScales();
    canvasContext.clearRect(0, 0, width, height);
    drawAxes(canvasContext, xScale, yScale);
    drawPoints(canvasContext, xScale, yScale);
    if (pinnedPointId) {
      const pinnedPoint = currentRenderedPointsById.get(pinnedPointId);
      if (pinnedPoint) {
        showTooltip(pinnedTooltip, pinnedPoint, xScale(pinnedPoint.x), yScale(pinnedPoint.y));
      } else {
        hideTooltip(pinnedTooltip);
      }
    }
  }

  function scheduleRender() {
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    requestAnimationFrame(render);
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

  function showTooltip(node, point, mouseX, mouseY, avoidNode = null) {
    node.textContent = point.title;
    node.style.display = "block";
    node.style.visibility = "hidden";

    const offset = 12;
    const padding = 8;
    const tooltipWidth = node.offsetWidth;
    const tooltipHeight = node.offsetHeight;
    const avoidBox = avoidNode && avoidNode.style.display !== "none" ? getTooltipBox(avoidNode) : null;
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

      if (!avoidBox || !boxesOverlap(box, avoidBox)) {
        chosen = { left, top };
        break;
      }
    }

    node.style.left = `${chosen.left}px`;
    node.style.top = `${chosen.top}px`;
    node.style.visibility = "visible";
  }

  function hideTooltip(node) {
    node.style.display = "none";
    node.style.visibility = "hidden";
  }

  function updateHover(event) {
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

    if (hoveredPoint.id === pinnedPointId) {
      hideTooltip(hoverTooltip);
      return;
    }

    showTooltip(hoverTooltip, hoveredPoint, mouseX, mouseY, pinnedTooltip);
  }

  function handleClick(event) {
    const [mouseX, mouseY] = d3.pointer(event, canvas);
    const hoveredPoint = currentQuadtree?.find(mouseX, mouseY, 6) ?? null;
    if (!hoveredPoint) {
      pinnedPointId = null;
      hideTooltip(pinnedTooltip);
      hideTooltip(hoverTooltip);
      return;
    }

    const dx = hoveredPoint.cx - mouseX;
    const dy = hoveredPoint.cy - mouseY;
    if ((dx * dx) + (dy * dy) > 36) {
      pinnedPointId = null;
      hideTooltip(pinnedTooltip);
      hideTooltip(hoverTooltip);
      return;
    }

    pinnedPointId = hoveredPoint.id;
    hideTooltip(hoverTooltip);
    showTooltip(pinnedTooltip, hoveredPoint, hoveredPoint.cx, hoveredPoint.cy);
  }

  canvas.addEventListener("mousemove", updateHover);
  canvas.addEventListener("mouseleave", () => {
    hideTooltip(hoverTooltip);
  });
  canvas.addEventListener("click", handleClick);

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
    pinnedPointId = null;
    hideTooltip(pinnedTooltip);
    d3.select(canvas).call(zoom.transform, d3.zoomIdentity);
  });

  container.append(canvas, pinnedTooltip, hoverTooltip);
  render();
  return container;
}
