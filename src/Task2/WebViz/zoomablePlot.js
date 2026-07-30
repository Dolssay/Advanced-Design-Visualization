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
  scaleExtent = [1, 20]
}) {
  const x0 = d3.scaleLinear().domain(xDomain).range([marginLeft, width - margin]);
  const y0 = d3.scaleLinear().domain(yDomain).range([height - marginBottom, margin]);

  let currentXDomain = xDomain;
  let currentYDomain = yDomain;
  let currentTransform = d3.zoomIdentity;
  let renderQueued = false;
  let currentQuadtree = null;

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

  const svg = d3.create("svg")
    .attr("width", width)
    .attr("height", height)
    .style("position", "absolute")
    .style("inset", "0")
    .style("overflow", "hidden")
    .style("display", "block");

  const tooltip = document.createElement("div");
  tooltip.style.position = "absolute";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  tooltip.style.background = "rgba(20, 20, 20, 0.92)";
  tooltip.style.color = "#fff";
  tooltip.style.padding = "6px 8px";
  tooltip.style.borderRadius = "4px";
  tooltip.style.fontSize = "12px";
  tooltip.style.lineHeight = "1.35";
  tooltip.style.whiteSpace = "pre-line";
  tooltip.style.zIndex = "3";
  tooltip.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.18)";

  const clipId = `clip-${Math.random().toString(36).slice(2)}`;
  svg.append("defs")
    .append("clipPath")
    .attr("id", clipId)
    .append("rect")
    .attr("x", marginLeft)
    .attr("y", margin)
    .attr("width", width - marginLeft - margin)
    .attr("height", height - margin - marginBottom);

  const chart = svg.append("g");
  const xAxisLayer = chart.append("g");
  const yAxisLayer = chart.append("g");
  const interactionLayer = chart.append("rect")
    .attr("x", marginLeft)
    .attr("y", margin)
    .attr("width", width - marginLeft - margin)
    .attr("height", height - margin - marginBottom)
    .attr("fill", "transparent")
    .style("cursor", "crosshair");

  if (xLabel) {
    svg.append("text")
      .attr("x", (marginLeft + width - margin) / 2)
      .attr("y", height - 8)
      .attr("text-anchor", "middle")
      .attr("fill", "#222")
      .style("font-size", "12px")
      .text(xLabel);
  }

  if (yLabel) {
    svg.append("text")
      .attr("transform", `translate(14, ${(height - marginBottom + margin) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("fill", "#222")
      .style("font-size", "12px")
      .text(yLabel);
  }

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
        color: group.color,
        label: row.Label ?? "",
        x: row[xKey],
        y: row[yKey],
        title: `${row.Label ?? ""}\n${xKey}: ${row[xKey]}\n${yKey}: ${row[yKey]}`
      });
    }
  }

  const canvasContext = canvas.getContext("2d");
  const plotLeft = marginLeft;
  const plotTop = margin;
  const plotRight = width - margin;
  const plotBottom = height - marginBottom;

  function getScales() {
    return {
      xScale: d3.scaleLinear().domain(currentXDomain).range([plotLeft, plotRight]),
      yScale: d3.scaleLinear().domain(currentYDomain).range([plotBottom, plotTop])
    };
  }

  function drawAxes() {
    const { xScale, yScale } = getScales();

    const xAxis = d3.axisBottom(xScale).ticks(5).tickSize(-1 * (plotBottom - plotTop));
    const yAxis = d3.axisLeft(yScale).ticks(5).tickSize(-1 * (plotRight - plotLeft));

    xAxisLayer
      .attr("transform", `translate(0,${plotBottom})`)
      .call(xAxis)
      .call((g) => g.selectAll("line").attr("stroke", "#e6e6e6"))
      .call((g) => g.selectAll("path").attr("stroke", "#999"));

    yAxisLayer
      .attr("transform", `translate(${plotLeft},0)`)
      .call(yAxis)
      .call((g) => g.selectAll("line").attr("stroke", "#e6e6e6"))
      .call((g) => g.selectAll("path").attr("stroke", "#999"));
  }

  function drawPoints() {
    const { xScale, yScale } = getScales();
    const renderedPoints = [];

    canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    canvasContext.clearRect(0, 0, width, height);
    canvasContext.globalAlpha = 0.75;

    for (const point of pointData) {
      const cx = xScale(point.x);
      const cy = yScale(point.y);

      if (cx < plotLeft - 4 || cx > plotRight + 4 || cy < plotTop - 4 || cy > plotBottom + 4) {
        continue;
      }

      canvasContext.fillStyle = point.color;
      canvasContext.fillRect(cx - 1, cy - 1, 2, 2);
      renderedPoints.push({ ...point, cx, cy });
    }

    currentQuadtree = d3.quadtree()
      .x((d) => d.cx)
      .y((d) => d.cy)
      .addAll(renderedPoints);
  }

  function render() {
    renderQueued = false;
    drawAxes();
    drawPoints();
  }

  function scheduleRender() {
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    requestAnimationFrame(render);
  }

  function showTooltip(point, mouseX, mouseY) {
    tooltip.textContent = point.title;
    tooltip.style.display = "block";

    const offset = 12;
    const left = Math.min(mouseX + offset, width - 8);
    const top = Math.min(mouseY + offset, height - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  function updateHover(event) {
    const [mouseX, mouseY] = d3.pointer(event, svg.node());
    if (mouseX < plotLeft || mouseX > plotRight || mouseY < plotTop || mouseY > plotBottom) {
      hideTooltip();
      return;
    }

    if (!currentQuadtree) {
      hideTooltip();
      return;
    }

    const hoveredPoint = currentQuadtree.find(mouseX, mouseY, 6);
    if (!hoveredPoint) {
      hideTooltip();
      return;
    }

    const dx = hoveredPoint.cx - mouseX;
    const dy = hoveredPoint.cy - mouseY;
    if ((dx * dx) + (dy * dy) > 36) {
      hideTooltip();
      return;
    }

    showTooltip(hoveredPoint, mouseX, mouseY);
  }

  interactionLayer
    .on("mousemove", updateHover)
    .on("mouseleave", hideTooltip);

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

  interactionLayer.call(zoom);
  interactionLayer.node().__zoom = currentTransform;

  interactionLayer.on("dblclick.zoom", null);
  interactionLayer.on("dblclick", (event) => {
    event.preventDefault();
    interactionLayer.call(zoom.transform, d3.zoomIdentity);
  });

  container.append(canvas, svg.node(), tooltip);
  render();
  return container;
}
