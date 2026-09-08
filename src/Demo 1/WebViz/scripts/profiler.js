const SVG_NS = "http://www.w3.org/2000/svg";

let profilerInstanceCount = 0;

export const PROFILER_LAYOUT = {
  readoutWidth: 92,
  yAxisWidth: 38,
  cellWidth: 126,
  cellHeight: 140,
  axisBandHeight: 44,
  topPad: 6,
  cellPadTop: 10,
  cellPadRight: 8,
  cellPadBottom: 14,
  cellPadLeft: 8,
  samplesPerCurve: 65,
  yTickCount: 4,
  domainPadRatio: 0.02,
  maxDomainGrowth: 1.5
};

function svgNode(parent, name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  parent.appendChild(node);
  return node;
}

function normalizeSpec(spec) {
  const entry = typeof spec === "string" ? { key: spec } : spec;
  return {
    key: entry.key,
    label: entry.label ?? entry.key,
    unit: entry.unit ?? "",
    domain: entry.domain ?? null,
    format: entry.format ?? null
  };
}

function padDomain([min, max], ratio) {
  const span = max - min;
  if (!(span > 0)) {
    const fallback = Math.abs(min) * ratio || 1;
    return [min - fallback, max + fallback];
  }
  return [min - span * ratio, max + span * ratio];
}

function resolveFormat(spec, domain) {
  if (spec.format) {
    return d3.format(spec.format);
  }
  return d3.tickFormat(domain[0], domain[1], 100);
}

export function createProfiler({
  factors,
  responses,
  model,
  title = "Prediction Profiler",
  subtitle = null,
  layout: layoutOverrides = null
} = {}) {
  if (!model?.predict) {
    throw new Error("profiler: a model with predict() is required.");
  }

  const layout = { ...PROFILER_LAYOUT, ...layoutOverrides };

  const plotLeft = layout.cellPadLeft;
  const plotRight = layout.cellWidth - layout.cellPadRight;
  const plotTop = layout.cellPadTop;
  const plotBottom = layout.cellHeight - layout.cellPadBottom;

  const factorSpecs = factors.map((spec) => {
    const entry = normalizeSpec(spec);
    const stats = model.getFactorStats?.(entry.key) ?? null;
    const domain = entry.domain ?? (stats ? [stats.min, stats.max] : null);
    if (!domain) {
      throw new Error(`profiler: no domain available for factor "${entry.key}".`);
    }
    return {
      ...entry,
      domain,
      start: stats?.mean ?? (domain[0] + domain[1]) / 2,
      scale: d3.scaleLinear().domain(domain).range([plotLeft, plotRight]),
      format: resolveFormat(entry, domain)
    };
  });

  const responseSpecs = responses.map((spec) => {
    const entry = normalizeSpec(spec);
    const stats = model.getResponseStats?.(entry.key) ?? null;
    const observed = entry.domain ?? (stats ? [stats.min, stats.max] : null);
    if (!observed) {
      throw new Error(`profiler: no domain available for response "${entry.key}".`);
    }
    const initialDomain = padDomain(observed, layout.domainPadRatio);
    return {
      ...entry,
      initialDomain,
      domain: [...initialDomain],
      scale: d3.scaleLinear().domain(initialDomain).range([plotBottom, plotTop]),
      format: resolveFormat(entry, initialDomain)
    };
  });

  const gridLeft = layout.readoutWidth + layout.yAxisWidth;
  const gridTop = layout.topPad;
  const totalWidth = gridLeft + factorSpecs.length * layout.cellWidth;
  const totalHeight = gridTop + responseSpecs.length * layout.cellHeight + layout.axisBandHeight;

  const crosshair = {};
  for (const factor of factorSpecs) {
    crosshair[factor.key] = factor.start;
  }

  const scratch = { ...crosshair };
  const columnSamples = factorSpecs.map((factor) => {
    const samples = new Float64Array(layout.samplesPerCurve);
    const [min, max] = factor.domain;
    const step = (max - min) / (layout.samplesPerCurve - 1);
    for (let s = 0; s < layout.samplesPerCurve; s++) {
      samples[s] = min + step * s;
    }
    return samples;
  });

  const curves = responseSpecs.map(() =>
    factorSpecs.map(() => new Float64Array(layout.samplesPerCurve))
  );

  function computeCurves() {
    for (const factor of factorSpecs) {
      scratch[factor.key] = crosshair[factor.key];
    }

    for (let r = 0; r < responseSpecs.length; r++) {
      const responseKey = responseSpecs[r].key;
      for (let c = 0; c < factorSpecs.length; c++) {
        const factorKey = factorSpecs[c].key;
        const samples = columnSamples[c];
        const target = curves[r][c];
        for (let s = 0; s < samples.length; s++) {
          scratch[factorKey] = samples[s];
          target[s] = model.predict(responseKey, scratch);
        }
        scratch[factorKey] = crosshair[factorKey];
      }
    }
  }

  function expandDomains() {
    for (let r = 0; r < responseSpecs.length; r++) {
      const response = responseSpecs[r];
      let min = response.domain[0];
      let max = response.domain[1];

      for (const curve of curves[r]) {
        for (const value of curve) {
          if (!Number.isFinite(value)) continue;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }

      const initialSpan = response.initialDomain[1] - response.initialDomain[0];
      const maxSpan = initialSpan * layout.maxDomainGrowth;
      const center = (response.initialDomain[0] + response.initialDomain[1]) / 2;

      if (max - min > maxSpan) {
        min = Math.max(min, center - maxSpan / 2);
        max = Math.min(max, center + maxSpan / 2);
      }

      if (min !== response.domain[0] || max !== response.domain[1]) {
        response.domain = [min, max];
        response.scale.domain(response.domain);
      }
    }
  }

  function resetDomains() {
    for (const response of responseSpecs) {
      response.domain = [...response.initialDomain];
      response.scale.domain(response.domain);
    }
  }

  function resetCrosshairValues() {
    for (const factor of factorSpecs) {
      crosshair[factor.key] = factor.start;
    }
  }

  function resetAll() {
    resetCrosshairValues();
    resetDomains();
    scheduleRender();
  }

  const container = document.createElement("div");
  container.className = "profiler-container";

  const header = document.createElement("div");
  header.className = "profiler-header";
  const titleNode = document.createElement("div");
  titleNode.className = "profiler-title";
  titleNode.textContent = title;
  header.appendChild(titleNode);
  if (subtitle) {
    const subtitleNode = document.createElement("div");
    subtitleNode.className = "profiler-subtitle";
    subtitleNode.textContent = subtitle;
    header.appendChild(subtitleNode);
  }

  const controls = document.createElement("div");
  controls.className = "profiler-controls";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "profiler-button";
  resetButton.textContent = "Reset";
  resetButton.title = "Return every factor to its mean and restore the response axes (same as double-click)";
  resetButton.addEventListener("click", () => resetAll());

  controls.appendChild(resetButton);
  header.appendChild(controls);

  const scroll = document.createElement("div");
  scroll.className = "profiler-scroll";

  const svg = svgNode(scroll, "svg", {
    class: "profiler-svg",
    viewBox: `0 0 ${totalWidth} ${totalHeight}`,
    width: totalWidth,
    height: totalHeight,
    role: "img",
    "aria-label": `${title}: ${responseSpecs.length} responses by ${factorSpecs.length} factors`
  });

  const clipId = `profiler-clip-${++profilerInstanceCount}`;
  const defs = svgNode(svg, "defs");
  svgNode(svgNode(defs, "clipPath", { id: clipId }), "rect", {
    x: plotLeft,
    y: plotTop,
    width: plotRight - plotLeft,
    height: plotBottom - plotTop
  });

  const readoutLayer = svgNode(svg, "g", { class: "profiler-readouts" });
  const yAxisLayer = svgNode(svg, "g", { class: "profiler-yaxis" });
  const cellLayer = svgNode(svg, "g", { class: "profiler-cells" });
  const xAxisLayer = svgNode(svg, "g", { class: "profiler-xaxis" });

  const readouts = responseSpecs.map((response, r) => {
    const group = svgNode(readoutLayer, "g", {
      transform: `translate(0 ${gridTop + r * layout.cellHeight})`
    });
    const anchorX = layout.readoutWidth - 8;

    const labelNode = svgNode(group, "text", {
      class: "profiler-readout-label",
      x: anchorX,
      y: 34,
      "text-anchor": "end"
    });
    labelNode.textContent = response.label;

    if (response.unit) {
      const unitNode = svgNode(group, "text", {
        class: "profiler-readout-unit",
        x: anchorX,
        y: 48,
        "text-anchor": "end"
      });
      unitNode.textContent = response.unit;
    }

    const valueNode = svgNode(group, "text", {
      class: "profiler-readout-value",
      x: anchorX,
      y: 72,
      "text-anchor": "end"
    });

    const r2 = model.getR2?.(response.key);
    if (Number.isFinite(r2)) {
      const r2Node = svgNode(group, "text", {
        class: "profiler-readout-r2",
        x: anchorX,
        y: 88,
        "text-anchor": "end"
      });
      r2Node.textContent = `R² ${r2.toFixed(4)}`;
    }

    return { valueNode };
  });

  const yAxes = responseSpecs.map((_, r) =>
    svgNode(yAxisLayer, "g", {
      transform: `translate(0 ${gridTop + r * layout.cellHeight})`
    })
  );

  const cells = [];
  for (let r = 0; r < responseSpecs.length; r++) {
    for (let c = 0; c < factorSpecs.length; c++) {
      const group = svgNode(cellLayer, "g", {
        class: "profiler-cell",
        transform: `translate(${gridLeft + c * layout.cellWidth} ${gridTop + r * layout.cellHeight})`
      });

      const gridlines = svgNode(group, "g", { class: "profiler-gridlines" });

      svgNode(group, "path", {
        class: "profiler-axis",
        d: `M ${plotLeft} ${plotTop} L ${plotLeft} ${plotBottom} L ${plotRight} ${plotBottom}`
      });

      const crosshairV = svgNode(group, "line", {
        class: "profiler-crosshair-v",
        y1: plotTop,
        y2: plotBottom
      });

      const clipped = svgNode(group, "g", { "clip-path": `url(#${clipId})` });

      const crosshairH = svgNode(clipped, "line", {
        class: "profiler-crosshair-h",
        x1: plotLeft,
        x2: plotRight
      });

      const curvePath = svgNode(clipped, "path", { class: "profiler-curve", d: "" });
      const marker = svgNode(clipped, "circle", { class: "profiler-marker", r: 2.75 });

      const hit = svgNode(group, "rect", {
        class: "profiler-hit",
        x: plotLeft,
        y: plotTop,
        width: plotRight - plotLeft,
        height: plotBottom - plotTop
      });

      cells.push({ rowIndex: r, colIndex: c, gridlines, crosshairV, crosshairH, curvePath, marker, hit });
    }
  }

  const xAxes = factorSpecs.map((factor, c) => {
    const group = svgNode(xAxisLayer, "g", {
      transform: `translate(${gridLeft + c * layout.cellWidth} ${gridTop + responseSpecs.length * layout.cellHeight})`
    });
    const centerX = (plotLeft + plotRight) / 2;

    const labelNode = svgNode(group, "text", {
      class: "profiler-factor-label",
      x: centerX,
      y: 13,
      "text-anchor": "middle"
    });
    labelNode.textContent = factor.unit ? `${factor.label} (${factor.unit})` : factor.label;

    const minNode = svgNode(group, "text", {
      class: "profiler-factor-bound",
      x: plotLeft,
      y: 26,
      "text-anchor": "start"
    });
    minNode.textContent = factor.format(factor.domain[0]);

    const maxNode = svgNode(group, "text", {
      class: "profiler-factor-bound",
      x: plotRight,
      y: 26,
      "text-anchor": "end"
    });
    maxNode.textContent = factor.format(factor.domain[1]);

    const valueNode = svgNode(group, "text", {
      class: "profiler-factor-value",
      x: centerX,
      y: 40,
      "text-anchor": "middle"
    });

    return { valueNode };
  });

  function buildPath(response, factor, curve, samples) {
    let path = "";
    let pendingMove = true;

    for (let s = 0; s < curve.length; s++) {
      const value = curve[s];
      if (!Number.isFinite(value)) {
        pendingMove = true;
        continue;
      }
      const x = factor.scale(samples[s]).toFixed(2);
      const y = response.scale(value).toFixed(2);
      path += `${pendingMove ? "M" : "L"} ${x} ${y} `;
      pendingMove = false;
    }

    return path.trim();
  }

  function renderYAxes() {
    responseSpecs.forEach((response, r) => {
      const axis = yAxes[r];
      const ticks = response.scale.ticks(layout.yTickCount);
      const format = d3.tickFormat(response.domain[0], response.domain[1], layout.yTickCount);

      axis.replaceChildren();
      for (const tick of ticks) {
        const node = svgNode(axis, "text", {
          class: "profiler-tick-label",
          x: gridLeft - 6,
          y: response.scale(tick) + 3,
          "text-anchor": "end"
        });
        node.textContent = format(tick);
      }
    });
  }

  function renderCells() {
    for (const cell of cells) {
      const response = responseSpecs[cell.rowIndex];
      const factor = factorSpecs[cell.colIndex];
      const samples = columnSamples[cell.colIndex];
      const curve = curves[cell.rowIndex][cell.colIndex];

      cell.gridlines.replaceChildren();
      for (const tick of response.scale.ticks(layout.yTickCount)) {
        const y = response.scale(tick);
        svgNode(cell.gridlines, "line", {
          class: "profiler-gridline",
          x1: plotLeft,
          x2: plotRight,
          y1: y,
          y2: y
        });
      }

      cell.curvePath.setAttribute("d", buildPath(response, factor, curve, samples));

      const currentX = factor.scale(crosshair[factor.key]);
      const predicted = model.predict(response.key, crosshair);
      const currentY = response.scale(predicted);

      cell.crosshairV.setAttribute("x1", currentX);
      cell.crosshairV.setAttribute("x2", currentX);

      if (Number.isFinite(currentY)) {
        cell.crosshairH.setAttribute("y1", currentY);
        cell.crosshairH.setAttribute("y2", currentY);
        cell.marker.setAttribute("cx", currentX);
        cell.marker.setAttribute("cy", currentY);
        cell.crosshairH.classList.remove("profiler-hidden");
        cell.marker.classList.remove("profiler-hidden");
      } else {
        cell.crosshairH.classList.add("profiler-hidden");
        cell.marker.classList.add("profiler-hidden");
      }
    }
  }

  function renderReadouts() {
    responseSpecs.forEach((response, r) => {
      const predicted = model.predict(response.key, crosshair);
      readouts[r].valueNode.textContent = Number.isFinite(predicted)
        ? response.format(predicted)
        : "—";
    });
  }

  function renderXAxis() {
    factorSpecs.forEach((factor, c) => {
      xAxes[c].valueNode.textContent = factor.format(crosshair[factor.key]);
    });
  }

  let renderQueued = false;

  function render() {
    renderQueued = false;
    computeCurves();
    expandDomains();
    renderYAxes();
    renderCells();
    renderReadouts();
    renderXAxis();
  }

  function scheduleRender() {
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    requestAnimationFrame(render);
  }

  function setFactorValue(factorKey, value) {
    const factor = factorSpecs.find((entry) => entry.key === factorKey);
    if (!factor || !Number.isFinite(value)) {
      return false;
    }

    const clamped = Math.max(factor.domain[0], Math.min(factor.domain[1], value));
    if (clamped === crosshair[factorKey]) {
      return false;
    }

    crosshair[factorKey] = clamped;
    return true;
  }

  function moveCrosshairFromPointer(cell, event) {
    const factor = factorSpecs[cell.colIndex];
    const [pointerX] = d3.pointer(event, cell.hit);
    const bounded = Math.max(plotLeft, Math.min(plotRight, pointerX));
    if (setFactorValue(factor.key, factor.scale.invert(bounded))) {
      scheduleRender();
    }
  }

  for (const cell of cells) {
    d3.select(cell.hit).call(
      d3.drag().on("start drag", (event) => {
        if (event.sourceEvent?.detail > 1) {
          return;
        }
        moveCrosshairFromPointer(cell, event);
      })
    );
  }

  svg.addEventListener("dblclick", (event) => {
    event.preventDefault();
    resetAll();
  });

  render();

  container.append(header, scroll);

  container.controlsNode = controls;
  container.getCrosshair = () => ({ ...crosshair });
  container.setCrosshair = (values) => {
    let changed = false;
    for (const factor of factorSpecs) {
      changed = setFactorValue(factor.key, Number(values?.[factor.key])) || changed;
    }
    if (changed) {
      render();
    }
    return changed;
  };
  container.resetCrosshair = () => {
    resetCrosshairValues();
    render();
  };
  container.resetDomains = () => {
    resetDomains();
    render();
  };

  return container;
}
