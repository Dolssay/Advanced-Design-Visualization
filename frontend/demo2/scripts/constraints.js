// Read-only "Layout constraints" box under the reasons banner: the C1-C6 rules
// with the current values filled in. C1-C3 and C6 pass/fail comes from
// constraintWarnings(), the same check as the banner. C4/C5 (rotor-count
// coupling) are not in the banner: apply_overrides() sets tilt = lift and
// total = lift + tilt whenever lift rotors change, so only an unchanged
// baseline can break them (Joby S4, Wisk, NASA LC, EHang do).

import { el } from "./format.js";
import { constraintWarnings } from "./form.js";

const m = (v) => `${+Number(v).toFixed(2)} m`;
const AUTO = "Set automatically when you change Lift rotors.";
const RULES = [
  { id: "C1", rule: "Wingspan ≤ D-value", now: (d) => `${m(d.wingspan_m)} vs ${m(d.d_value_m)}` },
  { id: "C2", rule: "Fuselage length ≥ fuselage width", now: (d) => `${m(d.fuselage_l_m)} vs ${m(d.fuselage_w_m)}` },
  { id: "C3", rule: "Fuselage length ≤ D-value", now: (d) => `${m(d.fuselage_l_m)} vs ${m(d.d_value_m)}` },
  {
    id: "C4", rule: "Total rotors = lift + tilt rotors", note: AUTO,
    now: (d, r) => `${r.lift} + ${r.tilt} vs ${r.total}`, fails: (d, r) => r.lift + r.tilt !== r.total
  },
  { id: "C5", rule: "Tilt rotors = lift rotors", note: AUTO, now: (d, r) => `${r.tilt} vs ${r.lift}`, fails: (d, r) => r.tilt !== r.lift },
  {
    id: "C6", rule: "Lift rotors fit the wing: count × diameter + 0.1 m per gap ≤ wingspan",
    now: (d) => d.lift_rotor_count
      ? `${m(d.rotor_diameter_m * d.lift_rotor_count + (d.lift_rotor_count - 2) * 0.1)} vs ${m(d.wingspan_m)}`
      : "no lift rotors"
  }
];

export function createConstraintsBox(root) {
  let baselineRotors = { lift_rotor_count: 0, tilt_rotor_count: 0, rotor_count: 0 };
  const count = el("span", { class: "constraints-count" });
  const list = el("ul", { class: "constraints-list" });
  root.replaceChildren(
    el("summary", { class: "constraints-summary" }, [el("span", { text: "Layout constraints" }), count]),
    list,
    el("p", { class: "constraints-note", text: "Checked live against the inputs below. Read-only for now." })
  );

  // Rotor counts as the backend will size them (mirrors apply_overrides()).
  function rotors(design) {
    const b = baselineRotors;
    const lift = design.lift_rotor_count ?? b.lift_rotor_count;
    if (lift !== b.lift_rotor_count) return { lift, tilt: lift, total: 2 * lift };
    return { lift, tilt: b.tilt_rotor_count, total: b.rotor_count };
  }

  function render(design) {
    const r = rotors(design);
    const failing = new Set(constraintWarnings(design).map((w) => w.id));
    for (const rule of RULES) if (rule.fails?.(design, r)) failing.add(rule.id);
    count.textContent = failing.size ? `${failing.size} failing` : "all met";
    count.classList.toggle("is-failing", failing.size > 0);
    list.replaceChildren(...RULES.map((rule) => el("li", { class: `constraint${failing.has(rule.id) ? " is-failing" : ""}` }, [
      el("span", { class: "constraint-id", text: rule.id }),
      el("span", { class: "constraint-rule" }, [
        rule.rule,
        el("span", { class: "constraint-now", text: rule.now(design, r) }),
        rule.note ? el("span", { class: "constraint-now", text: rule.note }) : null
      ]),
      el("span", { class: "constraint-state", text: failing.has(rule.id) ? "Fails" : "Met" })
    ])));
  }

  return { render, setBaselineRotors: (counts) => { if (counts) baselineRotors = counts; } };
}
