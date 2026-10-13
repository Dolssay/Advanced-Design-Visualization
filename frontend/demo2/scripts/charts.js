// Small D3 helpers shared by the sweep, tornado and ensemble charts.
// Colors are roles from stylings/charts.css (--series-1, --series-2, ...).

import d3 from "../../shared/d3-global.js";

export const MARGIN = { top: 16, right: 24, bottom: 48, left: 72 };

export function chartFrame(container, height) {
  container.replaceChildren();
  const width = Math.max(320, container.clientWidth || 720);
  const svg = d3.select(container).append("svg")
    .attr("class", "viz")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", height)
    .attr("role", "img");
  return { svg, width, height, inner: { w: width - MARGIN.left - MARGIN.right, h: height - MARGIN.top - MARGIN.bottom } };
}

export function axisLabel(svg, text, { x, y, rotate = false }) {
  svg.append("text")
    .attr("class", "axis-title")
    .attr("text-anchor", "middle")
    .attr("transform", rotate ? `translate(${x},${y}) rotate(-90)` : `translate(${x},${y})`)
    .text(text);
}

export function styleAxis(g) {
  g.attr("class", "axis");
  g.select(".domain").attr("class", "domain axis-line");
  g.selectAll(".tick line").attr("class", "tick-line");
  return g;
}

export function gridY(g, y, width) {
  g.attr("class", "grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(""))
    .call((s) => s.select(".domain").remove());
}

// One floating tooltip per chart container.
export function createTooltip(container) {
  container.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "viz-tooltip";
  tip.hidden = true;
  container.append(tip);
  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.hidden = false;
      const box = container.getBoundingClientRect();
      const tw = tip.offsetWidth;
      const left = x + 14 + tw > box.width ? x - tw - 14 : x + 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, y - 10)}px`;
    },
    hide() {
      tip.hidden = true;
    }
  };
}

export function onResize(container, redraw) {
  let last = container.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - last) > 4) {
      last = container.clientWidth;
      redraw();
    }
  });
  ro.observe(container);
  return () => ro.disconnect();
}
