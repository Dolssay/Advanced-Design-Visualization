// Parameter form built from /api/v1/evtol/parameters.
// Holds the current design; only values that differ from the baseline are sent
// as overrides, so a baseline outside the study bounds can still be sized as-is.

import { el, fmtValue, withUnit } from "./format.js";

export function createParameterForm(container, catalogue, { onChange } = {}) {
  const specs = catalogue.parameters;
  const controls = new Map();
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
      type: "range", min: spec.min, max: spec.max, step: spec.step,
      "aria-label": spec.label, class: "param-slider"
    });
    const number = el("input", {
      type: "number", id, min: spec.min, max: spec.max, step: spec.integer ? 1 : "any", class: "param-number"
    });
    const marker = el("span", { class: "param-changed", title: "Changed from baseline", "aria-hidden": "true" });
    const note = el("span", { class: "param-note" });
    const row = el("div", { class: "param-row" }, [
      el("label", { for: id, class: "param-label", title: spec.description }, [
        marker, spec.label, spec.unit && spec.unit !== "count" ? el("span", { class: "param-unit", text: ` (${spec.unit})` }) : null
      ]),
      el("div", { class: "param-inputs" }, [slider, number]),
      note
    ]);

    const set = (raw, source) => {
      let v = Number(raw);
      if (!Number.isFinite(v)) return;
      if (spec.integer) v = Math.round(v);
      values[spec.key] = v;
      if (source !== "slider") slider.value = v;
      if (source !== "number") number.value = fmtValue(v, spec);
      refresh(spec.key);
      onChange?.(getDesign());
    };
    slider.addEventListener("input", () => set(slider.value, "slider"));
    number.addEventListener("change", () => set(number.value, "number"));
    controls.set(spec.key, { spec, slider, number, row, note, set });
    return row;
  }

  function refresh(key) {
    const { spec, row, note } = controls.get(key);
    const v = values[key];
    const changed = Math.abs(v - baseline[key]) > 1e-9;
    const outside = v < spec.min - 1e-9 || v > spec.max + 1e-9;
    row.classList.toggle("is-changed", changed);
    row.classList.toggle("is-outside", outside);
    note.textContent = outside
      ? `Baseline value ${fmtValue(v, spec)} is outside the study range ${spec.min}–${spec.max}.`
      : changed ? `Baseline: ${withUnit(fmtValue(baseline[key], spec), spec.unit === "count" ? "" : spec.unit)}` : "";
  }

  function setValues(next, { asBaseline = false } = {}) {
    if (asBaseline) baseline = { ...next };
    values = { ...values, ...next };
    for (const [key, { slider, number, spec }] of controls) {
      if (!(key in values)) continue;
      slider.value = values[key];
      number.value = fmtValue(values[key], spec);
      refresh(key);
    }
    onChange?.(getDesign());
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

  return { setValues, getDesign, getOverrides, specs };
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
