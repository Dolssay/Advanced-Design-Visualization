// Parameter form built from /api/v1/evtol/parameters.
// Holds the current design; only values that differ from the baseline are sent
// as overrides. Sliders span the slider range (limit_min/limit_max, widened to
// include the loaded baseline's value), and each track is shaded by the
// feasibility slice the server streams for it (setFeasibility).

import { el, fmtValue, withUnit } from "./format.js";
import { STATUS_LABEL, fmtEdge, segmentAt, shortReason, trackLayers } from "./feasibilityModel.js";

export function createParameterForm(container, catalogue, { onChange } = {}) {
  const specs = catalogue.parameters;
  const controls = new Map();
  const feasibility = new Map(); // key -> { slice, stale } | null
  let baseline = {};
  let values = {};

  for (const group of catalogue.groups) {
    const members = specs.filter((p) => p.group === group);
    if (!members.length) continue;
    const fieldset = el("fieldset", { class: "param-group" }, [el("legend", { text: group })]);
    for (const spec of members) fieldset.append(buildRow(spec));
    container.append(fieldset);
  }

  function buildRow(spec) {
    const id = `param-${spec.key}`;
    const slider = el("input", {
      type: "range", min: spec.limit_min, max: spec.limit_max, step: spec.step,
      "aria-label": spec.label, class: "param-slider"
    });
    const number = el("input", {
      type: "number", id, min: spec.limit_min, max: spec.limit_max, step: spec.integer ? 1 : "any", class: "param-number"
    });
    const marker = el("span", { class: "param-changed", title: "Changed from baseline", "aria-hidden": "true" });
    const note = el("span", { class: "param-note" });
    const tip = el("div", { class: "param-tip", hidden: true, "aria-hidden": "true" });
    const row = el("div", { class: "param-row is-pending" }, [
      el("label", { for: id, class: "param-label", title: spec.description }, [
        marker, spec.label, spec.unit && spec.unit !== "count" ? el("span", { class: "param-unit", text: ` (${spec.unit})` }) : null
      ]),
      el("div", { class: "param-inputs" }, [slider, number]),
      note,
      tip
    ]);

    const set = (raw, source) => {
      let v = Number(raw);
      if (!Number.isFinite(v)) return;
      if (spec.integer) v = Math.round(v);
      values[spec.key] = v;
      if (source !== "slider") slider.value = v;
      if (source !== "number") number.value = fmtValue(v, spec);
      refresh(spec.key);
      onChange?.(getDesign(), spec.key);
    };
    slider.addEventListener("input", () => set(slider.value, "slider"));
    number.addEventListener("change", () => set(number.value, "number"));
    slider.addEventListener("pointermove", (event) => showTip(spec.key, event));
    slider.addEventListener("pointerleave", () => { tip.hidden = true; });
    controls.set(spec.key, { spec, slider, number, row, note, tip, set, range: [spec.limit_min, spec.limit_max] });
    return row;
  }

  function showTip(key, event) {
    const { spec, slider, tip, range: [lo, hi] } = controls.get(key);
    const entry = feasibility.get(key);
    if (!entry) { tip.hidden = true; return; }
    const rect = slider.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const seg = segmentAt(entry.slice, lo + f * (hi - lo));
    if (!seg) { tip.hidden = true; return; }
    const unit = spec.unit === "count" ? "" : spec.unit;
    const why = seg.reason ? `: ${shortReason(seg.reason)}` : "";
    tip.textContent = `${fmtEdge(seg.lo, spec)}–${withUnit(fmtEdge(seg.hi, spec), unit)} · ${STATUS_LABEL[seg.status] || seg.status}${why}${entry.stale ? " (re-checking)" : ""}`;
    tip.style.left = `${Math.round(f * rect.width)}px`;
    tip.hidden = false;
  }

  function refresh(key) {
    const { spec, row, note } = controls.get(key);
    const v = values[key];
    const changed = Math.abs(v - baseline[key]) > 1e-9;
    row.classList.toggle("is-changed", changed);
    note.textContent = changed ? `Baseline: ${withUnit(fmtValue(baseline[key], spec), spec.unit === "count" ? "" : spec.unit)}` : "";
    const entry = feasibility.get(key);
    const seg = entry ? segmentAt(entry.slice, v) : null;
    row.classList.toggle("is-infeasible", Boolean(seg && seg.status !== "converged"));
  }

  // The slider range of one parameter: the catalogue's limit_min/limit_max,
  // widened just enough to include the baseline's own value (same rule as
  // effective_range() on the backend).
  function setRange(key, baselineValue) {
    const control = controls.get(key);
    const { spec, slider, number } = control;
    const lo = Math.min(spec.limit_min, baselineValue);
    const hi = Math.max(spec.limit_max, baselineValue);
    control.range = [lo, hi];
    slider.min = lo; slider.max = hi;
    number.min = lo; number.max = hi;
    paint(key);
  }

  function paint(key) {
    const { slider, row, range: [lo, hi] } = controls.get(key);
    const entry = feasibility.get(key);
    row.classList.toggle("is-pending", !entry);
    row.classList.toggle("is-stale", Boolean(entry?.stale));
    if (entry) slider.style.setProperty("--track", trackLayers(entry.slice, lo, hi));
    else slider.style.removeProperty("--track");
  }

  function setValues(next, { asBaseline = false } = {}) {
    if (asBaseline) {
      baseline = { ...next };
      for (const key of Object.keys(next)) if (controls.has(key)) setRange(key, next[key]);
    }
    values = { ...values, ...next };
    for (const [key, { slider, number, spec }] of controls) {
      if (!(key in values)) continue;
      slider.value = values[key];
      number.value = fmtValue(values[key], spec);
      refresh(key);
    }
    const keys = Object.keys(next);
    onChange?.(getDesign(), !asBaseline && keys.length === 1 ? keys[0] : null);
  }

  // entry = { slice, stale } from the feasibility stream, or null while unknown.
  function setFeasibility(key, entry) {
    if (!controls.has(key)) return;
    if (entry) feasibility.set(key, entry);
    else feasibility.delete(key);
    paint(key);
    refresh(key);
  }

  function getDesign() {
    return { ...values };
  }

  function getOverrides() {
    const overrides = {};
    for (const [key, v] of Object.entries(values)) {
      if (Math.abs(v - baseline[key]) > 1e-9) overrides[key] = v;
    }
    return overrides;
  }

  return {
    setValues, getDesign, getOverrides, setFeasibility, specs,
    range: (key) => controls.get(key).range,
    getBaseline: () => ({ ...baseline })
  };
}

// Mirrors check_constraints() in backend/app/services/evtol_model.py for live
// feedback. The backend's warnings in the size response stay authoritative.
export function constraintWarnings(d) {
  const out = [];
  if (d.wingspan_m > d.d_value_m) out.push({ id: "C1", message: `Wingspan ${d.wingspan_m} m exceeds D-value ${d.d_value_m} m.` });
  if (d.fuselage_l_m < d.fuselage_w_m) out.push({ id: "C2", message: "Fuselage is wider than it is long." });
  if (d.fuselage_l_m > d.d_value_m) out.push({ id: "C3", message: `Fuselage length ${d.fuselage_l_m} m exceeds D-value ${d.d_value_m} m.` });
  const n = d.lift_rotor_count;
  if (n) {
    const need = d.rotor_diameter_m * n + (n - 2) * 0.1;
    if (need > d.wingspan_m + 1e-9) out.push({ id: "C6", message: `${n} rotors of ${d.rotor_diameter_m} m need ${need.toFixed(2)} m of span; wingspan is ${d.wingspan_m} m.` });
  }
  return out;
}
