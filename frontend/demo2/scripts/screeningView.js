// Morris screening charts. Output selection redraws the saved result without rerunning sizing.

import d3 from "../../shared/d3-global.js";
import { API } from "../../shared/api/endpoints.js";
import { apiPost } from "../../shared/api/client.js";
import { PARAMETER_GROUP_COLORS } from "../../shared/parameterGroups.js";
import { MARGIN, axisLabel, chartFrame, createTooltip, gridY, onResize, styleAxis } from "./charts.js";
import { el, fmt } from "./format.js";

const OUTPUT_KEYS = [
  "mtow_kg",
  "empty_mass_kg",
  "battery_mass_kg",
  "total_energy_kw_hr",
  "cruise_l_p_d"
];

export function createScreeningView(root, catalogue, { getBaseline }) {
  const outputs = catalogue.outputs;
  const outputNames = {
    mtow_kg: "MTOW",
    empty_mass_kg: "Empty mass",
    battery_mass_kg: "Battery mass",
    total_energy_kw_hr: "Total energy",
    cruise_l_p_d: "Cruise L/D"
  };
  const specs = Object.fromEntries(catalogue.parameters.map((spec) => [spec.key, spec]));
  let data = null;
  let selectedOutput = "mtow_kg";
  const controls = el("div", { class: "controls screening-controls" });
  const trajectorySelect = el("select", { class: "select", id: "screening-r" },
    [10, 20, 30].map((r) => el("option", { value: r, text: String(r) })));
  trajectorySelect.value = "20";
  const seed = el("input", { type: "number", class: "num", id: "screening-seed", step: 1, value: 0 });
  const estimate = el("span", { class: "screening-estimate", "aria-live": "polite" });
  const runButton = el("button", { class: "btn btn-primary", type: "button", text: "Run screening" });
  const message = el("div", { class: "screening-message", "aria-live": "polite" });
  const outputButtons = el("div", { class: "screening-output-buttons", role: "group", "aria-label": "Output to display" });
  const meta = el("p", { class: "run-meta screening-meta", "aria-live": "polite" });
  const warning = el("p", { class: "screening-warning", role: "status", hidden: true });
  const scatter = el("div", { class: "chart screening-chart" });
  const bars = el("div", { class: "chart screening-chart" });
  const table = el("table", { class: "sr-only", id: "screening-data-table" });

  for (const key of OUTPUT_KEYS) {
    const button = el("button", {
      class: "screening-output",
      type: "button",
      text: outputNames[key],
      "aria-pressed": String(key === selectedOutput),
      "data-output": key
    });
    button.addEventListener("click", () => {
      selectedOutput = key;
      for (const candidate of outputButtons.querySelectorAll("button")) {
        candidate.setAttribute("aria-pressed", String(candidate.dataset.output === key));
      }
      if (data) draw();
    });
    outputButtons.append(button);
  }
  runButton.addEventListener("click", run);
  trajectorySelect.addEventListener("change", updateEstimate);

  controls.append(
    el("div", { class: "control" }, [
      el("label", { for: "screening-r", class: "field-label", text: "Trajectories (r)" }),
      trajectorySelect
    ]),
    el("div", { class: "control" }, [
      el("label", { for: "screening-seed", class: "field-label", text: "Seed" }),
      seed
    ]),
    el("div", { class: "control-action" }, [runButton, estimate])
  );
  root.replaceChildren(
    controls,
    el("p", {
      class: "hint",
      text: "Morris screening samples the full study box. μ* measures average effect; σ shows how much that effect changes across the box."
    }),
    outputButtons,
    message,
    meta,
    warning,
    el("div", { class: "screening-charts" }, [
      el("section", { class: "screening-chart-panel", "aria-label": "Morris effect scatter plot" }, [
        el("h3", { class: "screening-chart-title", text: "μ* vs σ" }),
        scatter
      ]),
      el("section", { class: "screening-chart-panel", "aria-label": "Input importance chart" }, [
        el("h3", { class: "screening-chart-title", text: "Importance (μ*)" }),
        bars
      ])
    ]),
    el("div", { class: "screening-reading-guide" }, [
      el("h3", { text: "Reading guide" }),
      el("p", { text: "Near the origin: fix the input or give it a coarse slider step." }),
      el("p", { text: "High μ*, low σ: a linear driver, so a uniform step suits it." }),
      el("p", { text: "High σ: use a finer step and map it against its partner in the closure map (Plot 4)." })
    ]),
    table
  );

  const updateSize = () => data && draw();
  onResize(root, updateSize);
  updateEstimate();
  loadSample();

  async function loadSample() {
    try {
      const response = await fetch("/data/screening-sample.json", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Could not load the saved screening sample (${response.status}).`);
      data = await response.json();
      message.replaceChildren(el("p", {
        class: "screening-sample-note",
          text: "Illustrative saved sample (not a solver result) — run screening to analyze the currently selected baseline."
      }));
      draw();
    } catch (error) {
      message.replaceChildren(el("div", { class: "error-box", role: "alert", text: error.message }));
    }
  }

  async function run() {
    runButton.disabled = true;
    message.replaceChildren(el("div", { class: "loading" }, [
      el("span", { class: "spinner" }),
      `Running ${trajectorySelect.value} Morris trajectories…`
    ]));
    try {
      data = await apiPost(API.evtol.screening, {
        baseline: getBaseline(),
        r: Number(trajectorySelect.value),
        levels: 4,
        seed: Number(seed.value),
        outputs: OUTPUT_KEYS
      });
      message.replaceChildren();
      draw();
    } catch (error) {
      message.replaceChildren(el("div", { class: "error-box", role: "alert", text: error.message }));
    } finally {
      runButton.disabled = false;
    }
  }

  function updateEstimate() {
    const seconds = Number(trajectorySelect.value) * 13 / 16;
    estimate.textContent = `Estimated time: ${seconds.toFixed(1)} s`;
  }

  function draw() {
    const output = selectedOutput;
    const outputMeta = outputs[output];
    const stats = data.results[output] || [];
    const rows = stats
      .map((stat) => ({ ...stat, input: data.inputs.find((item) => item.key === stat.param) }))
      .filter((row) => row.input);
    const agreement = data.stability?.[output]?.agreement;
    const sourcePrefix = data.cached ? "Cached result · " : data.baseline ? "" : "Example response · ";
    meta.textContent = `${sourcePrefix}r = ${data.r} trajectories · ${data.n_runs} runs · ${data.n_failed} failed · ${fmt(data.elapsed_s, 1)} s` +
      (data.n_constraint == null ? "" : ` · ${data.n_constraint} constraint warnings`);
    warning.hidden = agreement == null || agreement >= 0.8;
    warning.textContent = "Ranking unstable, try a larger r";

    drawScatter(rows, outputMeta);
    drawBars(rows, outputMeta);
    drawAccessibleTable(rows, outputMeta, agreement);
  }

  function drawScatter(rows, outputMeta) {
    const valid = rows.filter((row) => Number.isFinite(row.mu_star) && Number.isFinite(row.sigma));
    const largest = d3.max(valid, (row) => row.mu_star) || 1;
    const maxX = largest * 1.1;
    const maxY = (d3.max(valid, (row) => row.sigma) || 1) * 1.1;
    const height = 410;
    const { svg, inner } = chartFrame(scatter, height);
    svg.attr("aria-label", `Morris μ* versus σ scatter plot for ${outputMeta.label}`);
    const x = d3.scaleLinear().domain([0, maxX]).range([0, inner.w]);
    const y = d3.scaleLinear().domain([0, maxY]).range([inner.h, 0]);
    const plot = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    const clipId = `screening-clip-${outputMeta.label.replace(/\W/g, "")}`;
    svg.append("defs").append("clipPath").attr("id", clipId)
      .append("rect").attr("width", inner.w).attr("height", inner.h);
    plot.append("g").call((group) => gridY(group, y, inner.w));
    plot.append("g").attr("transform", `translate(0,${inner.h})`)
      .call(d3.axisBottom(x).ticks(6)).call(styleAxis);
    plot.append("g").call(d3.axisLeft(y).ticks(5)).call(styleAxis);
    axisLabel(svg, `μ* (${outputMeta.unit || "output units"} per full input range)`, {
      x: MARGIN.left + inner.w / 2, y: height - 8
    });
    axisLabel(svg, "σ", { x: 18, y: MARGIN.top + inner.h / 2, rotate: true });

    const clipped = plot.append("g").attr("clip-path", `url(#${clipId})`);
    clipped.append("rect")
      .attr("class", "screening-freeze-zone")
      .attr("x", 0).attr("y", y(maxY * 0.2))
      .attr("width", x(largest * 0.12)).attr("height", inner.h - y(maxY * 0.2));
    clipped.append("text")
      .attr("class", "screening-freeze-label")
      .attr("x", x(largest * 0.06)).attr("y", y(maxY * 0.1))
      .text("freeze / coarse step");

    for (const ratio of [0.1, 0.5, 1.0]) {
      clipped.append("line")
        .attr("class", "screening-ray")
        .attr("x1", x(0)).attr("y1", y(0))
        .attr("x2", x(maxX)).attr("y2", y(ratio * maxX))
        .attr("stroke-dasharray", "5 4");
    }
    const topSix = new Set([...valid].sort((a, b) => b.mu_star - a.mu_star).slice(0, 6).map((row) => row.param));
    const tooltip = createTooltip(scatter);
    const points = clipped.append("g").selectAll("circle").data(valid).join("circle")
      .attr("class", "screening-dot")
      .attr("r", 5)
      .attr("cx", (row) => x(row.mu_star)).attr("cy", (row) => y(row.sigma))
      .attr("fill", (row) => groupColor(row.input.group))
      .attr("tabindex", 0)
      .attr("aria-label", (row) => `${row.input.label}: mu star ${fmt(row.mu_star)}, sigma ${fmt(row.sigma)}`);
    points
      .on("pointerenter", showTooltip)
      .on("pointermove", showTooltip)
      .on("pointerleave", () => tooltip.hide())
      .on("focus", showTooltip)
      .on("blur", () => tooltip.hide());

    clipped.append("g").selectAll("text").data(valid.filter((row) => topSix.has(row.param))).join("text")
      .attr("class", "screening-point-label")
      .attr("x", (row, i) => x(row.mu_star) + (i % 2 ? -7 : 7))
      .attr("y", (row, i) => y(row.sigma) + (i % 2 ? 15 : -8))
      .attr("text-anchor", (_, i) => i % 2 ? "end" : "start")
      .text((row) => row.input.label);

    const legend = el("div", { class: "screening-ray-legend", "aria-label": "Reference ray ratios" },
      [0.1, 0.5, 1.0].map((ratio) => el("span", { class: "screening-ray-legend-item" }, [
        el("i", { class: "screening-ray-swatch" }),
        `σ/μ* = ${ratio.toFixed(1)}`
      ])));
    scatter.append(legend);

    function showTooltip(event, row) {
      const ratio = row.mu_star > 0 ? row.sigma / row.mu_star : null;
      const [cx, cy] = d3.pointer(event, scatter);
      tooltip.show(
        `<strong>${row.input.label}</strong> · ${row.input.group}<br>` +
        `μ*: ${fmt(row.mu_star)} ± ${fmt(row.mu_star_conf)} ${outputMeta.unit}<br>` +
        `σ: ${fmt(row.sigma)} · σ/μ*: ${ratio == null ? "—" : fmt(ratio, 2)}<br>` +
        `Valid effects: ${row.n_effects} · Failed runs: ${row.n_failed}`,
        cx,
        cy
      );
    }
  }

  function drawBars(rows, outputMeta) {
    const sorted = [...rows].sort((a, b) => (b.mu_star ?? -Infinity) - (a.mu_star ?? -Infinity));
    const labelWidth = 174;
    const rowHeight = 28;
    const height = MARGIN.top + sorted.length * rowHeight + MARGIN.bottom;
    const { svg, width, inner } = chartFrame(bars, height);
    svg.attr("aria-label", `Morris μ* importance bars for ${outputMeta.label}`);
    const plotWidth = Math.max(80, width - labelWidth - MARGIN.right);
    const maxValue = d3.max(sorted, (row) => (row.mu_star || 0) + (row.mu_star_conf || 0)) || 1;
    const x = d3.scaleLinear().domain([0, maxValue * 1.1]).range([0, plotWidth]);
    const y = d3.scaleBand().domain(sorted.map((row) => row.param))
      .range([0, sorted.length * rowHeight]).paddingInner(0.35);
    const plot = svg.append("g").attr("transform", `translate(${labelWidth},${MARGIN.top})`);
    plot.append("g").attr("transform", `translate(0,${sorted.length * rowHeight})`)
      .call(d3.axisBottom(x).ticks(5)).call(styleAxis);
    axisLabel(svg, `μ* (${outputMeta.unit || "output units"})`, {
      x: labelWidth + plotWidth / 2, y: height - 8
    });
    svg.append("g").attr("transform", `translate(${labelWidth - 8},${MARGIN.top})`)
      .selectAll("text").data(sorted).join("text")
      .attr("class", "row-label screening-bar-label")
      .attr("text-anchor", "end")
      .attr("y", (row) => y(row.param) + y.bandwidth() / 2 + 4)
      .text((row) => row.input.label);
    const barHeight = Math.min(18, y.bandwidth());
    const tooltip = createTooltip(bars);
    const groups = plot.append("g").selectAll("g").data(sorted).join("g")
      .attr("transform", (row) => `translate(0,${y(row.param) + (y.bandwidth() - barHeight) / 2})`);
    groups.append("rect")
      .attr("class", "screening-bar")
      .attr("x", 0).attr("y", 0).attr("height", barHeight).attr("rx", 2)
      .attr("width", (row) => x(Math.max(0, row.mu_star || 0)))
      .attr("fill", (row) => groupColor(row.input.group));
    groups.filter((row) => Number.isFinite(row.mu_star_conf)).append("line")
      .attr("class", "screening-ci")
      .attr("x1", (row) => x(Math.max(0, row.mu_star - row.mu_star_conf)))
      .attr("x2", (row) => x(row.mu_star + row.mu_star_conf))
      .attr("y1", barHeight / 2).attr("y2", barHeight / 2);
    groups.filter((row) => Number.isFinite(row.mu_star_conf)).selectAll(".screening-ci-cap")
      .data((row) => [Math.max(0, row.mu_star - row.mu_star_conf), row.mu_star + row.mu_star_conf])
      .join("line").attr("class", "screening-ci-cap")
      .attr("x1", (value) => x(value)).attr("x2", (value) => x(value))
      .attr("y1", 2).attr("y2", barHeight - 2);
    groups.filter((row) => {
      const total = row.n_effects + row.n_failed;
      return total > 0 && row.n_failed / total >= 0.25;
    }).append("text")
      .attr("class", "screening-failed-note")
      .attr("x", (row) => Math.min(plotWidth - 48, x((row.mu_star || 0) + (row.mu_star_conf || 0)) + 7))
      .attr("y", barHeight / 2 + 4)
      .text((row) => `${row.n_failed} failed`);
    groups.append("rect").attr("class", "hit-area").attr("x", 0).attr("y", -4)
      .attr("width", plotWidth).attr("height", barHeight + 8)
      .on("pointermove", (event, row) => {
        const [cx, cy] = d3.pointer(event, bars);
        tooltip.show(
          `<strong>${row.input.label}</strong> · ${row.input.group}<br>` +
          `μ*: ${fmt(row.mu_star)} ± ${fmt(row.mu_star_conf)} ${outputMeta.unit}<br>` +
          `σ: ${fmt(row.sigma)} · Valid effects: ${row.n_effects} · Failed runs: ${row.n_failed}`,
          cx,
          cy
        );
      })
      .on("pointerleave", () => tooltip.hide());
  }

  function drawAccessibleTable(rows, outputMeta, agreement) {
    const head = el("thead", {}, el("tr", {}, [
      "Input", "Group", `μ* (${outputMeta.unit})`, "95% CI half-width",
      `σ (${outputMeta.unit})`, "Valid effects", "Failed runs"
    ].map((heading) => el("th", { scope: "col", text: heading }))));
    const body = el("tbody", {}, rows.map((row) => el("tr", {}, [
      row.input.label,
      row.input.group,
      fmt(row.mu_star),
      fmt(row.mu_star_conf),
      fmt(row.sigma),
      row.n_effects,
      row.n_failed
    ].map((value) => el("td", { text: value })))));
    table.replaceChildren(
      el("caption", { text: `${outputMeta.label} Morris screening results. Ranking agreement: ${agreement == null ? "not available" : `${Math.round(agreement * 100)} percent`}.` }),
      head,
      body
    );
  }

  function groupColor(group) {
    const token = PARAMETER_GROUP_COLORS[group];
    return token ? `var(${token})` : "var(--faint)";
  }

  return {};
}
