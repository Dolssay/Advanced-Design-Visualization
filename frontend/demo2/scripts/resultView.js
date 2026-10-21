// Result tab: KPIs against the baseline, warnings, and the five server-rendered plots.

import { API } from "../../shared/api/endpoints.js";
import { el, fmt, signed } from "./format.js";

const KPIS = [
  { key: "mtow", label: "MTOW", unit: "kg", digits: 1, get: (r) => r.mtow_kg },
  { key: "energy", label: "Total energy", unit: "kWh", digits: 1, get: (r) => r.energy_kw_hr?.total },
  { key: "battery", label: "Battery mass", unit: "kg", digits: 1, get: (r) => r.masses_kg?.battery },
  { key: "empty", label: "Empty mass", unit: "kg", digits: 1, get: (r) => r.masses_kg?.empty },
  { key: "ld", label: "Cruise L/D", unit: "", digits: 2, get: (r) => r.aero?.cruise_l_p_d }
];

export function createResultView(root, { onSize } = {}) {
  let activeImage = "layout";
  // Shown beside the plot tabs when the inputs moved since this run was drawn.
  const staleNote = el("p", { class: "stale-note", role: "status", hidden: true }, [
    el("span", { class: "stale-dot", "aria-hidden": "true" }),
    "Showing the last sized design, not the current inputs",
    el("button", { class: "stale-action", type: "button", text: "Size now", onclick: () => onSize?.() })
  ]);
  root.replaceChildren(el("p", { class: "empty-state", text: "Size a design to see results." }));

  function renderLoading(message = "Sizing on the server…") {
    root.classList.remove("is-pending");
    root.replaceChildren(el("div", { class: "loading" }, [el("span", { class: "spinner", "aria-hidden": "true" }), message]));
  }

  // Auto-size: a new run is on its way; dim the current cards instead of clearing them.
  function setPending(on) {
    root.classList.toggle("is-pending", on);
    root.setAttribute("aria-busy", on ? "true" : "false");
  }

  function setStale(on) {
    staleNote.hidden = !on;
  }

  function hasResult() {
    return Boolean(root.querySelector(".kpi-row"));
  }

  function renderError(error) {
    root.classList.remove("is-pending");
    root.setAttribute("aria-busy", "false");
    const detail = error.detail || {};
    const title = detail.code === "sizing_failed"
      ? `This design did not size (${detail.status}).`
      : detail.code === "invalid_overrides" ? "Some inputs are not valid." : "Request failed.";
    root.replaceChildren(el("div", { class: "error-box", role: "alert" }, [
      el("strong", { text: title }),
      el("p", { text: error.message }),
      detail.code === "sizing_failed"
        ? el("p", { class: "hint", text: "evtolpy's MTOW iteration diverges for physically inconsistent designs. Try moving the last input back toward the baseline, or use the Sweep tab to see where it fails." })
        : null
    ]));
  }

  function render(run, reference) {
    root.classList.remove("is-pending");
    root.setAttribute("aria-busy", "false");
    const r = run.result;
    const ref = reference?.result;
    const isReference = reference && reference.run_id === run.run_id;

    const kpis = el("div", { class: "kpi-row" }, KPIS.map((k) => {
      const value = k.get(r);
      const base = ref ? k.get(ref) : null;
      const delta = !isReference && value != null && base != null ? value - base : null;
      const pct = delta != null && base ? (delta / base) * 100 : null;
      return el("div", { class: "kpi" }, [
        el("span", { class: "kpi-label", text: k.label }),
        el("span", { class: "kpi-value" }, [fmt(value, k.digits), k.unit ? el("span", { class: "kpi-unit", text: ` ${k.unit}` }) : null]),
        el("span", { class: "kpi-delta", text: delta == null ? (isReference ? "baseline" : "") : `${signed(delta, k.digits)} (${signed(pct, 1)}%) vs baseline` })
      ]);
    }));

    const statusLine = el("p", { class: "run-meta" }, [
      r.status === "Success" ? `Converged in ${r.iterations} iterations` : `${r.status}: ${r.message}`,
      " · ",
      run.cached ? "cached result" : "new run",
      " · ",
      el("a", { href: API.evtol.run(run.run_id), target: "_blank", rel: "noopener", text: `run ${run.run_id}` })
    ]);

    const warnings = run.warnings?.length
      ? el("ul", { class: "warnings" }, run.warnings.map((w) => el("li", {}, [el("strong", { text: `${w.id} ` }), w.message])))
      : null;

    const imageTabs = el("div", { class: "image-tabs", role: "tablist", "aria-label": "Plots" });
    const figure = el("figure", { class: "plot-figure" });
    const busy = el("div", { class: "plot-busy", "aria-hidden": "true" }, [el("span", { class: "spinner" }), "Sizing new design…"]);
    const showImage = (kind) => {
      activeImage = kind;
      const image = run.images.find((i) => i.kind === kind) || run.images[0];
      for (const b of imageTabs.children) {
        const on = b.dataset.kind === image.kind;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
      }
      figure.replaceChildren(
        el("img", { src: image.url, alt: `${image.label} for run ${run.run_id}`, loading: "lazy" }),
        el("figcaption", {}, [image.label, " · ", el("a", { href: image.url, target: "_blank", rel: "noopener", text: "open PNG" })])
      );
    };
    for (const image of run.images) {
      imageTabs.append(el("button", { class: "image-tab", role: "tab", "data-kind": image.kind, type: "button", text: image.label, onclick: () => showImage(image.kind) }));
    }

    const plotHead = el("div", { class: "plot-head" }, [imageTabs, staleNote]);
    root.replaceChildren(...[kpis, statusLine, warnings, el("div", { class: "card plot-card" }, [plotHead, figure, busy])].filter(Boolean));
    if (run.images.length) showImage(run.images.some((i) => i.kind === activeImage) ? activeImage : run.images[0].kind);
  }

  return { render, renderLoading, renderError, setPending, setStale, hasResult };
}
