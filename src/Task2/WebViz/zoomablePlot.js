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
  let bakedTransform = d3.zoomIdentity;

  const fill = colorDomain
    ? d3.scaleOrdinal().domain(colorDomain).range(colorRange)
    : () => "steelblue";

  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.overflow = "hidden";

  function render() {
    const svg = d3.create("svg")
      .attr("width", width)
      .attr("height", height)
      .style("overflow", "hidden");

    const xScale = d3.scaleLinear().domain(currentXDomain).range([marginLeft, width - margin]);
    const yScale = d3.scaleLinear().domain(currentYDomain).range([height - marginBottom, margin]);

    const chart = svg.append("g");

    const xAxis = d3.axisBottom(xScale).ticks(5).tickSize(-1 * (height - marginBottom - margin));
    const yAxis = d3.axisLeft(yScale).ticks(5).tickSize(-1 * (width - marginLeft - margin));

    chart.append("g")
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(xAxis)
      .call(g => g.selectAll("line").attr("stroke", "#e6e6e6"))
      .call(g => g.selectAll("path").attr("stroke", "#999"));

    chart.append("g")
      .attr("transform", `translate(${marginLeft},0)`)
      .call(yAxis)
      .call(g => g.selectAll("line").attr("stroke", "#e6e6e6"))
      .call(g => g.selectAll("path").attr("stroke", "#999"));

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

    chart.append("g")
      .selectAll("circle")
      .data(data)
      .join("circle")
      .attr("cx", (d) => xScale(d[xKey]))
      .attr("cy", (d) => yScale(d[yKey]))
      .attr("r", 2)
      .attr("fill", (d) => fill(d.Label))
      .attr("opacity", 0.75)
      .append("title")
      .text((d) => `${d.Label ?? ""}\n${xKey}: ${d[xKey]}\n${yKey}: ${d[yKey]}`);

    container.replaceChildren(svg.node());
    bakedTransform = currentTransform;
    attachZoom();
  }

  function applyLivePreview(t) {
    const svgEl = container.querySelector("svg");
    if (!svgEl) return;
    const k = t.k / bakedTransform.k;
    const x = t.x - k * bakedTransform.x;
    const y = t.y - k * bakedTransform.y;
    svgEl.style.transformOrigin = "0 0";
    svgEl.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  }

  function attachZoom() {
    const svgEl = container.querySelector("svg");
    const svg = d3.select(svgEl);

    const zoom = d3.zoom()
      .scaleExtent(scaleExtent)
      .translateExtent([[marginLeft, margin], [width - margin, height - marginBottom]])
      .extent([[marginLeft, margin], [width - margin, height - marginBottom]])
      .on("zoom", (event) => {
        currentTransform = event.transform;
        applyLivePreview(currentTransform);
      })
      .on("end", (event) => {
        currentTransform = event.transform;
        const newX = currentTransform.rescaleX(x0);
        const newY = currentTransform.rescaleY(y0);
        currentXDomain = newX.domain();
        currentYDomain = newY.domain();
        render();
      });

    svg.call(zoom);
    svgEl.__zoom = currentTransform;

    svg.on("dblclick.zoom", null);
    svg.on("dblclick", () => {
      currentTransform = d3.zoomIdentity;
      currentXDomain = xDomain;
      currentYDomain = yDomain;
      svgEl.__zoom = d3.zoomIdentity;
      render();
    });
  }

  render();
  return container;
}
