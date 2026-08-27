const SKETCH_COLORS = ["#d62728", "#1f77b4", "#2ca02c", "#111827"];

export function getGTB777SketchColor(index) {
  return SKETCH_COLORS[index % SKETCH_COLORS.length];
}

const GEOMETRY_COLUMNS = [
  "ARHT",
  "TRHT",
  "SWPHT (deg)",
  "SHT (sqft)",
  "ETAIE",
  "ETAOE",
  "CRE"
];

function createSvgElement(name) {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function makePath(points) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

function getNumber(row, key, fallback) {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function getTailGeometry(row) {
  const aspectRatio = getNumber(row, "ARHT", 4.5);
  const taperRatio = getNumber(row, "TRHT", 0.35);
  const sweepDegrees = getNumber(row, "SWPHT (deg)", 35);
  const area = getNumber(row, "SHT (sqft)", 1100);
  const elevatorInnerEta = getNumber(row, "ETAIE", 0.15);
  const elevatorOuterEta = getNumber(row, "ETAOE", 0.9);
  const elevatorChordRatio = getNumber(row, "CRE", 0.25);

  const span = Math.sqrt(aspectRatio * area);
  const halfSpan = span / 2;
  const rootChord = (2 * area) / (span * (1 + taperRatio));
  const tipChord = rootChord * taperRatio;
  const leadingEdgeSweep = Math.tan((sweepDegrees * Math.PI) / 180);

  return {
    halfSpan,
    rootChord,
    tipChord,
    leadingEdgeSweep,
    elevatorInnerEta: Math.max(0, Math.min(1, elevatorInnerEta)),
    elevatorOuterEta: Math.max(0, Math.min(1, elevatorOuterEta)),
    elevatorChordRatio: Math.max(0, Math.min(1, elevatorChordRatio))
  };
}

function getChordAtEta(geometry, eta) {
  return geometry.rootChord + (geometry.tipChord - geometry.rootChord) * eta;
}

function getLeadingEdgeXAtEta(geometry, eta) {
  return geometry.halfSpan * eta * geometry.leadingEdgeSweep;
}

function getPlanformPoints(geometry) {
  const tipLeadingX = getLeadingEdgeXAtEta(geometry, 1);

  return [
    [0, 0],
    [tipLeadingX, -geometry.halfSpan],
    [tipLeadingX + geometry.tipChord, -geometry.halfSpan],
    [geometry.rootChord, 0]
  ];
}

function getElevatorPoints(geometry) {
  const innerEta = Math.min(geometry.elevatorInnerEta, geometry.elevatorOuterEta);
  const outerEta = Math.max(geometry.elevatorInnerEta, geometry.elevatorOuterEta);
  const innerLeadingX = getLeadingEdgeXAtEta(geometry, innerEta);
  const outerLeadingX = getLeadingEdgeXAtEta(geometry, outerEta);
  const innerChord = getChordAtEta(geometry, innerEta);
  const outerChord = getChordAtEta(geometry, outerEta);
  const hingeFraction = 1 - geometry.elevatorChordRatio;

  return [
    [innerLeadingX + innerChord * hingeFraction, -geometry.halfSpan * innerEta],
    [outerLeadingX + outerChord * hingeFraction, -geometry.halfSpan * outerEta],
    [outerLeadingX + outerChord, -geometry.halfSpan * outerEta],
    [innerLeadingX + innerChord, -geometry.halfSpan * innerEta]
  ];
}

function getSketchDomains(rows) {
  let maxX = 40;
  let maxSpan = 30;

  for (const row of rows) {
    if (!GEOMETRY_COLUMNS.every((key) => Number.isFinite(Number(row?.[key])))) {
      continue;
    }

    const geometry = getTailGeometry(row);
    const planform = getPlanformPoints(geometry);
    maxX = Math.max(maxX, ...planform.map(([x]) => x));
    maxSpan = Math.max(maxSpan, geometry.halfSpan);
  }

  return {
    x: [0, Math.ceil((maxX + 4) / 5) * 5],
    y: [-Math.ceil((maxSpan + 4) / 5) * 5, 10]
  };
}

function getTickValues(min, max, step = 10) {
  const ticks = [];
  const first = Math.ceil(min / step) * step;
  for (let value = first; value <= max; value += step) {
    ticks.push(value);
  }
  return ticks;
}

function appendPath(parent, points, className, color, closePath = false) {
  const path = createSvgElement("path");
  path.setAttribute("class", className);
  path.setAttribute("d", `${makePath(points)}${closePath ? " Z" : ""}`);
  path.style.setProperty("--sketch-color", color);
  parent.appendChild(path);
  return path;
}

function appendText(parent, x, y, text, className = "gtb777-sketch-label") {
  const node = createSvgElement("text");
  node.setAttribute("class", className);
  node.setAttribute("x", x);
  node.setAttribute("y", y);
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function createScales(domains) {
  const plot = {
    left: 52,
    right: 340,
    top: 35,
    bottom: 320
  };

  return {
    plot,
    x(value) {
      return plot.left + ((value - domains.x[0]) / (domains.x[1] - domains.x[0])) * (plot.right - plot.left);
    },
    y(value) {
      return plot.top + ((value - domains.y[0]) / (domains.y[1] - domains.y[0])) * (plot.bottom - plot.top);
    }
  };
}

function toScreenPoints(points, scales) {
  return points.map(([x, y]) => [scales.x(x), scales.y(y)]);
}

function drawAxes(svg, domains, scales) {
  const { plot } = scales;
  const frame = createSvgElement("g");
  frame.setAttribute("class", "gtb777-sketch-frame");

  appendPath(frame, [[plot.left, plot.top], [plot.right, plot.top], [plot.right, plot.bottom], [plot.left, plot.bottom], [plot.left, plot.top]], "gtb777-sketch-axis", "#111827");
  appendPath(frame, [[scales.x(domains.x[0]), scales.y(0)], [scales.x(domains.x[1]), scales.y(0)]], "gtb777-sketch-centerline", "#6b7280");

  for (const tick of getTickValues(domains.x[0], domains.x[1])) {
    const x = scales.x(tick);
    appendPath(frame, [[x, plot.bottom], [x, plot.bottom + 5]], "gtb777-sketch-axis-tick", "#111827");
    appendPath(frame, [[x, plot.top], [x, plot.top - 5]], "gtb777-sketch-axis-tick", "#111827");
    const label = appendText(frame, x, plot.bottom + 18, String(tick), "gtb777-sketch-tick-label");
    label.setAttribute("text-anchor", "middle");
  }

  for (const tick of getTickValues(domains.y[0], domains.y[1])) {
    const y = scales.y(tick);
    appendPath(frame, [[plot.left, y], [plot.left - 5, y]], "gtb777-sketch-axis-tick", "#111827");
    appendPath(frame, [[plot.right, y], [plot.right + 5, y]], "gtb777-sketch-axis-tick", "#111827");
    const label = appendText(frame, plot.left - 10, y + 4, String(tick), "gtb777-sketch-tick-label");
    label.setAttribute("text-anchor", "end");
  }

  const xLabel = appendText(frame, (plot.left + plot.right) / 2, 365, "Chordwise distance (ft)", "gtb777-sketch-axis-label");
  xLabel.setAttribute("text-anchor", "middle");

  const yLabel = appendText(frame, 15, (plot.top + plot.bottom) / 2, "Spanwise distance (ft)", "gtb777-sketch-axis-label");
  yLabel.setAttribute("transform", `rotate(-90 15 ${(plot.top + plot.bottom) / 2})`);
  yLabel.setAttribute("text-anchor", "middle");

  appendText(frame, plot.left + 6, plot.top + 16, "Horizontal tail, right half", "gtb777-sketch-caption");
  svg.appendChild(frame);
}

function drawTailDesign(parent, point, color, scales) {
  const geometry = getTailGeometry(point.row);
  const group = createSvgElement("g");
  group.setAttribute("class", "gtb777-sketch-design");

  appendPath(group, toScreenPoints(getPlanformPoints(geometry), scales), "gtb777-sketch-tail", color, true);
  appendPath(group, toScreenPoints(getElevatorPoints(geometry), scales), "gtb777-sketch-elevator", color, true);
  appendPath(group, toScreenPoints([[0, 0], [geometry.rootChord, 0]], scales), "gtb777-sketch-aircraft-centerline", color);

  parent.appendChild(group);
}

export function createGTB777Sketch({
  contentController,
  plotController,
  width = 375,
  height = 375
}) {
  const root = document.createElement("div");
  root.className = "gtb777-sketch";

  const svg = createSvgElement("svg");
  svg.setAttribute("class", "gtb777-sketch-svg");
  svg.setAttribute("viewBox", "0 0 375 375");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Overlaid GTB777 horizontal tail sketches with axes in feet");

  const empty = document.createElement("div");
  empty.className = "gtb777-sketch-empty";
  empty.textContent = "Toggle Draw on highlighted points to overlay HT sketches.";

  const domains = getSketchDomains(contentController?.getRows?.() ?? []);
  const scales = createScales(domains);

  function render() {
    const points = contentController?.getDrawnPointSummaries?.(plotController) ?? [];
    svg.replaceChildren();
    drawAxes(svg, domains, scales);

    points.forEach((point, index) => {
      drawTailDesign(svg, point, getGTB777SketchColor(index), scales);
    });

    empty.hidden = points.length > 0;
  }

  plotController?.subscribe?.((event) => {
    if (event.type === "drawPoints" || event.type === "pins") {
      render();
    }
  });

  render();
  root.append(svg, empty);
  return root;
}
