// Sensitivity tab: one-at-a-time tornado around the current design.
// Blue bar = output with the input moved down; orange = input moved up.

import d3 from "../../shared/d3-global.js";
import { API } from "../../shared/api/endpoints.js";
import { apiPost } from "../../shared/api/client.js";
import { MARGIN, chartFrame, createTooltip, onResize, styleAxis } from "./charts.js";
import { el, fmt, fmtValue, signed } from "./format.js";

export function createSensitivityView(root, catalogue, { getRequest }) {
  const outputs = catalogue.outputs;
  const specByKey = Object.fromEntries(catalogue.parameters.map((p) => [p.key, p]));
  let data = null;

  const delta = el("input", { type: "number", class: "num", id: "sens-delta", min: 1, max: 50, step: 1, value: 10 });
  const outputSelect = el("select", { class: "select", id: "sens-output" },
    Object.entries(outputs).map(([k, o]) => el("option", { value: k, text: o.label })));
  const runButton = el("button", { class: "btn btn-primary", type: "button", text: "Rank inputs" });
  const chart = el("div", { class: "chart" });
  const message = el("div", { "aria-live": "polite" });
  const legend = el("div", { class: "legend" });

  outputSelect.addEventListener("change", () => data && draw());
  runButton.addEventListener("click", run);
  root.replaceChildren(
    el("div", { class: "controls" }, [
      el("div", { class: "control" }, [el("label", { for: "sens-delta", class: "field-label", text: "Move each input by ± (%)" }), delta]),
      el("div", { class: "control" }, [el("label", { for: "sens-output", class: "field-label", text: "Output" }), outputSelect]),
      el("div", { class: "control-action" }, [runButton])
    ]),
    el("p", { class: "hint", text: "Each input is moved down and up while the others stay at the design on the left (rotor count moves by ±1). Longest bars matter most for optimizing." }),
    message, legend, chart
  );
  onResize(chart, () => data && draw());

  async function run() {
    runButton.disabled = true;
    message.replaceChildren(el("div", { class: "loading" }, [el("span", { class: "spinner" }), "Sizing every input at both ends…"]));
    try {
      data = await apiPost(API.evtol.sensitivity, { ...getRequest(), delta_pct: Number(delta.value) });
      message.replaceChildren();
      draw();
    } catch (error) {
      message.replaceChildren(el("div", { class: "error-box", role: "alert", text: error.message }));
    } finally {
      runButton.disabled = false;
    }
  }

  function draw() {
    const out = outputSelect.value;
    const meta = outputs[out];
    const digits = out === "cruise_l_p_d" ? 2 : 1;
    const base = data.base[out];
    const rows = data.rows
      .map((r) => ({ ...r, lo: r.low[out], hi: r.high[out] }))
      .map((r) => ({ ...r, swing: Math.max(Math.abs((r.lo ?? base) - base), Math.abs((r.hi ?? base) - base)) }))
      .sort((a, b) => b.swing - a.swing);

    legend.replaceChildren(
      el("span", { class: "legend-item" }, [el("span", { class: "swatch s1" }), `Input −${data.delta_pct}%`]),
      el("span", { class: "legend-item" }, [el("span", { class: "swatch s2" }), `Input +${data.delta_pct}%`]),
      el("span", { class: "legend-item" }, [el("span", { class: "legend-x", text: "×" }), "design failed to size"])
    );

    const labelW = 210;
    const rowH = 30;
    const height = MARGIN.top + rows.length * rowH + MARGIN.bottom;
    const { svg, width } = chartFrame(chart, height);
    svg.attr("aria-label", `Tornado of ${meta.label} sensitivity`);
    const tip = createTooltip(chart);
    const left = labelW + 16;
    const w = width - left - MARGIN.right;
    // Plot changes from the design value, so 0 is the design and ticks read as +/- deltas.
    const deltas = rows.flatMap((r) => [r.lo, r.hi]).filter((v) => v != null).map((v) => v - base);
    const span = d3.max(deltas, Math.abs) || 1;
    const x = d3.scaleLinear().domain([-span * 1.05, span * 1.05]).nice().range([0, w]);
    const xv = (v) => x(v - base);
    const y = d3.scaleBand().domain(rows.map((r) => r.key)).range([0, rows.length * rowH]).paddingInner(0.3);
    const g = svg.append("g").attr("transform", `translate(${left},${MARGIN.top})`);

    g.append("g").attr("transform", `translate(0,${rows.length * rowH})`)
      .call(d3.axisBottom(x).ticks(7).tickFormat((v) => (v === 0 ? "0" : signed(v, span < 1 ? 2 : 0)))).call(styleAxis);
    svg.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
      .attr("x", left + w / 2).attr("y", height - 8)
      .text(`Change in ${meta.label}${meta.unit ? ` (${meta.unit})` : ""} from the design value ${fmt(base, digits)}`);

    const bh = Math.min(20, y.bandwidth());
    const rowG = g.append("g").selectAll("g").data(rows).join("g")
      .attr("transform", (r) => `translate(0,${y(r.key) + (y.bandwidth() - bh) / 2})`);

    const bar = (sel, side, cls) => sel.filter((r) => r[side] != null).append("rect")
      .attr("class", `bar ${cls}`)
      .attr("x", (r) => Math.min(xv(base), xv(r[side])))
      .attr("width", (r) => Math.max(1, Math.abs(xv(r[side]) - xv(base))))
      .attr("height", bh).attr("rx", 3);
    bar(rowG, "lo", "s1");
    bar(rowG, "hi", "s2");
    rowG.filter((r) => r.lo == null || r.hi == null).append("text")
      .attr("class", "fail-text").attr("x", xv(base) + 6).attr("y", bh / 2 + 4).text("×");
    rowG.filter((r) => r.lo != null && r.hi != null && r.swing < span * 1e-3).append("text")
      .attr("class", "strip-label").attr("x", xv(base) + 8).attr("y", bh / 2 + 4).text("no effect");

    g.append("line").attr("class", "zero-line").attr("x1", xv(base)).attr("x2", xv(base)).attr("y1", -4).attr("y2", rows.length * rowH);

    svg.append("g").attr("transform", `translate(${labelW},${MARGIN.top})`).selectAll("text").data(rows).join("text")
      .attr("class", "row-label").attr("text-anchor", "end")
      .attr("y", (r) => y(r.key) + y.bandwidth() / 2 + 4)
      .text((r) => r.label);

    rowG.append("rect").attr("class", "hit-area").attr("x", 0).attr("y", -4).attr("width", w).attr("height", bh + 8)
      .on("pointermove", (event, r) => {
        const spec = specByKey[r.key];
        const unit = spec.unit === "count" ? "" : spec.unit;
        const line = (value, res, sign) => res == null
          ? `${sign} ${fmtValue(value, spec)} ${unit}: failed`
          : `${sign} ${fmtValue(value, spec)} ${unit}: ${fmt(res, digits)} ${meta.unit} (${signed(res - base, digits)})`;
        const [cx, cy] = d3.pointer(event, chart);
        tip.show(`<strong>${r.label}</strong><br>Design: ${fmtValue(r.base_value, spec)} ${unit}<br>` +
          `${line(r.low_value, r.lo, "Down to")}<br>${line(r.high_value, r.hi, "Up to")}`, cx, cy);
      })
      .on("pointerleave", () => tip.hide());
  }

  return {};
}
