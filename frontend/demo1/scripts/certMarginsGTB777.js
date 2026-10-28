// GTB777 certification margins (14 CFR Part 25).
// Top: a scorecard of the designs in the Content box's highlighted list, each
// requirement's value, margin bar and margin. Below: one card per section of the
// regulation, the median margin to each limit by feasibility label with a
// 10th-90th percentile whisker. The requirements and limits come from
// certRequirements.json, shared with the Python data prep.
import certSpec from "./certRequirements.json";
import { LABEL_DOMAIN, LABEL_COLORS, SELECTION_COLOR } from "./gtb777Dimensions.js";
import { getGTB777SketchColor } from "./sketchGTB777.js";
import { cssVar } from "./colorUtils.js";

const REQUIREMENTS = certSpec.requirements;
const SECTIONS = certSpec.sections;
const NS = "http://www.w3.org/2000/svg";
// Scorecard columns: more designs than this are listed as "+N more"
const MAX_SCORECARD_DESIGNS = 4;
// The scorecard's mini bars stop at this margin; the number beside them is exact
const MINI_BAR_CAP = 50;
// Card order per column count, so cards that share a row hold a similar number of
// requirements (1, 1, 1 | 3, 4, 2 with three columns; 1, 1 | 1, 2 | 3, 4 with two)
const CARD_ORDER = {
  1: ["Mission", "§25.107", "§25.121", "§25.125", "§25.143", "§25.181"],
  2: ["Mission", "§25.125", "§25.143", "§25.181", "§25.107", "§25.121"],
  3: ["Mission", "§25.125", "§25.143", "§25.107", "§25.121", "§25.181"]
};

export function marginOf(requirement, value) {
  return requirement.limit === 0
    ? value - requirement.limit
    : ((value - requirement.limit) / Math.abs(requirement.limit)) * 100;
}

export function passesLimit(requirement, value) {
  return requirement.op === ">" ? value > requirement.limit : value >= requirement.limit;
}

function marginUnit(requirement) {
  return requirement.limit === 0 ? " pts" : "%";
}

function signed(value, digits = 1) {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return (value > 0 ? "+" : "−") + text;
}

function formatValue(requirement, value) {
  const text = value.toLocaleString("en-US", {
    minimumFractionDigits: requirement.dp,
    maximumFractionDigits: requirement.dp
  });
  return (value < 0 ? text.replace("-", "−") : text) + requirement.unit;
}

function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

function sectionName(section) {
  return section.code === "Mission" ? section.title : `${section.code} ${section.title}`;
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

// Per requirement: failures in the whole subset, and per label the 10th, 50th and
// 90th percentile of the margin.
function computeStats(data) {
  return REQUIREMENTS.map((requirement) => {
    const byLabel = new Map(LABEL_DOMAIN.map((label) => [label, []]));
    let fails = 0;
    for (const row of data) {
      const value = row[requirement.column];
      if (value == null || !Number.isFinite(value)) continue;
      if (!passesLimit(requirement, value)) fails++;
      byLabel.get(row.Label)?.push(marginOf(requirement, value));
    }
    const stats = {};
    for (const [label, values] of byLabel) {
      values.sort((a, b) => a - b);
      stats[label] = {
        n: values.length,
        p10: quantile(values, 0.1),
        p50: quantile(values, 0.5),
        p90: quantile(values, 0.9)
      };
    }
    return { requirement, fails, stats };
  });
}

// Round, even axis steps that include the limit (0)
function niceDomain(values) {
  let low = Math.min(0, ...values);
  let high = Math.max(0, ...values);
  if (low === high) high = low + 1;
  const span = high - low;
  const magnitude = Math.pow(10, Math.floor(Math.log10(span)));
  const ratio = span / magnitude;
  const step = magnitude * (ratio > 5 ? 2 : ratio > 2 ? 1 : 0.5);
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  return { low, high, step };
}

export function createCertificationMargins(data, controller = null, contentController = null) {
  const statsByColumn = new Map(computeStats(data).map((entry) => [entry.requirement.column, entry]));
  const rowsById = new Map(data.map((row) => [`point-${row.__rowId}`, row]));
  const labelColor = new Map(LABEL_DOMAIN.map((label, index) => [label, LABEL_COLORS[index]]));
  const total = data.length;

  const container = document.createElement("div");
  container.className = "cert-container";

  const header = document.createElement("div");
  header.className = "cert-header";
  header.innerHTML = `
    <div class="cert-title">GTB777 Certification Margins (14 CFR Part 25)</div>
    <div class="cert-subtitle">Margin to each limit: how far a design sits past it, as a percentage of the limit
      (percentage points where the limit is 0). Highlighted designs first, then every design by feasibility label.</div>`;

  // --- Scorecard of the highlighted designs ---
  const scorecard = document.createElement("div");
  scorecard.className = "cert-card cert-scorecard";
  const scorecardHead = document.createElement("div");
  scorecardHead.className = "cert-card-head";
  const scorecardTitle = document.createElement("h3");
  scorecardTitle.textContent = "Highlighted designs against each limit";
  const scorecardNote = document.createElement("p");
  scorecardNote.className = "cert-note";
  scorecardHead.append(scorecardTitle, scorecardNote);
  const scorecardBody = document.createElement("div");
  scorecardBody.className = "cert-scorecard-body";
  scorecard.append(scorecardHead, scorecardBody);

  // --- Finding and margin cards ---
  const finding = document.createElement("p");
  finding.className = "cert-finding";
  const cards = document.createElement("div");
  cards.className = "cert-cards";
  const legend = document.createElement("div");
  legend.className = "cert-legend";

  container.append(header, scorecard, finding, cards, legend);

  function getVisibleLabels() {
    return contentController ? contentController.getSelectedLabels() : new Set(LABEL_DOMAIN);
  }

  function getChosenDesigns() {
    const pinned = contentController?.getPinnedPointSummaries?.(controller) ?? [];
    const drawn = controller?.getDrawnPointIds?.() ?? new Set();
    // Drawn designs first, in the Content box's own order, so their colours lead
    const ordered = [...pinned.filter((p) => drawn.has(p.id)), ...pinned.filter((p) => !drawn.has(p.id))];
    return ordered
      .map((point) => {
        const row = rowsById.get(point.id);
        if (!row) return null;
        const colorIndex = drawn.has(point.id) ? controller?.getDrawnPointColorIndex?.(point.id) : null;
        return {
          point,
          row,
          color: colorIndex != null ? getGTB777SketchColor(colorIndex) : SELECTION_COLOR,
          drawn: colorIndex != null
        };
      })
      .filter(Boolean);
  }

  function renderScorecard() {
    const designs = getChosenDesigns();
    scorecardBody.replaceChildren();
    if (!designs.length) {
      scorecardNote.textContent = "";
      const empty = document.createElement("div");
      empty.className = "cert-empty";
      empty.innerHTML = `<strong>No design highlighted yet</strong>Click a point in the scatterplot matrix or a
        line in the parallel plot to add it to Manage Highlighted Points; its margin to every Part 25 limit shows here.`;
      scorecardBody.appendChild(empty);
      return;
    }

    const shown = designs.slice(0, MAX_SCORECARD_DESIGNS);
    const hidden = designs.length - shown.length;
    scorecardNote.textContent = hidden > 0
      ? `Showing ${shown.length} of ${designs.length} highlighted designs, drawn ones first.`
      : "Value in the requirement's own units, then the margin to its limit.";

    const table = document.createElement("table");
    table.className = "cert-table";
    const head = table.createTHead().insertRow();
    for (const text of ["Section", "Requirement", "Limit"]) {
      const th = document.createElement("th");
      th.textContent = text;
      head.appendChild(th);
    }
    for (const design of shown) {
      const fails = REQUIREMENTS.filter((r) => !passesLimit(r, design.row[r.column])).length;
      const th = document.createElement("th");
      th.colSpan = 3;
      th.className = "cert-design-head";
      th.innerHTML = `<span class="cert-swatch" style="background:${design.color}"></span>` +
        `#${design.point.index} · ${design.row.Label}` +
        (fails ? ` <span class="cert-fail-count">${fails} fail</span>` : "");
      head.appendChild(th);
    }

    const body = table.createTBody();
    let previousSection = null;
    for (const requirement of REQUIREMENTS) {
      const tr = body.insertRow();
      const section = SECTIONS.find((s) => s.code === requirement.section);
      const sectionCell = tr.insertCell();
      sectionCell.className = "cert-section-cell";
      sectionCell.textContent = requirement.section === previousSection ? "" : (section.code === "Mission" ? "Mission" : section.code);
      previousSection = requirement.section;
      tr.insertCell().textContent = requirement.name;
      tr.insertCell().textContent = requirement.limitText;

      for (const design of shown) {
        const value = design.row[requirement.column];
        const margin = marginOf(requirement, value);
        const fail = !passesLimit(requirement, value);
        const valueCell = tr.insertCell();
        valueCell.className = "cert-num" + (fail ? " cert-fail" : "");
        valueCell.textContent = formatValue(requirement, value);

        // Mini bar centred on the limit, then the margin to its right
        const barCell = tr.insertCell();
        barCell.className = "cert-bar-cell";
        const bar = document.createElement("div");
        bar.className = "cert-mini";
        const fill = document.createElement("span");
        const width = (Math.min(MINI_BAR_CAP, Math.abs(margin)) / MINI_BAR_CAP) * 50;
        fill.style.width = `${width}%`;
        fill.style[margin >= 0 ? "left" : "right"] = "50%";
        // Grey when it passes, red when it fails; the design's own colour is on its header,
        // since a red drawing colour would read as a failure here
        fill.style.background = fail ? cssVar("--danger", "#a3271d") : cssVar("--faint", "#9a9a95");
        const limitTick = document.createElement("i");
        bar.append(fill, limitTick);
        barCell.appendChild(bar);

        const marginCell = tr.insertCell();
        marginCell.className = "cert-num cert-margin" + (fail ? " cert-fail" : "");
        marginCell.textContent = signed(margin) + marginUnit(requirement);
      }
    }
    scorecardBody.appendChild(table);
  }

  function renderFinding() {
    const entries = [...statsByColumn.values()];
    const worst = entries.reduce((a, b) => (b.fails > a.fails ? b : a));
    const clearSections = SECTIONS.filter((section) =>
      entries.every((e) => e.requirement.section !== section.code || e.fails === 0)
    ).map((section) => section.code);
    const worstSection = SECTIONS.find((s) => s.code === worst.requirement.section);
    finding.innerHTML =
      `<strong>${worstSection.code} ${worst.requirement.name.toLowerCase()} limits the design:</strong> ` +
      `${worst.fails.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} designs fall short of ` +
      `${worst.requirement.limitText}.` +
      (clearSections.length ? ` Every ${clearSections.join(" and ")} check passes.` : "");
  }

  function verdictFor(section) {
    const entries = REQUIREMENTS.filter((r) => r.section === section.code).map((r) => statsByColumn.get(r.column));
    const worst = entries.reduce((a, b) => (b.fails > a.fails ? b : a));
    if (!worst.fails) {
      let tightest = Infinity;
      let unit = "%";
      for (const entry of entries) {
        for (const label of LABEL_DOMAIN) {
          if (entry.stats[label].p10 < tightest) {
            tightest = entry.stats[label].p10;
            unit = marginUnit(entry.requirement);
          }
        }
      }
      return { bad: false, text: `Every design passes; tightest 10th-percentile margin ${signed(tightest)}${unit}.` };
    }
    const share = ((worst.fails / total) * 100).toFixed(1);
    return {
      bad: true,
      text: `${worst.fails.toLocaleString("en-US")} designs fail ${worst.requirement.name.toLowerCase()} (${share}%).`
    };
  }

  // Grouped horizontal bars for one section: a row per requirement, a bar per
  // visible label from the limit to the median margin, a whisker for the
  // 10th-90th percentile. Drawn at the card's real width so text stays 11-12px.
  function sectionChart(section, width, slots, visibleLabels) {
    const entries = REQUIREMENTS.filter((r) => r.section === section.code).map((r) => statsByColumn.get(r.column));
    const labels = LABEL_DOMAIN.filter((label) => visibleLabels.has(label));
    const barPitch = 9;
    const rowBase = Math.max(1, labels.length) * barPitch + 24;
    const top = 20;
    const height = top + slots * rowBase + 4;
    const rowH = (slots * rowBase) / entries.length;
    const values = entries.flatMap((e) => labels.flatMap((l) => [e.stats[l].p10, e.stats[l].p90])).filter(Number.isFinite);
    const domain = niceDomain(values.length ? values : [0, 1]);
    const x = (v) => ((v - domain.low) / (domain.high - domain.low)) * (width - 8);
    const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img",
      "aria-label": `${sectionName(section)}: median margin to each limit by label` });

    const ticks = [];
    for (let t = domain.low; t <= domain.high + domain.step / 1e6; t += domain.step) ticks.push(+t.toFixed(6));
    // Keep at most 6 tick labels so they never touch
    const labelEvery = Math.ceil(ticks.length / 6);
    ticks.forEach((t, i) => {
      if (i % labelEvery === 0) {
        svg.append(svgEl("text", { x: x(t), y: 11, "text-anchor": "middle", class: "cert-tick" },
          (t > 0 ? "+" : t < 0 ? "−" : "") + Math.abs(t)));
      }
    });

    entries.forEach((entry, r) => {
      const y0 = top + r * rowH;
      const barsTop = y0 + 17;
      const barsBottom = barsTop + labels.length * barPitch;
      svg.append(svgEl("text", { x: 0, y: y0 + 11, class: "cert-row-label" },
        `${entry.requirement.name} ${entry.requirement.limitText}`));
      for (const t of ticks) {
        svg.append(svgEl("line", { x1: x(t), x2: x(t), y1: barsTop - 2, y2: barsBottom, class: "cert-grid" }));
      }
      labels.forEach((label, j) => {
        const s = entry.stats[label];
        if (!s.n) return;
        const y = barsTop + j * barPitch;
        const bar = svgEl("rect", {
          x: Math.min(x(0), x(s.p50)), y, width: Math.max(1, Math.abs(x(s.p50) - x(0))), height: 6, fill: labelColor.get(label)
        });
        bar.append(svgEl("title", {}, `${label}: median ${signed(s.p50, 2)}${marginUnit(entry.requirement)} ` +
          `(10th ${signed(s.p10, 2)}, 90th ${signed(s.p90, 2)}), n = ${s.n.toLocaleString("en-US")}`));
        svg.append(bar);
        svg.append(svgEl("line", { x1: x(s.p10), x2: x(s.p90), y1: y + 3, y2: y + 3, class: "cert-whisker" }));
      });
      // The limit, per row, so it never crosses a row's label
      svg.append(svgEl("line", { x1: x(0), x2: x(0), y1: barsTop - 2, y2: barsBottom, class: "cert-limit" }));
    });
    return svg;
  }

  function renderCards() {
    const visibleLabels = getVisibleLabels();
    const width = cards.clientWidth;
    if (!width) return; // not laid out yet; the resize observer renders it
    const columns = width >= 840 ? 3 : width >= 540 ? 2 : 1;
    const gap = 12;
    const chartWidth = Math.floor((width - gap * (columns - 1)) / columns) - 32;
    const ordered = CARD_ORDER[columns].map((code) => SECTIONS.find((s) => s.code === code));
    const counts = ordered.map((s) => REQUIREMENTS.filter((r) => r.section === s.code).length);

    cards.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    cards.replaceChildren();
    ordered.forEach((section, i) => {
      // Cards that share a row share a height: give each chart its row's row count
      const rowStart = i - (i % columns);
      const slots = Math.max(...counts.slice(rowStart, rowStart + columns));
      const verdict = verdictFor(section);
      const card = document.createElement("div");
      card.className = "cert-card";
      const title = document.createElement("h3");
      title.textContent = sectionName(section);
      const note = document.createElement("p");
      note.className = "cert-note" + (verdict.bad ? " cert-note-bad" : "");
      note.textContent = verdict.text;
      card.append(title, note, sectionChart(section, chartWidth, slots, visibleLabels));
      cards.appendChild(card);
    });

    legend.innerHTML = LABEL_DOMAIN.filter((label) => visibleLabels.has(label))
      .map((label) => `<span><i style="background:${labelColor.get(label)}"></i>${label} ` +
        `(n = ${statsByColumn.get(REQUIREMENTS[0].column).stats[label].n.toLocaleString("en-US")})</span>`)
      .join("") + `<span><i class="cert-legend-whisker"></i>10th–90th percentile</span>` +
      `<span><i class="cert-legend-limit"></i>limit</span>`;
  }

  renderScorecard();
  renderFinding();
  // Redraw on a width change only: a redraw changes the height, not the width
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (cards.clientWidth !== lastWidth) {
      lastWidth = cards.clientWidth;
      renderCards();
    }
  }).observe(cards);

  contentController?.subscribe?.((event) => {
    if (event.type === "labels") renderCards();
  });
  controller?.subscribe?.((event) => {
    if (event.type === "pins" || event.type === "drawPoints" || event.type === "pinnedHighlight") renderScorecard();
  });

  return container;
}
