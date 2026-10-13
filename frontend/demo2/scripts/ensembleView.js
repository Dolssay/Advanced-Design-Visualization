// Ensemble tab: LHS sample of designs, MTOW against total energy.
// The interactive version of backend/pipelines/ensemble.py, with a CSV download.

import d3 from "../../shared/d3-global.js";
import { API } from "../../shared/api/endpoints.js";
import { apiPost } from "../../shared/api/client.js";
import { MARGIN, axisLabel, chartFrame, createTooltip, gridY, onResize, styleAxis } from "./charts.js";
import { el, fmt, fmtValue } from "./format.js";

export function createEnsembleView(root, catalogue, { getBaseline, onPickDesign }) {
  const specs = catalogue.parameters;
  const max = catalogue.limits.max_ensemble_samples;
  let data = null;

  const n = el("input", { type: "number", class: "num", id: "ens-n", min: 1, max, step: 1, value: Math.min(60, max) });
  const seed = el("input", { type: "number", class: "num", id: "ens-seed", step: 1, value: 0 });
  const runButton = el("button", { class: "btn btn-primary", type: "button", text: "Run ensemble" });
  const download = el("button", { class: "btn", type: "button", text: "Download CSV", disabled: true });
  const summary = el("p", { class: "run-meta" });
  const chart = el("div", { class: "chart" });
  const message = el("div", { "aria-live": "polite" });

  runButton.addEventListener("click", run);
  download.addEventListener("click", downloadCsv);
  root.replaceChildren(
    el("div", { class: "controls" }, [
      el("div", { class: "control" }, [el("label", { for: "ens-n", class: "field-label", text: `Samples (max ${max})` }), n]),
      el("div", { class: "control" }, [el("label", { for: "ens-seed", class: "field-label", text: "Seed" }), seed]),
      el("div", { class: "control-action" }, [runButton, download])
    ]),
    el("p", { class: "hint", text: "Latin Hypercube sample over the study ranges of every input, sized on the server. Click a point to load that design into the form." }),
    message, summary, chart
  );
  onResize(chart, () => data && draw());

  async function run() {
    runButton.disabled = true;
    message.replaceChildren(el("div", { class: "loading" }, [el("span", { class: "spinner" }), `Sizing ${n.value} designs…`]));
    try {
      data = await apiPost(API.evtol.ensemble, { baseline: getBaseline(), n_samples: Number(n.value), seed: Number(seed.value) });
      message.replaceChildren();
      download.disabled = false;
      draw();
    } catch (error) {
      message.replaceChildren(el("div", { class: "error-box", role: "alert", text: error.message }));
    } finally {
      runButton.disabled = false;
    }
  }

  function draw() {
    const ok = data.rows.filter((r) => r.mtow_kg != null);
    const failed = data.rows.length - ok.length;
    summary.textContent = `${data.rows.length} designs: ${ok.length} sized, ${failed} failed. ` +
      Object.entries(data.status_counts).map(([k, v]) => `${k} ${v}`).join(" · ");

    const { svg, inner } = chartFrame(chart, 380);
    svg.attr("aria-label", "MTOW versus total energy for the ensemble");
    const tip = createTooltip(chart);
    if (!ok.length) return;
    const x = d3.scaleLinear().domain(d3.extent(ok, (r) => r.total_energy_kw_hr)).nice().range([0, inner.w]);
    const y = d3.scaleLinear().domain(d3.extent(ok, (r) => r.mtow_kg)).nice().range([inner.h, 0]);
    const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    g.append("g").call((s) => gridY(s, y, inner.w));
    g.append("g").attr("transform", `translate(0,${inner.h})`).call(d3.axisBottom(x).ticks(7)).call(styleAxis);
    g.append("g").call(d3.axisLeft(y).ticks(6)).call(styleAxis);
    axisLabel(svg, "Total mission energy (kWh)", { x: MARGIN.left + inner.w / 2, y: MARGIN.top + inner.h + 40 });
    axisLabel(svg, "MTOW (kg)", { x: 18, y: MARGIN.top + inner.h / 2, rotate: true });

    g.append("g").selectAll("circle").data(ok).join("circle")
      .attr("class", "dot s1 dot-scatter").attr("r", 5)
      .attr("cx", (r) => x(r.total_energy_kw_hr)).attr("cy", (r) => y(r.mtow_kg))
      .on("pointerenter", function (event, r) {
        d3.select(this).classed("is-hover", true);
        const [cx, cy] = d3.pointer(event, chart);
        const lines = specs.map((s) => `${s.label}: ${fmtValue(r[s.key], s)} ${s.unit === "count" ? "" : s.unit}`);
        tip.show(`<strong>Run ${r.run}</strong> · MTOW ${fmt(r.mtow_kg)} kg · ${fmt(r.total_energy_kw_hr)} kWh<br>` +
          `<span class="tip-small">${lines.join("<br>")}</span><br><span class="tip-hint">Click to load this design</span>`, cx, cy);
      })
      .on("pointerleave", function () { d3.select(this).classed("is-hover", false); tip.hide(); })
      .on("click", (event, r) => onPickDesign?.(Object.fromEntries(specs.map((s) => [s.key, r[s.key]]))));
  }

  function downloadCsv() {
    const columns = Object.keys(data.rows[0]);
    const escape = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [columns.join(","), ...data.rows.map((r) => columns.map((c) => escape(r[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = el("a", { href: url, download: `evtol-ensemble-${data.baseline}-seed${data.seed}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {};
}
