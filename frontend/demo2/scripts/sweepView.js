// Sweep tab: one input over a range, one output on the y axis.
// Failed designs sit on a strip under the plot so the feasible edge is visible.

import d3 from "../../shared/d3-global.js";
import { API } from "../../shared/api/endpoints.js";
import { apiPost } from "../../shared/api/client.js";
import { MARGIN, axisLabel, chartFrame, createTooltip, gridY, onResize, styleAxis } from "./charts.js";
import { el, fmt, fmtValue, withUnit } from "./format.js";

export function createSweepView(root, catalogue, { getRequest, onPick }) {
  const specs = catalogue.parameters;
  const outputs = catalogue.outputs;
  let data = null;

  const paramSelect = el("select", { class: "select", id: "sweep-param" },
    specs.map((p) => el("option", { value: p.key, text: p.label })));
  paramSelect.value = "batt_spec_energy_w_h_p_kg";
  const start = el("input", { type: "number", class: "num", id: "sweep-start" });
  const stop = el("input", { type: "number", class: "num", id: "sweep-stop" });
  const step = el("input", { type: "number", class: "num", id: "sweep-step" });
  const outputSelect = el("select", { class: "select", id: "sweep-output" },
    Object.entries(outputs).map(([k, o]) => el("option", { value: k, text: o.label })));
  const runButton = el("button", { class: "btn btn-primary", type: "button", text: "Run sweep" });
  const count = el("span", { class: "hint" });
  const chart = el("div", { class: "chart" });
  const tableBox = el("details", { class: "table-box" });
  const message = el("div", { "aria-live": "polite" });

  const resetRange = () => {
    const spec = specs.find((p) => p.key === paramSelect.value);
    start.value = spec.min; stop.value = spec.max; step.value = spec.step;
    for (const input of [start, stop, step]) input.step = spec.step;
    updateCount();
  };
  const updateCount = () => {
    const n = Math.floor((Number(stop.value) - Number(start.value)) / Number(step.value) + 1e-9) + 1;
    const max = catalogue.limits.max_sweep_points;
    count.textContent = Number.isFinite(n) && n > 0 ? `${n} designs${n > max ? ` (limit ${max})` : ""}` : "";
    runButton.disabled = !(n > 0 && n <= max);
  };
  paramSelect.addEventListener("change", resetRange);
  for (const input of [start, stop, step]) input.addEventListener("input", updateCount);
  outputSelect.addEventListener("change", () => data && draw());
  runButton.addEventListener("click", run);

  root.replaceChildren(
    el("div", { class: "controls" }, [
      field("Input", paramSelect, "sweep-param"),
      field("From", start, "sweep-start"),
      field("To", stop, "sweep-stop"),
      field("Step", step, "sweep-step"),
      field("Plot", outputSelect, "sweep-output"),
      el("div", { class: "control-action" }, [runButton, count])
    ]),
    el("p", { class: "hint", text: "Sweeps one input around the design on the left; everything else stays fixed. Click a point to load that design." }),
    message, chart, tableBox
  );
  resetRange();
  onResize(chart, () => data && draw());

  async function run() {
    runButton.disabled = true;
    message.replaceChildren(el("div", { class: "loading" }, [el("span", { class: "spinner" }), "Running sweep…"]));
    try {
      data = await apiPost(API.evtol.sweep, {
        ...getRequest(),
        parameter: paramSelect.value,
        start: Number(start.value), stop: Number(stop.value), step: Number(step.value)
      });
      message.replaceChildren();
      draw();
    } catch (error) {
      message.replaceChildren(el("div", { class: "error-box", role: "alert", text: error.message }));
    } finally {
      updateCount();
    }
  }

  function draw() {
    const out = outputSelect.value;
    const meta = outputs[out];
    const spec = data.parameter;
    const ok = data.points.filter((p) => p[out] != null);
    const bad = data.points.filter((p) => p[out] == null);
    const { svg, inner } = chartFrame(chart, 360);
    svg.attr("aria-label", `${meta.label} versus ${spec.label}`);
    const tip = createTooltip(chart);
    const stripH = bad.length ? 22 : 0;
    const plotH = inner.h - stripH;

    const x = d3.scaleLinear().domain(d3.extent(data.points, (p) => p.value)).nice().range([0, inner.w]);
    const yExt = d3.extent(ok, (p) => p[out]);
    const pad = (yExt[1] - yExt[0]) * 0.08 || Math.abs(yExt[0] || 1) * 0.05;
    const y = d3.scaleLinear().domain([yExt[0] - pad, yExt[1] + pad]).nice().range([plotH, 0]);
    const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    if (ok.length) g.append("g").call((s) => gridY(s, y, inner.w));
    g.append("g").attr("transform", `translate(0,${inner.h})`).call(d3.axisBottom(x).ticks(7)).call(styleAxis);
    if (ok.length) g.append("g").call(d3.axisLeft(y).ticks(5)).call(styleAxis);
    axisLabel(svg, withUnit(spec.label, spec.unit === "count" ? "" : `(${spec.unit})`), { x: MARGIN.left + inner.w / 2, y: MARGIN.top + inner.h + 40 });
    axisLabel(svg, withUnit(meta.label, meta.unit ? `(${meta.unit})` : ""), { x: 18, y: MARGIN.top + plotH / 2, rotate: true });

    // Current design value
    const current = data.design[spec.key];
    if (current >= x.domain()[0] && current <= x.domain()[1]) {
      g.append("line").attr("class", "ref-line").attr("x1", x(current)).attr("x2", x(current)).attr("y1", 0).attr("y2", inner.h);
      g.append("text").attr("class", "ref-label").attr("x", x(current) + 6).attr("y", 12).text("current design");
    }

    g.append("path").datum(ok).attr("class", "series-line s1")
      .attr("d", d3.line().x((p) => x(p.value)).y((p) => y(p[out])));
    g.append("g").selectAll("circle").data(ok).join("circle")
      .attr("class", "dot s1").attr("r", 4.5).attr("cx", (p) => x(p.value)).attr("cy", (p) => y(p[out]));

    if (bad.length) {
      const sy = plotH + stripH / 2 + 2;
      g.append("text").attr("class", "strip-label").attr("x", -8).attr("y", sy + 4).attr("text-anchor", "end").text("failed");
      g.append("g").selectAll("path").data(bad).join("path")
        .attr("class", "fail-mark").attr("d", d3.symbol(d3.symbolX, 60)())
        .attr("transform", (p) => `translate(${x(p.value)},${sy})`);
    }

    // Hover + click: nearest point by x over the whole plot area.
    const all = data.points;
    const focus = g.append("circle").attr("class", "focus-ring").attr("r", 8).style("display", "none");
    g.append("rect").attr("class", "hit-area").attr("width", inner.w).attr("height", inner.h)
      .on("pointermove", (event) => {
        const [mx] = d3.pointer(event);
        const p = all[d3.minIndex(all, (d) => Math.abs(x(d.value) - mx))];
        const py = p[out] == null ? plotH + stripH / 2 + 2 : y(p[out]);
        focus.style("display", null).attr("cx", x(p.value)).attr("cy", py);
        const [cx, cy] = d3.pointer(event, chart);
        tip.show(`<strong>${spec.label}: ${fmtValue(p.value, spec)} ${spec.unit === "count" ? "" : spec.unit}</strong><br>` +
          (p[out] == null ? `${p.status}${p.message ? `: ${p.message.slice(0, 120)}…` : ""}`
            : Object.entries(outputs).map(([k, o]) => {
                const line = `${o.label}: ${fmt(p[k], k === "cruise_l_p_d" ? 2 : 1)} ${o.unit}`;
                return k === out ? `<strong>${line}</strong>` : line;
              }).join("<br>")) +
          (p.warnings.length ? `<br>Constraint warnings: ${p.warnings.join(", ")}` : "") +
          `<br><span class="tip-hint">Click to load this design</span>`, cx, cy);
      })
      .on("pointerleave", () => { focus.style("display", "none"); tip.hide(); })
      .on("click", (event) => {
        const [mx] = d3.pointer(event);
        const p = all[d3.minIndex(all, (d) => Math.abs(x(d.value) - mx))];
        onPick?.(spec.key, p.value);
      });

    renderTable(spec, out, meta);
  }

  function renderTable(spec, out, meta) {
    tableBox.replaceChildren(
      el("summary", { text: `Show data table (${data.points.length} rows)` }),
      el("table", { class: "data-table" }, [
        el("thead", {}, el("tr", {}, [spec.label, "Status", "MTOW (kg)", "Energy (kWh)", "Battery (kg)", "L/D", "Warnings"].map((h) => el("th", { text: h })))),
        el("tbody", {}, data.points.map((p) => el("tr", {}, [
          fmtValue(p.value, spec), p.status, fmt(p.mtow_kg), fmt(p.total_energy_kw_hr), fmt(p.battery_mass_kg), fmt(p.cruise_l_p_d, 2), p.warnings.join(", ")
        ].map((c) => el("td", { text: c })))))
      ])
    );
  }

  return {};
}

function field(label, control, id) {
  return el("div", { class: "control" }, [el("label", { for: id, class: "field-label", text: label }), control]);
}
