// Pure helpers for the feasibility shading and the reasons banner: no DOM, so
// `node --test` covers them (feasibilityModel.test.js).
//
// A slice is one line of POST /api/v1/evtol/feasibility (backend
// services/feasibility.py build_slice): { param, limit: [lo, hi], current,
// constraint: [{id, lo, hi, text}], segments: [{lo, hi, status, reason?}],
// feasible: [[lo, hi]], points }. Status is one of constraint, converged,
// max_iter, diverged, error.

import { decimalsForStep, fmtValue } from "./format.js";

const EPS = 1e-9;

export const STATUS_COLOR = {
  converged: "var(--ok)",
  constraint: "var(--warn)",
  diverged: "var(--danger)",
  max_iter: "var(--danger)",
  error: "var(--danger)"
};

export const STATUS_LABEL = {
  converged: "closes",
  constraint: "violates a layout constraint",
  diverged: "diverges",
  max_iter: "does not converge",
  error: "fails"
};

const round = (v) => Math.round(v * 1000) / 1000;
const pct = (v, lo, hi) => (hi > lo ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) : 0);

// The slider's `--track` value: one horizontal gradient coloured by segment, with a
// hatch layer over every constraint segment. In the `background` shorthand a
// percentage position aligns the image's X% point with the box's X% point, so an
// image W% wide whose left edge must sit at L% needs X = L / (1 - W).
export function trackLayers(slice, lo, hi, colors = STATUS_COLOR) {
  const stops = [];
  const hatches = [];
  for (const seg of slice.segments) {
    const a = pct(seg.lo, lo, hi);
    const b = pct(seg.hi, lo, hi);
    if (b <= a) continue;
    stops.push(`${colors[seg.status] || colors.error} ${round(a)}% ${round(b)}%`);
    if (seg.status === "constraint") {
      const w = b - a;
      const x = w >= 100 ? 0 : (a / (100 - w)) * 100;
      hatches.push(`repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.28) 0 2px, transparent 2px 5px) ${round(x)}% 0 / ${round(w)}% 100% no-repeat`);
    }
  }
  if (!stops.length) return "";
  return [...hatches, `linear-gradient(90deg, ${stops.join(", ")})`].join(", ");
}

// A value exactly on a boundary belongs to both neighbours; the converged one wins,
// so a design sitting on its own constraint edge (wingspan = D-value) is not flagged.
export function segmentAt(slice, value) {
  if (!slice) return null;
  const hits = slice.segments.filter((s) => value >= s.lo - EPS && value <= s.hi + EPS);
  return hits.find((s) => s.status === "converged") || hits[0] || null;
}

export function firstSentence(text, max = 140) {
  if (!text) return "";
  const cut = text.search(/\.\s|\.$/);
  const sentence = cut >= 0 ? text.slice(0, cut) : text;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

// evtolpy's messages are long ("MTOW iteration diverged at iteration 4: MTOW guess
// reached 150228.826 kg, which exceeds ..."); the part before the first colon or
// full stop says what happened, which is all the banner and tooltip need.
export function shortReason(text, max = 90) {
  if (!text) return "";
  const cut = text.search(/:\s|\.\s|\.$/);
  const head = cut >= 0 ? text.slice(0, cut) : text;
  return head.length > max ? `${head.slice(0, max - 1)}…` : head;
}

function stepOf(spec) {
  return spec.integer ? 1 : spec.step || 0.01;
}

function snap(value, step, dir) {
  const n = value / step;
  const k = dir > 0 ? Math.ceil(n - EPS) : Math.floor(n + EPS);
  return +(k * step).toFixed(spec_decimals(step));
}

function spec_decimals(step) {
  return Math.max(decimalsForStep(step), 0);
}

// The feasible interval closest to `value`, or null when value already lies in one
// (or the slice has none). `end` is the nearer end, `dir` the way into the interval.
export function nearestFeasible(slice, value) {
  if (!slice?.feasible?.length) return null;
  let best = null;
  for (const [lo, hi] of slice.feasible) {
    if (value >= lo - EPS && value <= hi + EPS) return null;
    const end = value < lo ? lo : hi;
    const dist = Math.abs(end - value);
    if (!best || dist < best.dist) best = { lo, hi, end, dist, dir: value < lo ? 1 : -1 };
  }
  return best;
}

// Nearest feasible end plus one step inward, snapped to the step grid; clamped to
// the interval. null when the value is already feasible or nothing is feasible.
export function fixValue(slice, value, spec) {
  const near = nearestFeasible(slice, value);
  if (!near) return null;
  const step = stepOf(spec);
  let v = snap(near.end + near.dir * step, step, near.dir);
  v = Math.min(near.hi, Math.max(near.lo, v));
  return +v.toFixed(spec_decimals(step));
}

// A one-sided constraint bound {id, lo, hi} -> the nearest allowed value on the step grid.
export function constraintFix(bound, spec) {
  const step = stepOf(spec);
  if (bound.lo != null) return snap(bound.lo, step, 1);
  if (bound.hi != null) return snap(bound.hi, step, -1);
  return null;
}

// Which parameters each layout constraint can be fixed with, and on which side
// their bound lies (mirrors constraint_interval() in backend evtol_model.py).
export const CONSTRAINT_PARAMS = {
  C1: [["wingspan_m", "hi"], ["d_value_m", "lo"]],
  C2: [["fuselage_l_m", "lo"], ["fuselage_w_m", "hi"]],
  C3: [["fuselage_l_m", "hi"], ["d_value_m", "lo"]],
  C6: [["wingspan_m", "lo"], ["rotor_diameter_m", "hi"], ["lift_rotor_count", "hi"]]
};

const unitOf = (spec) => (spec.unit && spec.unit !== "count" ? ` ${spec.unit}` : "");
const withUnit = (v, spec) => `${fmtValue(v, spec)}${unitOf(spec)}`;

// A segment edge comes from bisection, so it has more digits than the slider
// step; show it at the step's precision (220.2865 Wh/kg -> 220 Wh/kg).
export function fmtEdge(value, spec) {
  if (value === null || value === undefined) return "—";
  return String(+Number(value).toFixed(spec.integer ? 0 : decimalsForStep(spec.step ?? 0.01)));
}

// The banner's items, merged and de-duplicated from three sources: the live
// C1-C6 warnings (with fix values from the backend's constraint bounds), the
// feasibility slices (current value in a failed segment), and the last /size error.
// `slices` maps key -> { slice, stale }. `first` is the key the user just changed:
// its item leads, so the slider being dragged explains itself at the top.
export function bannerItems({ design, specs, slices, warnings = [], sizeError = null, first = null }) {
  const specByKey = Object.fromEntries(specs.map((s) => [s.key, s]));
  const entry = (key) => (slices instanceof Map ? slices.get(key) : slices?.[key]) || null;
  const items = [];

  for (const w of warnings) {
    const fixes = [];
    for (const [key, side] of CONSTRAINT_PARAMS[w.id] || []) {
      const e = entry(key);
      const spec = specByKey[key];
      if (!e || e.stale || !spec) continue;
      const bound = e.slice.constraint.find((b) => b.id === w.id && b[side] != null);
      if (!bound) continue;
      const value = constraintFix(bound, spec);
      if (value == null) continue;
      const range = (e.slice.limit || [-Infinity, Infinity]);
      if (value < range[0] - EPS || value > range[1] + EPS) continue; // not reachable on this slider
      fixes.push({
        key, value, side,
        advice: `${side === "lo" ? "Raise" : "Lower"} ${spec.label.toLowerCase()} to ${side === "lo" ? "≥" : "≤"} ${withUnit(value, spec)}`,
        button: `Fix ${spec.label.toLowerCase()}`
      });
    }
    const advice = fixes.map((f) => f.advice).join(" or ");
    items.push({ kind: "constraint", id: w.id, lead: w.id, text: `${w.message}${advice ? ` ${advice}.` : ""}`, fixes });
  }

  const reasons = [];
  const unfixable = []; // inputs that cannot close the design on their own
  for (const spec of specs) {
    const e = entry(spec.key);
    if (!e) continue;
    const value = design[spec.key];
    const seg = segmentAt(e.slice, value);
    if (!seg || seg.status === "converged" || seg.status === "constraint") continue;
    const why = `evtolpy ${STATUS_LABEL[seg.status] || "fails"}`;
    const reason = shortReason(seg.reason);
    reasons.push(reason);
    const near = nearestFeasible(e.slice, value);
    if (!near) {
      unfixable.push({ spec, e, value, why, reason });
      continue;
    }
    const fix = fixValue(e.slice, value, spec);
    items.push({
      kind: "feasibility",
      id: spec.key,
      lead: spec.label,
      text: `${withUnit(value, spec)} is outside the closing range ${fmtEdge(near.lo, spec)}–${fmtEdge(near.hi, spec)}${unitOf(spec)} for the other inputs as set. ${why}${reason ? `: ${reason}` : ""}.${e.stale ? " Re-checking…" : ""}`,
      stale: e.stale,
      fixes: fix != null && !e.stale ? [{ key: spec.key, value: fix, button: `Move to ${withUnit(fix, spec)}` }] : []
    });
  }
  if (unfixable.length >= 3) {
    // One line instead of twelve: the design is broken in a way no single slider fixes.
    const { why, reason } = unfixable[0];
    const stale = unfixable.some((u) => u.e.stale);
    items.push({
      kind: "feasibility", id: "unfixable", lead: "No single input closes this design.",
      text: `Changing ${unfixable.map((u) => u.spec.label.toLowerCase()).join(", ")} alone does not help; change several inputs or reset to the baseline. ${why}${reason ? `: ${reason}` : ""}.${stale ? " Re-checking…" : ""}`,
      stale, fixes: []
    });
  } else {
    for (const { spec, e, value, why, reason } of unfixable) {
      items.push({
        kind: "feasibility", id: spec.key, lead: spec.label,
        text: `${withUnit(value, spec)}: no value of this input closes with the other inputs as set. ${why}${reason ? `: ${reason}` : ""}.${e.stale ? " Re-checking…" : ""}`,
        stale: e.stale, fixes: []
      });
    }
  }

  if (first) {
    const lead = items.findIndex((i) => i.id === first);
    if (lead > 0) items.unshift(...items.splice(lead, 1));
  }

  if (sizeError && !reasons.some((r) => r && sizeError.includes(r))) {
    items.push({ kind: "size", id: "size", lead: "Last sizing failed.", text: firstSentence(sizeError, 200), fixes: [] });
  }

  if (!items.length) {
    const fresh = specs.filter((s) => entry(s.key) && !entry(s.key).stale).length;
    if (fresh === specs.length) {
      items.push({ kind: "ok", id: "ok", lead: "Design closes", text: `· all ${specs.length} inputs inside their feasible ranges`, fixes: [] });
    } else {
      items.push({ kind: "pending", id: "pending", lead: "", text: `Checking feasible ranges… ${fresh}/${specs.length}`, fixes: [] });
    }
  }
  return items;
}
