// Ensemble tab: LHS sample of designs, with linked Parallel Coordinates and Pareto Front Scatter.
// Supports prebuilt offline ensembles, bounds filtering, append_to sampling, and CSV export.

import d3 from "../../shared/d3-global.js";
import { API } from "../../shared/api/endpoints.js";
import { apiGet, apiPost } from "../../shared/api/client.js";
import { createParallelCoordinates } from "../../shared/plots/parallelCoordinates.js";
import { paretoFront } from "../../shared/pareto.js";
import { MARGIN, axisLabel, chartFrame, createTooltip, gridY, onResize, styleAxis } from "./charts.js";
import { el, fmt, fmtValue } from "./format.js";

export function createEnsembleView(root, catalogue, { getBaseline, onPickDesign }) {
  const specs = catalogue.parameters;
  const max = catalogue.limits.max_ensemble_samples;

  // --- State Object ---
  let data = null; // Current ensemble payload: { ensemble_id, baseline, rows, n_samples, status_counts, ... }
  let filters = {}; // Active filters: { [key]: [lo, hi] }
  let selectedIds = new Set(); // IDs of rows matching active filters
  let hoveredId = null;
  let currentFront = [];
  let includeLdObjective = false;
  let pulsingBatch = null;
  let suppressScatterBrush = false;
  let suppressParallelCoordsBrush = false;

  // --- Dimension Definitions for Parallel Coordinates ---
  // Order: 12 inputs in catalogue group order, visual gap, 5 outputs, categorical status axis
  const inputDims = specs.map((p) => ({
    key: p.key,
    label: p.label,
    unit: p.unit,
    type: "number",
    min: p.min,
    max: p.max,
    limit_min: p.limit_min,
    limit_max: p.limit_max,
  }));

  const outputDims = [
    { key: "mtow_kg", label: "MTOW (kg)", unit: "kg", type: "number", hasNoValue: true },
    { key: "empty_mass_kg", label: "Empty mass (kg)", unit: "kg", type: "number", hasNoValue: true },
    { key: "battery_mass_kg", label: "Battery mass (kg)", unit: "kg", type: "number", hasNoValue: true },
    { key: "total_energy_kw_hr", label: "Energy (kWh)", unit: "kWh", type: "number", hasNoValue: true },
    { key: "cruise_l_p_d", label: "Cruise L/D", unit: "", type: "number", hasNoValue: true },
  ];

  const statusDim = {
    key: "status",
    label: "Status",
    type: "category",
    categories: ["diverged", "max_iter", "converged"],
  };

  const parallelDims = [...inputDims, ...outputDims, statusDim];

  // --- Controls UI ---
  const nInput = el("input", {
    type: "number",
    class: "num",
    id: "ens-n",
    min: 1,
    max,
    step: 1,
    value: Math.min(60, max),
  });
  const seedInput = el("input", {
    type: "number",
    class: "num",
    id: "ens-seed",
    step: 1,
    value: 0,
  });
  const runButton = el("button", {
    class: "btn btn-primary",
    type: "button",
    text: "Run ensemble",
  });
  const sampleMoreBtn = el("button", {
    class: "btn",
    type: "button",
    text: "Sample 50 more here",
    disabled: true,
    title: "Brush at least one input axis to sample more designs inside those bounds",
  });
  const downloadBtn = el("button", {
    class: "btn",
    type: "button",
    text: "Download CSV",
    disabled: true,
  });

  const controlsBar = el("div", { class: "controls" }, [
    el("div", { class: "control" }, [
      el("label", { for: "ens-n", class: "field-label", text: `Samples (max ${max})` }),
      nInput,
    ]),
    el("div", { class: "control" }, [
      el("label", { for: "ens-seed", class: "field-label", text: "Seed" }),
      seedInput,
    ]),
    el("div", { class: "control-action", style: "display: flex; gap: 8px; flex-wrap: wrap;" }, [
      runButton,
      sampleMoreBtn,
      downloadBtn,
    ]),
  ]);

  const hint = el("p", {
    class: "hint",
    text: "Latin Hypercube sample over the study ranges of every input. Brush axes to filter; click a point or line to load that design into the form.",
  });
  const message = el("div", { "aria-live": "polite" });

  // Parallel Coordinates Container
  const parallelContainer = el("div", {
    class: "parallel-wrapper",
    style: "width: 100%; margin-top: 12px; margin-bottom: 16px;",
  });

  // Summary Row & 3D Toggle
  const summaryText = el("span", {
    class: "run-meta-text",
    style: "font-weight: 500; font-size: 13px;",
    text: "No ensemble loaded.",
  });

  const failedBadge = el("span", {
    class: "chip chip-muted",
    style: "font-size: 11px; padding: 2px 8px;",
    text: "0 failed — grey in parallel coordinates",
  });

  const ldCheckbox = el("input", { type: "checkbox", id: "ens-ld-toggle" });
  const ldToggleLabel = el(
    "label",
    {
      for: "ens-ld-toggle",
      style: "display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; user-select: none;",
    },
    [ldCheckbox, "Include L/D as an objective"]
  );

  const summaryBar = el(
    "div",
    {
      class: "ensemble-summary-bar",
      style:
        "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding: 10px 14px; background: var(--surface-1, #ffffff); border: 1px solid #ddd; border-radius: 8px; margin-top: 8px; margin-bottom: 8px;",
    },
    [
      el("div", { style: "display: flex; align-items: center; gap: 12px; flex-wrap: wrap;" }, [
        summaryText,
        failedBadge,
      ]),
      ldToggleLabel,
    ]
  );

  // Scatter Chart Container
  const scatterContainer = el("div", { class: "chart", style: "margin-top: 8px;" });

  root.replaceChildren(controlsBar, hint, message, parallelContainer, summaryBar, scatterContainer);

  // --- Initialize Parallel Coordinates Plot ---
  const parallelCoords = createParallelCoordinates([], {
    dimensions: parallelDims,
    gapBeforeIndex: inputDims.length,
    showControls: true,
    title: "eVTOL Design Space Exploration",
    subtitle: "12 Inputs (left) · 5 Outputs (right) · Status (far right). Drag axes to brush.",
    onFilter: handleParallelFilter,
    onHover: handleHover,
    onClick: handleClick,
  });

  parallelContainer.appendChild(parallelCoords.element);

  // Event Listeners
  runButton.addEventListener("click", runEnsemble);
  sampleMoreBtn.addEventListener("click", sampleMore);
  downloadBtn.addEventListener("click", downloadCsv);
  ldCheckbox.addEventListener("change", (e) => {
    includeLdObjective = e.target.checked;
    updateSelection();
  });

  onResize(scatterContainer, () => data && drawScatter());

  // --- Auto-load Precomputed Ensemble on Startup ---
  loadInitialEnsemble();

  async function loadInitialEnsemble() {
    try {
      const indexList = await apiGet(API.evtol.ensembles);
      if (Array.isArray(indexList) && indexList.length > 0) {
        const currentBase = getBaseline();
        const match =
          indexList.find((e) => e.baseline === currentBase) || indexList[indexList.length - 1];
        if (match && match.ensemble_id) {
          const loaded = await apiGet(API.evtol.collection(match.ensemble_id));
          if (loaded && loaded.rows) {
            setEnsembleData(loaded);
          }
        }
      }
    } catch {
      // Backend may not have prebuilt collections; user can still run on-demand
    }
  }

  function setEnsembleData(newData) {
    data = newData;
    downloadBtn.disabled = !data?.rows?.length;
    parallelCoords.setRows(data.rows);
    selectedIds = new Set(data.rows.map((r) => r.run ?? r.__rowId));
    filters = {};
    updateSampleMoreBtn();
    updateSelection();
  }

  // --- Run On-Demand Ensemble ---
  async function runEnsemble() {
    runButton.disabled = true;
    message.replaceChildren(
      el("div", { class: "loading" }, [
        el("span", { class: "spinner" }),
        `Sizing ${nInput.value} designs…`,
      ])
    );
    try {
      const res = await apiPost(API.evtol.ensemble, {
        baseline: getBaseline(),
        n_samples: Number(nInput.value),
        seed: Number(seedInput.value),
      });
      message.replaceChildren();
      setEnsembleData(res);
    } catch (error) {
      message.replaceChildren(
        el("div", { class: "error-box", role: "alert", text: error.message })
      );
    } finally {
      runButton.disabled = false;
    }
  }

  // --- Sample 50 More Inside Bounds ---
  function getInputBounds() {
    const inputKeys = new Set(inputDims.map((d) => d.key));
    const bounds = {};
    let hasInputBrush = false;
    for (const [key, span] of Object.entries(filters)) {
      if (inputKeys.has(key) && span) {
        hasInputBrush = true;
        const spec = specs.find((p) => p.key === key);
        const lMin = spec.limit_min ?? spec.min;
        const lMax = spec.limit_max ?? spec.max;
        const clampedLo = Math.max(lMin, Math.min(span[0], span[1]));
        const clampedHi = Math.min(lMax, Math.max(span[0], span[1]));
        bounds[key] = [clampedLo, clampedHi];
      }
    }
    return hasInputBrush ? bounds : null;
  }

  function updateSampleMoreBtn() {
    const bounds = getInputBounds();
    const canSample = Boolean(data?.ensemble_id && bounds);
    sampleMoreBtn.disabled = !canSample;
    sampleMoreBtn.title = canSample
      ? "Sample 50 more designs within currently brushed input bounds"
      : "Brush at least one input axis to sample more designs inside those bounds";
  }

  async function sampleMore() {
    if (!data?.ensemble_id) return;
    const bounds = getInputBounds();
    if (!bounds) return;

    sampleMoreBtn.disabled = true;
    message.replaceChildren(
      el("div", { class: "loading" }, [
        el("span", { class: "spinner" }),
        "Sampling 50 more designs inside bounds…",
      ])
    );

    try {
      const res = await apiPost(API.evtol.ensemble, {
        baseline: data.baseline || getBaseline(),
        append_to: data.ensemble_id,
        bounds,
        n_samples: 50,
      });
      message.replaceChildren();

      // Merge newly sized rows
      data.rows = [...data.rows, ...res.rows];
      data.n_samples = res.n_total;
      data.status_counts = res.status_counts;

      // Pulse newly added batch for 2 seconds
      pulsingBatch = res.batch;
      parallelCoords.setRows(data.rows);
      updateSelection();

      setTimeout(() => {
        pulsingBatch = null;
        drawScatter();
      }, 2000);
    } catch (error) {
      message.replaceChildren(
        el("div", { class: "error-box", role: "alert", text: error.message })
      );
    } finally {
      updateSampleMoreBtn();
    }
  }

  // --- Filtering & Selection Update ---
  function handleParallelFilter(newFilters, newSelectedIds) {
    if (suppressParallelCoordsBrush) return;
    filters = { ...newFilters };
    selectedIds = newSelectedIds;
    updateSampleMoreBtn();
    drawScatter();
    updateSummary();
  }

  function updateSelection() {
    // Recompute selection over all rows given active filters
    const activeKeys = Object.keys(filters);
    selectedIds = new Set();
    for (const r of data?.rows || []) {
      let matches = true;
      for (const k of activeKeys) {
        const span = filters[k];
        if (!span) continue;
        const val = r[k];
        if (val == null || !Number.isFinite(Number(val))) {
          matches = false;
          break;
        }
        const [lo, hi] = span;
        if (Number(val) < lo || Number(val) > hi) {
          matches = false;
          break;
        }
      }
      if (matches) {
        selectedIds.add(r.run ?? r.__rowId);
      }
    }
    updateSampleMoreBtn();
    drawScatter();
    updateSummary();
  }

  function updateSummary() {
    if (!data?.rows?.length) {
      summaryText.textContent = "No ensemble loaded.";
      failedBadge.textContent = "0 failed — grey in parallel coordinates";
      return;
    }

    const totalCount = data.rows.length;
    const selectedCount = data.rows.filter((r) => selectedIds.has(r.run ?? r.__rowId)).length;
    const failedInSelection = data.rows.filter(
      (r) =>
        selectedIds.has(r.run ?? r.__rowId) &&
        r.status &&
        r.status !== "converged" &&
        r.status !== "Success"
    ).length;
    const failedTotal = data.rows.filter(
      (r) => r.status && r.status !== "converged" && r.status !== "Success"
    ).length;

    summaryText.textContent = `selected ${selectedCount.toLocaleString()} / ${totalCount.toLocaleString()} · front ${currentFront.length} · failed in selection ${failedInSelection}`;
    failedBadge.textContent = `${failedTotal} failed — grey in parallel coordinates`;
  }

  // --- Linked Hover & Click Handlers ---
  function handleHover(row) {
    const id = row ? row.run ?? row.__rowId : null;
    if (id !== hoveredId) {
      hoveredId = id;
      highlightInScatter(id);
    }
  }

  function handleClick(row) {
    if (!row) return;
    const design = Object.fromEntries(
      specs.map((s) => [s.key, row[s.key] != null ? Number(row[s.key]) : row[s.key]])
    );
    onPickDesign?.(design);
  }

  function highlightInScatter(id) {
    scatterContainer.querySelectorAll(".dot-scatter").forEach((dot) => {
      const dotId = Number(dot.getAttribute("data-id"));
      const isTarget = dotId === id;
      dot.classList.toggle("is-hover", isTarget);
      if (isTarget) {
        dot.parentNode?.appendChild(dot); // Bring to front
      }
    });
  }

  // --- Scatter Plot Drawing ---
  function drawScatter() {
    if (!data?.rows?.length) return;

    // Filter points with valid MTOW and Total Energy
    const validRows = data.rows.filter(
      (r) =>
        typeof r.mtow_kg === "number" &&
        Number.isFinite(r.mtow_kg) &&
        typeof r.total_energy_kw_hr === "number" &&
        Number.isFinite(r.total_energy_kw_hr)
    );

    const brushedSubset = data.rows.filter((r) => selectedIds.has(r.run ?? r.__rowId));

    // Compute Pareto Front on brushed subset
    const objectives = includeLdObjective
      ? [
          { key: "mtow_kg", sense: "min" },
          { key: "total_energy_kw_hr", sense: "min" },
          { key: "cruise_l_p_d", sense: "max" },
        ]
      : [
          { key: "mtow_kg", sense: "min" },
          { key: "total_energy_kw_hr", sense: "min" },
        ];

    currentFront = paretoFront(brushedSubset, objectives);
    const frontIdSet = new Set(currentFront.map((r) => r.run ?? r.__rowId));

    const { svg, inner, width: frameW, height: frameH } = chartFrame(scatterContainer, 420);
    svg.attr("aria-label", "Pareto Scatter: MTOW versus Total Mission Energy");

    const tip = createTooltip(scatterContainer);
    if (!validRows.length) return;

    // Scales
    const xExtent = d3.extent(validRows, (r) => r.mtow_kg);
    const yExtent = d3.extent(validRows, (r) => r.total_energy_kw_hr);
    const ldExtent = d3.extent(validRows, (r) => r.cruise_l_p_d);

    const x = d3.scaleLinear().domain(xExtent).nice().range([0, inner.w]);
    const y = d3.scaleLinear().domain(yExtent).nice().range([inner.h, 0]);
    const colorScale = d3
      .scaleSequential(d3.interpolateViridis)
      .domain([ldExtent[0] ?? 8.5, ldExtent[1] ?? 13.0]);

    const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // Grid & Axes
    g.append("g").call((s) => gridY(s, y, inner.w));
    g.append("g")
      .attr("transform", `translate(0,${inner.h})`)
      .call(d3.axisBottom(x).ticks(8))
      .call(styleAxis);
    g.append("g").call(d3.axisLeft(y).ticks(6)).call(styleAxis);

    axisLabel(svg, "MTOW (kg)", {
      x: MARGIN.left + inner.w / 2,
      y: MARGIN.top + inner.h + 40,
    });
    axisLabel(svg, "Total mission energy (kWh)", {
      x: 18,
      y: MARGIN.top + inner.h / 2,
      rotate: true,
    });

    // Color Legend (Cruise L/D) in top-right of chart
    const legendW = 120;
    const legendH = 10;
    const legendX = inner.w - legendW - 10;
    const legendY = 8;

    const defs = svg.append("defs");
    const gradId = "scatter-ld-grad";
    const gradient = defs
      .append("linearGradient")
      .attr("id", gradId)
      .attr("x1", "0%")
      .attr("x2", "100%")
      .attr("y1", "0%")
      .attr("y2", "0%");

    const stops = 10;
    for (let i = 0; i <= stops; i++) {
      const frac = i / stops;
      const val = (ldExtent[0] ?? 8.5) + frac * ((ldExtent[1] ?? 13.0) - (ldExtent[0] ?? 8.5));
      gradient
        .append("stop")
        .attr("offset", `${frac * 100}%`)
        .attr("stop-color", colorScale(val));
    }

    const legendG = g.append("g").attr("transform", `translate(${legendX},${legendY})`);
    legendG
      .append("rect")
      .attr("width", legendW)
      .attr("height", legendH)
      .attr("rx", 3)
      .attr("fill", `url(#${gradId})`)
      .attr("stroke", "rgba(148, 163, 184, 0.4)");

    legendG
      .append("text")
      .attr("x", 0)
      .attr("y", -3)
      .attr("fill", "var(--text-secondary, #64748b)")
      .attr("font-size", "10px")
      .text(`L/D ${fmt(ldExtent[0] ?? 8.5)}`);

    legendG
      .append("text")
      .attr("x", legendW)
      .attr("y", -3)
      .attr("text-anchor", "end")
      .attr("fill", "var(--text-secondary, #64748b)")
      .attr("font-size", "10px")
      .text(fmt(ldExtent[1] ?? 13.0));

    // 2D Pareto Front Step Line (only for 2-objective optimization)
    if (!includeLdObjective && currentFront.length > 1) {
      const sortedFront = currentFront.slice().sort((a, b) => a.mtow_kg - b.mtow_kg);
      const stepLine = d3
        .line()
        .x((d) => x(d.mtow_kg))
        .y((d) => y(d.total_energy_kw_hr))
        .curve(d3.curveStepAfter);

      g.append("path")
        .datum(sortedFront)
        .attr("fill", "none")
        .attr("stroke", "#38bdf8")
        .attr("stroke-width", 2.5)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round")
        .attr("opacity", 0.9)
        .attr("d", stepLine);
    }

    // Points Group
    const pointsG = g.append("g").attr("class", "scatter-points");

    // Sort valid points so Pareto front and brushed points draw on top
    const sortedPoints = validRows.slice().sort((a, b) => {
      const aId = a.run ?? a.__rowId;
      const bId = b.run ?? b.__rowId;
      const aFront = frontIdSet.has(aId) ? 2 : selectedIds.has(aId) ? 1 : 0;
      const bFront = frontIdSet.has(bId) ? 2 : selectedIds.has(bId) ? 1 : 0;
      return aFront - bFront;
    });

    pointsG
      .selectAll("circle")
      .data(sortedPoints)
      .join("circle")
      .attr("class", (r) => {
        const id = r.run ?? r.__rowId;
        const isHover = id === hoveredId;
        return `dot-scatter ${isHover ? "is-hover" : ""}`;
      })
      .attr("data-id", (r) => r.run ?? r.__rowId)
      .attr("cx", (r) => x(r.mtow_kg))
      .attr("cy", (r) => y(r.total_energy_kw_hr))
      .attr("r", (r) => {
        const id = r.run ?? r.__rowId;
        const isFront = frontIdSet.has(id);
        const isPulsing = pulsingBatch != null && r.batch === pulsingBatch;
        if (isPulsing) return 8;
        if (isFront) return 6.5;
        return 4.5;
      })
      .attr("fill", (r) =>
        typeof r.cruise_l_p_d === "number" && Number.isFinite(r.cruise_l_p_d)
          ? colorScale(r.cruise_l_p_d)
          : "#64748b"
      )
      .attr("fill-opacity", (r) => {
        const id = r.run ?? r.__rowId;
        const isBrushed = selectedIds.has(id);
        const isFront = frontIdSet.has(id);
        if (!isBrushed) return 0.08;
        if (isFront) return 1.0;
        return 0.55;
      })
      .attr("stroke", (r) => {
        const id = r.run ?? r.__rowId;
        const isFront = frontIdSet.has(id);
        const isPulsing = pulsingBatch != null && r.batch === pulsingBatch;
        if (isPulsing) return "#f59e0b";
        if (isFront) return "#ffffff";
        return "transparent";
      })
      .attr("stroke-width", (r) => {
        const id = r.run ?? r.__rowId;
        const isFront = frontIdSet.has(id);
        const isPulsing = pulsingBatch != null && r.batch === pulsingBatch;
        if (isPulsing || isFront) return 2;
        return 0.5;
      })
      .on("pointerenter", function (event, r) {
        const id = r.run ?? r.__rowId;
        hoveredId = id;
        parallelCoords.highlight(id);
        d3.select(this).classed("is-hover", true);
        const [cx, cy] = d3.pointer(event, scatterContainer);
        const isFront = frontIdSet.has(id);
        const lines = specs.map(
          (s) => `${s.label}: ${fmtValue(r[s.key], s)} ${s.unit === "count" ? "" : s.unit}`
        );
        tip.show(
          `<strong>Run ${r.run ?? r.__rowId}</strong> · MTOW ${fmt(r.mtow_kg)} kg · ${fmt(
            r.total_energy_kw_hr
          )} kWh · L/D ${fmt(r.cruise_l_p_d)}` +
            (isFront ? ` <span class="badge" style="color: #38bdf8;">[Pareto Front]</span>` : "") +
            `<br><span class="tip-small">${lines.join("<br>")}</span><br>` +
            `<span class="tip-hint">Click to load this design</span>`,
          cx,
          cy
        );
      })
      .on("pointerleave", function () {
        hoveredId = null;
        parallelCoords.highlight(null);
        d3.select(this).classed("is-hover", false);
        tip.hide();
      })
      .on("click", (event, r) => handleClick(r));

    // 2-D d3.brush on Scatter Plot
    const scatterBrush = d3
      .brush()
      .extent([
        [0, 0],
        [inner.w, inner.h],
      ])
      .on("brush end", (event) => {
        if (suppressScatterBrush) return;
        const selection = event.selection;
        if (selection) {
          const [[x0, y0], [x1, y1]] = selection;
          const mtow0 = x.invert(x0);
          const mtow1 = x.invert(x1);
          const e0 = y.invert(y1);
          const e1 = y.invert(y0);
          filters.mtow_kg = [Math.min(mtow0, mtow1), Math.max(mtow0, mtow1)];
          filters.total_energy_kw_hr = [Math.min(e0, e1), Math.max(e0, e1)];
        } else {
          delete filters.mtow_kg;
          delete filters.total_energy_kw_hr;
        }

        suppressParallelCoordsBrush = true;
        parallelCoords.setFilters(filters);
        suppressParallelCoordsBrush = false;
        updateSelection();
      });

    const brushG = g.append("g").attr("class", "scatter-brush").call(scatterBrush);

    // Double-click to clear scatter brush
    brushG.on("dblclick", () => {
      brushG.call(scatterBrush.move, null);
    });

    // If MTOW and Total Energy are currently brushed, reflect in scatter brush
    if (filters.mtow_kg && filters.total_energy_kw_hr) {
      suppressScatterBrush = true;
      const bx0 = x(filters.mtow_kg[0]);
      const bx1 = x(filters.mtow_kg[1]);
      const by0 = y(filters.total_energy_kw_hr[1]);
      const by1 = y(filters.total_energy_kw_hr[0]);
      brushG.call(scatterBrush.move, [
        [Math.min(bx0, bx1), Math.min(by0, by1)],
        [Math.max(bx0, bx1), Math.max(by0, by1)],
      ]);
      suppressScatterBrush = false;
    }
  }

  // --- CSV Download ---
  function downloadCsv() {
    if (!data?.rows?.length) return;
    const selectedRows = data.rows.filter((r) => selectedIds.has(r.run ?? r.__rowId));
    if (!selectedRows.length) return;

    const frontIdSet = new Set(currentFront.map((r) => r.run ?? r.__rowId));
    const baseCols = Object.keys(data.rows[0]);
    const columns = [...baseCols, "pareto"];

    const escape = (v) =>
      v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

    const csvLines = [
      columns.join(","),
      ...selectedRows.map((r) => {
        const id = r.run ?? r.__rowId;
        const rowWithPareto = {
          ...r,
          pareto: frontIdSet.has(id),
        };
        return columns.map((c) => escape(rowWithPareto[c])).join(",");
      }),
    ];

    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = el("a", {
      href: url,
      download: `evtol-ensemble-${data.baseline || getBaseline()}-${selectedRows.length}-designs.csv`,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    setEnsembleData,
    destroy() {
      parallelCoords.destroy();
    },
  };
}
