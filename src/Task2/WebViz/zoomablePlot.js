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

  const fill = colorDomain
    ? d3.scaleOrdinal().domain(colorDomain).range(colorRange)
    : () => "steelblue";

  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.overflow = "hidden";

  const svg = d3.create("svg")
    .attr("width", width)
    .attr("height", height)
    .style("overflow", "hidden")
    .style("display", "block");

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
  const pointsLayer = chart.append("g")
    .attr("clip-path", `url(#${clipId})`);
  const xAxisLayer = chart.append("g");
  const yAxisLayer = chart.append("g");

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

  function drawAxes() {
    const xScale = d3.scaleLinear().domain(currentXDomain).range([marginLeft, width - margin]);
    const yScale = d3.scaleLinear().domain(currentYDomain).range([height - marginBottom, margin]);

    const xAxis = d3.axisBottom(xScale).ticks(5).tickSize(-1 * (height - marginBottom - margin));
    const yAxis = d3.axisLeft(yScale).ticks(5).tickSize(-1 * (width - marginLeft - margin));

    xAxisLayer
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(xAxis)
      .call((g) => g.selectAll("line").attr("stroke", "#e6e6e6"))
      .call((g) => g.selectAll("path").attr("stroke", "#999"));

    yAxisLayer
      .attr("transform", `translate(${marginLeft},0)`)
      .call(yAxis)
      .call((g) => g.selectAll("line").attr("stroke", "#e6e6e6"))
      .call((g) => g.selectAll("path").attr("stroke", "#999"));
  }

  function drawPointsOnce() {
    pointsLayer.selectAll("*").remove();

    const xScale = d3.scaleLinear().domain(xDomain).range([marginLeft, width - margin]);
    const yScale = d3.scaleLinear().domain(yDomain).range([height - marginBottom, margin]);
    const pointData = [];

    for (const group of groupedPoints) {
      for (const row of group.rows) {
        pointData.push({
          color: group.color,
          label: row.Label ?? "",
          x: row[xKey],
          y: row[yKey]
        });
      }
    }

    const batchSize = 3000;
    let index = 0;

    function appendBatch() {
      const fragment = document.createDocumentFragment();
      const end = Math.min(index + batchSize, pointData.length);

      for (; index < end; index += 1) {
        const point = pointData[index];
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", String(xScale(point.x)));
        circle.setAttribute("cy", String(yScale(point.y)));
        circle.setAttribute("r", "2");
        circle.setAttribute("fill", point.color);
        circle.setAttribute("opacity", "0.75");

        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = `${point.label}\n${xKey}: ${point.x}\n${yKey}: ${point.y}`;
        circle.appendChild(title);
        fragment.appendChild(circle);
      }

      pointsLayer.node().appendChild(fragment);

      if (index < pointData.length) {
        requestAnimationFrame(appendBatch);
      }
    }

    requestAnimationFrame(appendBatch);
  }

  drawAxes();
  drawPointsOnce();

  const zoom = d3.zoom()
    .scaleExtent(scaleExtent)
    .translateExtent([[marginLeft, margin], [width - margin, height - marginBottom]])
    .extent([[marginLeft, margin], [width - margin, height - marginBottom]])
    .on("zoom", (event) => {
      currentTransform = event.transform;
      pointsLayer.attr("transform", currentTransform.toString());
    })
    .on("end", (event) => {
      currentTransform = event.transform;
      currentXDomain = currentTransform.rescaleX(x0).domain();
      currentYDomain = currentTransform.rescaleY(y0).domain();
      drawAxes();
      pointsLayer.attr("transform", currentTransform.toString());
    });

  svg.call(zoom);
  svg.node().__zoom = currentTransform;

  svg.on("dblclick.zoom", null);
  svg.on("dblclick", () => {
    currentTransform = d3.zoomIdentity;
    currentXDomain = xDomain;
    currentYDomain = yDomain;
    svg.node().__zoom = d3.zoomIdentity;
    drawAxes();
    pointsLayer.attr("transform", "none");
  });

  container.appendChild(svg.node());
  return container;
}
