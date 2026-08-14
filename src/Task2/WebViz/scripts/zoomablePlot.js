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
  scaleExtent = [1, 60],
  controller = null,
  plotId = null
}) {
  const x0 = d3.scaleLinear().domain(xDomain).range([marginLeft, width - margin]);
  const y0 = d3.scaleLinear().domain(yDomain).range([height - marginBottom, margin]);

  const plotLeft = marginLeft;
  const plotTop = margin;
  const plotRight = width - margin;
  const plotBottom = height - marginBottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const fill = colorDomain
    ? d3.scaleOrdinal().domain(colorDomain).range(colorRange)
    : () => "steelblue";

  const container = document.createElement("div");
  container.className = "zoomable-plot";
  container.style.setProperty("--plot-width", `${width}px`);
  container.style.setProperty("--plot-height", `${height}px`);

  const canvas = document.createElement("canvas");
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.className = "zoomable-plot-canvas";

  const selectionOverlay = controller?.createSelectionOverlay
    ? controller.createSelectionOverlay(container)
    : (() => {
        const overlay = document.createElement("div");
        overlay.className = "plot-selection-overlay is-hidden";
        container.appendChild(overlay);
        return overlay;
      })();

  const pinnedTooltipLayer = document.createElement("div");
  pinnedTooltipLayer.className = "plot-tooltip-layer";

  function createTooltip(variant) {
    const node = document.createElement("div");
    node.className = `plot-tooltip plot-tooltip-${variant} is-hidden`;
    return node;
  }

  const hoverTooltip = createTooltip("hover");
  const canvasContext = canvas.getContext("2d");
  const plotSelection = d3.select(canvas);

  let pointData = [];

  function rebuildPointData(nextData) {
    const groupedPoints = colorDomain
      ? colorDomain.map((label) => ({
          color: fill(label),
          rows: nextData.filter((d) => d.Label === label)
        }))
      : [{ color: "steelblue", rows: nextData }];

    const nextPointData = [];
    for (const group of groupedPoints) {
      for (const row of group.rows) {
        nextPointData.push({
          id: row.__rowId != null ? `point-${row.__rowId}` : `point-${nextPointData.length}`,
          color: group.color,
          label: row.Label ?? "",
          x: row[xKey],
          y: row[yKey],
          title: `${row.Label ?? ""}\n${xKey}: ${row[xKey]}\n${yKey}: ${row[yKey]}`
        });
      }
    }
    pointData = nextPointData;
  }

  let currentXDomain = [...xDomain];
  let currentYDomain = [...yDomain];
  let currentTransform = d3.zoomIdentity;
  let currentQuadtree = null;
  let currentRenderedPointsById = new Map();
  let renderQueued = false;
  let pinnedTooltipNodes = new Map();
  let altHeld = false;
  let isDragging = false;
  let dragState = null;

  function getTool() {
    return controller?.getTool?.() ?? "move";
  }

  function isTooltipVisible() {
    return !altHeld && (controller?.isTooltipEnabled?.() ?? true);
  }

  function areCursorTooltipsEnabled() {
    const targets = controller?.getTooltipTargets?.();
    return !altHeld && (targets ? targets.cursor : true);
  }

  function arePinnedTooltipsEnabled() {
    const targets = controller?.getTooltipTargets?.();
    return !altHeld && (targets ? targets.pinned : true);
  }

  function getPinnedIds() {
    return controller?.getPinnedIds?.(plotId) ?? new Set();
  }

  function setCursor() {
    const tool = getTool();
    if (tool === "move") {
      if (controller?.isMoveSelectEnabled?.()) {
        canvas.style.cursor = "default";
        return;
      }
      canvas.style.cursor = isDragging ? "grabbing" : "grab";
      return;
    }

    if (tool === "select") {
      canvas.style.cursor = "default";
      return;
    }

    if (tool === "zoom-in") {
      canvas.style.cursor = "zoom-in";
      return;
    }

    if (tool === "zoom-out") {
      canvas.style.cursor = "zoom-out";
      return;
    }

    if (tool === "lasso") {
      canvas.style.cursor = "crosshair";
      return;
    }

    canvas.style.cursor = "cell";
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
    const highlightedPointIds = controller?.getHighlightedPointIds?.() ?? new Set();
    const highlightedPoints = [];
    context.save();
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.globalAlpha = 0.78;

    for (const point of pointData) {
      const cx = xScale(point.x);
      const cy = yScale(point.y);

      if (cx < plotLeft - 4 || cx > plotRight + 4 || cy < plotTop - 4 || cy > plotBottom + 4) {
        continue;
      }

      const renderedPoint = { ...point, cx, cy };
      currentRenderedPointsById.set(point.id, renderedPoint);

      if (highlightedPointIds.has(point.id)) {
        highlightedPoints.push(renderedPoint);
        continue;
      }

      context.fillStyle = point.color;
      context.fillRect(cx - 1.5, cy - 1.5, 5.5, 5.5);
      renderedPoints.push(renderedPoint);
    }

    const pinnedIds = getPinnedIds();
    for (const pinnedPointId of pinnedIds) {
      const pinnedPoint = currentRenderedPointsById.get(pinnedPointId);
      if (!pinnedPoint) {
        continue;
      }

      context.save();
      context.strokeStyle = "#16a34a";
      context.lineWidth = 1.25;
      context.strokeRect(pinnedPoint.cx - 2.25, pinnedPoint.cy - 2.25, 4.5, 4.5);
      context.restore();
    }

    for (const highlightedPoint of highlightedPoints) {
      context.save();
      context.globalAlpha = 1;
      context.fillStyle = highlightedPoint.color;
      context.fillRect(highlightedPoint.cx - 3, highlightedPoint.cy - 3, 8, 8);
      context.strokeStyle = "#111827";
      context.lineWidth = 1.5;
      context.strokeRect(highlightedPoint.cx - 3, highlightedPoint.cy - 3, 8, 8);
      context.restore();
      renderedPoints.push(highlightedPoint);
    }

    context.restore();

    currentQuadtree = d3.quadtree()
      .x((d) => d.cx)
      .y((d) => d.cy)
      .addAll(renderedPoints);
  }

  function hideTooltip(node) {
    node.classList.add("is-hidden");
    node.classList.remove("is-measuring");
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
    node.classList.remove("is-hidden");
    node.classList.add("is-measuring");

    const offset = 12;
    const padding = 8;
    const tooltipWidth = node.offsetWidth;
    const tooltipHeight = node.offsetHeight;
    const avoidBoxes = avoidNodes
      .filter((avoidNode) => avoidNode && !avoidNode.classList.contains("is-hidden"))
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
    node.classList.remove("is-measuring");
  }

  function hideAllPinnedTooltips() {
    for (const node of pinnedTooltipNodes.values()) {
      hideTooltip(node);
    }
  }

  function clearPinnedTooltipNodes() {
    for (const node of pinnedTooltipNodes.values()) {
      node.remove();
    }
    pinnedTooltipNodes = new Map();
  }

  function syncCurrentDomains() {
    currentXDomain = currentTransform.rescaleX(x0).domain();
    currentYDomain = currentTransform.rescaleY(y0).domain();
  }

  function render() {
    renderQueued = false;
    const { xScale, yScale } = getScales();
    canvasContext.clearRect(0, 0, width, height);
    drawAxes(canvasContext, xScale, yScale);
    drawPoints(canvasContext, xScale, yScale);

    if (!isTooltipVisible()) {
      hideTooltip(hoverTooltip);
      hideAllPinnedTooltips();
      return;
    }

    if (!arePinnedTooltipsEnabled()) {
      hideAllPinnedTooltips();
      return;
    }

    const nextPinnedNodes = new Map();
    const placedNodes = [hoverTooltip];

    for (const pinnedPointId of getPinnedIds()) {
      const pinnedPoint = currentRenderedPointsById.get(pinnedPointId);
      if (!pinnedPoint) {
        continue;
      }

      let pinnedNode = pinnedTooltipNodes.get(pinnedPointId);
      if (!pinnedNode) {
        pinnedNode = createTooltip("pinned");
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
    if (!areCursorTooltipsEnabled() || dragState || isDragging) {
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

    if (getPinnedIds().has(hoveredPoint.id)) {
      hideTooltip(hoverTooltip);
      return;
    }

    positionTooltip(hoverTooltip, hoveredPoint, mouseX, mouseY, Array.from(pinnedTooltipNodes.values()));
  }

  function getPointAtPointer(event) {
    const [mouseX, mouseY] = d3.pointer(event, canvas);
    const hoveredPoint = currentQuadtree?.find(mouseX, mouseY, 6) ?? null;
    if (!hoveredPoint) {
      return { hoveredPoint: null, mouseX, mouseY };
    }

    const dx = hoveredPoint.cx - mouseX;
    const dy = hoveredPoint.cy - mouseY;
    if ((dx * dx) + (dy * dy) > 36) {
      return { hoveredPoint: null, mouseX, mouseY };
    }

    return { hoveredPoint, mouseX, mouseY };
  }

  function zoomToTransform(nextTransform) {
    plotSelection.call(zoom.transform, nextTransform);
  }

  function zoomAroundPoint(factor, mouseX, mouseY) {
    const nextK = Math.max(scaleExtent[0], Math.min(scaleExtent[1], currentTransform.k * factor));
    const baseX = currentTransform.invertX(mouseX);
    const baseY = currentTransform.invertY(mouseY);
    const nextX = mouseX - nextK * baseX;
    const nextY = mouseY - nextK * baseY;
    zoomToTransform(d3.zoomIdentity.scale(nextK).translate(nextX / nextK, nextY / nextK));
  }

  function zoomToSelection(rect) {
    const baseLeft = currentTransform.invertX(rect.left);
    const baseRight = currentTransform.invertX(rect.right);
    const baseTop = currentTransform.invertY(rect.top);
    const baseBottom = currentTransform.invertY(rect.bottom);
    const baseWidth = Math.abs(baseRight - baseLeft);
    const baseHeight = Math.abs(baseBottom - baseTop);

    if (baseWidth < 8 || baseHeight < 8) {
      return;
    }

    const k = Math.max(
      scaleExtent[0],
      Math.min(scaleExtent[1], Math.min(plotWidth / baseWidth, plotHeight / baseHeight))
    );
    const baseCenterX = (baseLeft + baseRight) / 2;
    const baseCenterY = (baseTop + baseBottom) / 2;
    const targetCenterX = (plotLeft + plotRight) / 2;
    const targetCenterY = (plotTop + plotBottom) / 2;
    const nextX = targetCenterX - k * baseCenterX;
    const nextY = targetCenterY - k * baseCenterY;
    zoomToTransform(d3.zoomIdentity.scale(k).translate(nextX / k, nextY / k));
  }

  function getSelectionRectFromDrag() {
    if (!dragState) {
      return null;
    }

    const left = Math.max(plotLeft, Math.min(dragState.startX, dragState.currentX));
    const right = Math.min(plotRight, Math.max(dragState.startX, dragState.currentX));
    const top = Math.max(plotTop, Math.min(dragState.startY, dragState.currentY));
    const bottom = Math.min(plotBottom, Math.max(dragState.startY, dragState.currentY));

    if (right <= left || bottom <= top) {
      return null;
    }

    return { left, top, right, bottom };
  }

  function showSelectionOverlay(rect) {
    selectionOverlay.classList.remove("is-hidden");
    selectionOverlay.style.left = `${rect.left}px`;
    selectionOverlay.style.top = `${rect.top}px`;
    selectionOverlay.style.width = `${rect.right - rect.left}px`;
    selectionOverlay.style.height = `${rect.bottom - rect.top}px`;
  }

  function hideSelectionOverlay() {
    selectionOverlay.classList.add("is-hidden");
  }

  function getPointsInRect(rect) {
    const ids = [];
    for (const point of currentRenderedPointsById.values()) {
      if (point.cx >= rect.left && point.cx <= rect.right && point.cy >= rect.top && point.cy <= rect.bottom) {
        ids.push(point.id);
      }
    }
    return ids;
  }

  function finishDrag() {
    const rect = getSelectionRectFromDrag();
    const tool = dragState?.tool;

    if (rect && tool === "brush") {
      const ids = getPointsInRect(rect);
      if (ids.length) {
        controller?.addPins?.(plotId, ids);
        scheduleRender();
      }
    }

    if (rect && tool === "lasso") {
      zoomToSelection(rect);
      if (controller?.isLinkingEnabled?.()) {
        const normalizedRect = {
          left: (rect.left - plotLeft) / plotWidth,
          right: (rect.right - plotLeft) / plotWidth,
          top: (rect.top - plotTop) / plotHeight,
          bottom: (rect.bottom - plotTop) / plotHeight
        };
        controller.emit?.({
          type: "linked-lasso",
          sourcePlotId: plotId,
          normalizedRect
        });
      }
    }

    dragState = null;
    hideSelectionOverlay();
    isDragging = false;
    setCursor();
    hideTooltip(hoverTooltip);
    scheduleRender();
  }

  function handlePointerDown(event) {
    if (altHeld || event.button !== 0) {
      return;
    }

    const tool = getTool();
    const [mouseX, mouseY] = d3.pointer(event, canvas);

    if (tool === "move") {
      isDragging = true;
      setCursor();
      return;
    }

    if (tool === "zoom-in") {
      event.preventDefault();
      zoomAroundPoint(1.35, mouseX, mouseY);
      return;
    }

    if (tool === "zoom-out") {
      event.preventDefault();
      zoomAroundPoint(1 / 1.35, mouseX, mouseY);
      return;
    }

    if (tool === "select") {
      return;
    }

    dragState = {
      tool,
      startX: Math.max(plotLeft, Math.min(mouseX, plotRight)),
      startY: Math.max(plotTop, Math.min(mouseY, plotBottom)),
      currentX: mouseX,
      currentY: mouseY
    };
    showSelectionOverlay({ left: dragState.startX, top: dragState.startY, right: dragState.startX, bottom: dragState.startY });
    hideTooltip(hoverTooltip);
  }

  function handlePointerMove(event) {
    if (dragState) {
      const [mouseX, mouseY] = d3.pointer(event, canvas);
      dragState.currentX = Math.max(plotLeft, Math.min(mouseX, plotRight));
      dragState.currentY = Math.max(plotTop, Math.min(mouseY, plotBottom));
      const rect = getSelectionRectFromDrag();
      if (rect) {
        showSelectionOverlay(rect);
      }
      hideTooltip(hoverTooltip);
      return;
    }

    updateHover(event);
  }

  function handlePointerUp() {
    if (dragState) {
      finishDrag();
    }
    if (isDragging) {
      isDragging = false;
      setCursor();
    }
  }

  function handleClick(event) {
    if (altHeld || dragState) {
      return;
    }

    const tool = getTool();
    const moveSelectEnabled = tool === "move" && (controller?.isMoveSelectEnabled?.() ?? false);
    if (tool !== "select" && tool !== "brush" && !moveSelectEnabled) {
      return;
    }

    const { hoveredPoint } = getPointAtPointer(event);
    if (!hoveredPoint) {
      if (!event.ctrlKey) {
        controller?.clearPins?.(plotId);
        scheduleRender();
      }
      return;
    }

    if (tool === "select" || moveSelectEnabled) {
      controller?.togglePin?.(plotId, hoveredPoint.id, event.ctrlKey);
      hideTooltip(hoverTooltip);
      scheduleRender();
    }
  }

  function handleDoubleClick(event) {
    event.preventDefault();
    currentTransform = d3.zoomIdentity;
    syncCurrentDomains();
    zoomToTransform(currentTransform);
  }

  canvas.addEventListener("mousemove", handlePointerMove);
  canvas.addEventListener("mouseleave", () => {
    hideTooltip(hoverTooltip);
  });
  canvas.addEventListener("mousedown", handlePointerDown);
  canvas.addEventListener("mouseup", handlePointerUp);
  canvas.addEventListener("click", handleClick);
  canvas.addEventListener("dblclick", handleDoubleClick);
  window.addEventListener("mouseup", handlePointerUp);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Alt" && !altHeld) {
      event.preventDefault();
      event.stopPropagation();
      altHeld = true;
      hideTooltip(hoverTooltip);
      hideAllPinnedTooltips();
      setCursor();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "Alt") {
      event.preventDefault();
      event.stopPropagation();
      altHeld = false;
      scheduleRender();
      setCursor();
    }
  });

  window.addEventListener("blur", () => {
    if (altHeld) {
      altHeld = false;
      scheduleRender();
      setCursor();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && altHeld) {
      altHeld = false;
      scheduleRender();
      setCursor();
    }
  });

  const zoom = d3.zoom()
    .scaleExtent(scaleExtent)
    .translateExtent([[plotLeft, plotTop], [plotRight, plotBottom]])
    .extent([[plotLeft, plotTop], [plotRight, plotBottom]])
    .filter((event) => {
      if (altHeld) {
        return false;
      }
      return getTool() === "move" && (event.type !== "mousedown" || event.button === 0);
    })
    .on("start", () => {
      isDragging = true;
      setCursor();
    })
    .on("zoom", (event) => {
      currentTransform = event.transform;
      syncCurrentDomains();
      scheduleRender();
    })
    .on("end", (event) => {
      currentTransform = event.transform;
      syncCurrentDomains();
      isDragging = false;
      setCursor();
      scheduleRender();
    });

  plotSelection.call(zoom);
  plotSelection.on("dblclick.zoom", null);

  if (controller?.subscribe) {
    controller.subscribe((event) => {
      if (event.type === "tool" || event.type === "moveSelect") {
        setCursor();
        hideTooltip(hoverTooltip);
      }

      if (event.type === "tooltipMode") {
        const cursorEnabled = event.cursor ?? controller?.getTooltipTargets?.().cursor ?? true;
        const pinnedEnabled = event.pinned ?? controller?.getTooltipTargets?.().pinned ?? true;
        if (!cursorEnabled) {
          hideTooltip(hoverTooltip);
        }
        if (!pinnedEnabled) {
          hideAllPinnedTooltips();
        }
        if (!cursorEnabled && !pinnedEnabled) {
          hideTooltip(hoverTooltip);
          hideAllPinnedTooltips();
        }
        scheduleRender();
      }

      if (event.type === "pins" && (!event.plotId || event.plotId === plotId || controller.isLinkingEnabled?.())) {
        scheduleRender();
      }

      if (event.type === "highlightedPoint" || event.type === "pinnedHighlight") {
        scheduleRender();
      }

      if (event.type === "linked-lasso" && controller.isLinkingEnabled?.() && event.sourcePlotId !== plotId) {
        const normalizedRect = event.normalizedRect;
        const left = plotLeft + normalizedRect.left * plotWidth;
        const right = plotLeft + normalizedRect.right * plotWidth;
        const top = plotTop + normalizedRect.top * plotHeight;
        const bottom = plotTop + normalizedRect.bottom * plotHeight;
        zoomToSelection({ left, right, top, bottom });
      }
    });
  }

  rebuildPointData(data);
  setCursor();
  container.append(canvas, selectionOverlay, pinnedTooltipLayer, hoverTooltip);
  render();
  container.setData = (nextData) => {
    rebuildPointData(nextData);
    hideTooltip(hoverTooltip);
    hideAllPinnedTooltips();
    scheduleRender();
  };
  return container;
}
