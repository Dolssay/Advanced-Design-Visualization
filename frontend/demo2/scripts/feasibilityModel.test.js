import assert from "node:assert/strict";
import { test } from "node:test";

import { bannerItems, constraintFix, fixValue, nearestFeasible, segmentAt, shortReason, trackLayers } from "./feasibilityModel.js";

const colors = { converged: "G", constraint: "A", diverged: "R", max_iter: "R", error: "R" };
const battery = { key: "batt_spec_energy_w_h_p_kg", label: "Battery specific energy", unit: "Wh/kg", step: 5, integer: false, limit_min: 65, limit_max: 510 };
const rotors = { key: "lift_rotor_count", label: "Lift rotor count", unit: "count", step: 1, integer: true, limit_min: 2, limit_max: 12 };
const wingspan = { key: "wingspan_m", label: "Wingspan", unit: "m", step: 0.1, integer: false, limit_min: 3.8, limit_max: 30.5 };

const batterySlice = {
  param: battery.key, limit: [65, 510], current: 256, constraint: [],
  segments: [
    { lo: 65, hi: 204, status: "diverged", reason: "MTOW iteration diverged at iteration 4: guess reached 150228 kg. The template is inconsistent." },
    { lo: 204, hi: 222.6, status: "max_iter", reason: "MTOW did not converge in 60 iterations (last change 0.036 kg)." },
    { lo: 222.6, hi: 510, status: "converged" }
  ],
  feasible: [[222.6, 510]], points: []
};

test("trackLayers: one gradient stop per segment, hatch layer per constraint segment", () => {
  const slice = { segments: [{ lo: 0, hi: 2, status: "constraint" }, { lo: 2, hi: 8, status: "converged" }, { lo: 8, hi: 10, status: "constraint" }] };
  const css = trackLayers(slice, 0, 10, colors);
  assert.match(css, /linear-gradient\(90deg, A 0% 20%, G 20% 80%, A 80% 100%\)$/);
  // left edge at 0% with width 20% -> X = 0; left edge at 80% with width 20% -> X = 80 / (1 - 0.2) = 100
  assert.ok(css.includes("transparent 2px 5px) 0% 0 / 20% 100% no-repeat"));
  assert.ok(css.includes("transparent 2px 5px) 100% 0 / 20% 100% no-repeat"));
  assert.equal(trackLayers({ segments: [{ lo: 0, hi: 10, status: "constraint" }] }, 0, 10, colors).split("repeating").length, 2);
  assert.equal(trackLayers({ segments: [] }, 0, 10, colors), "");
});

test("segmentAt finds the segment holding a value, edges included", () => {
  assert.equal(segmentAt(batterySlice, 100).status, "diverged");
  assert.equal(segmentAt(batterySlice, 222.6).status, "converged"); // on the edge: the closing side wins
  assert.equal(segmentAt(batterySlice, 204).status, "diverged");     // both neighbours fail: first one
  assert.equal(segmentAt(batterySlice, 510).status, "converged");
  assert.equal(segmentAt(batterySlice, 600), null);
  assert.equal(segmentAt(null, 1), null);
});

test("fixValue: nearest feasible end plus one step, on the step grid", () => {
  const near = nearestFeasible(batterySlice, 200);
  assert.deepEqual([near.lo, near.hi, near.end, near.dir], [222.6, 510, 222.6, 1]);
  assert.ok(Math.abs(near.dist - 22.6) < 1e-9);
  assert.equal(fixValue(batterySlice, 200, battery), 230);           // 222.6 + 5 = 227.6 -> up to the 5 grid
  assert.equal(fixValue(batterySlice, 300, battery), null);          // already feasible
  const above = { feasible: [[100, 200.3]] };
  assert.equal(fixValue(above, 250, battery), 195);                  // 200.3 - 5 = 195.3 -> down to the grid
  assert.equal(fixValue({ feasible: [] }, 250, battery), null);
  assert.equal(fixValue({ feasible: [[4.5, 7]] }, 9, rotors), 6);    // 7 - 1 = 6
  assert.equal(fixValue({ feasible: [[4.5, 7]] }, 2, rotors), 6);    // 4.5 + 1 = 5.5 -> ceil 6
  assert.equal(fixValue({ feasible: [[100, 102]] }, 50, battery), 102); // interval narrower than a step: clamp
});

test("constraintFix rounds a bound onto the step grid, towards the allowed side", () => {
  assert.equal(constraintFix({ id: "C6", lo: 13.6, hi: null }, wingspan), 13.6);
  assert.equal(constraintFix({ id: "C6", lo: 13.62, hi: null }, wingspan), 13.7);
  assert.equal(constraintFix({ id: "C6", lo: null, hi: 2.4733 }, { ...wingspan, step: 0.05 }), 2.45);
  assert.equal(constraintFix({ id: "C6", lo: null, hi: 7 }, rotors), 7);
});

test("bannerItems merges constraint warnings, slice reasons and the size error", () => {
  const specs = [battery, wingspan, rotors];
  const slices = new Map([
    [battery.key, { slice: batterySlice, stale: false }],
    [wingspan.key, { slice: { ...batterySlice, param: wingspan.key, limit: [3.8, 30.5], constraint: [{ id: "C6", lo: 13.6, hi: null, text: "" }], segments: [{ lo: 3.8, hi: 30.5, status: "converged" }], feasible: [[3.8, 30.5]] }, stale: false }],
    [rotors.key, { slice: { ...batterySlice, param: rotors.key, limit: [2, 12], constraint: [{ id: "C6", lo: null, hi: 5, text: "" }], segments: [{ lo: 2, hi: 12, status: "converged" }], feasible: [[2, 12]] }, stale: true }]
  ]);
  const design = { [battery.key]: 200, [wingspan.key]: 13, [rotors.key]: 6 };
  const warnings = [{ id: "C6", message: "6 rotors of 2.2 m need 13.6 m of span; wingspan is 13 m." }];

  const items = bannerItems({ design, specs, slices, warnings, sizeError: "MTOW iteration diverged at iteration 4: guess reached 150228 kg. The template is inconsistent." });
  assert.deepEqual(items.map((i) => i.kind), ["constraint", "feasibility"]);   // size error duplicates the slice reason

  const c6 = items[0];
  assert.equal(c6.text, "6 rotors of 2.2 m need 13.6 m of span; wingspan is 13 m. Raise wingspan to ≥ 13.6 m.");
  assert.deepEqual(c6.fixes.map((f) => [f.key, f.value, f.button]), [["wingspan_m", 13.6, "Fix wingspan"]]); // rotor slice is stale: no fix from it

  const b = items[1];
  assert.equal(b.lead, "Battery specific energy");
  assert.equal(b.text, "200 Wh/kg is outside the closing range 223–510 Wh/kg for the other inputs as set. evtolpy diverges: MTOW iteration diverged at iteration 4.");
  assert.deepEqual(b.fixes, [{ key: battery.key, value: 230, button: "Move to 230 Wh/kg" }]);

  const other = bannerItems({ design, specs, slices, warnings: [], sizeError: "Something else went wrong." });
  assert.deepEqual(other.map((i) => i.kind), ["feasibility", "size"]);
});

test("bannerItems: ok line only when every slice is fresh, pending otherwise", () => {
  const specs = [battery, wingspan];
  const fresh = (key) => ({ slice: { ...batterySlice, param: key, segments: [{ lo: 0, hi: 1000, status: "converged" }], feasible: [[0, 1000]] }, stale: false });
  const design = { [battery.key]: 256, [wingspan.key]: 15 };
  const ok = bannerItems({ design, specs, slices: new Map([[battery.key, fresh(battery.key)], [wingspan.key, fresh(wingspan.key)]]) });
  assert.deepEqual(ok.map((i) => [i.kind, i.lead]), [["ok", "Design closes"]]);
  const pending = bannerItems({ design, specs, slices: new Map([[battery.key, fresh(battery.key)]]) });
  assert.equal(pending[0].kind, "pending");
  assert.match(pending[0].text, /1\/2/);
});

test("shortReason keeps what happened, drops the numbers after the colon", () => {
  assert.equal(shortReason("MTOW iteration diverged at iteration 4: MTOW guess reached 150228 kg. More."), "MTOW iteration diverged at iteration 4");
  assert.equal(shortReason("MTOW did not converge in 60 iterations (last change 0.036 kg)."), "MTOW did not converge in 60 iterations (last change 0.036 kg)");
  assert.equal(shortReason(""), "");
});

test("bannerItems folds three or more unfixable inputs into one line", () => {
  const specs = [battery, wingspan, rotors];
  const broken = (key) => ({ slice: { ...batterySlice, param: key, constraint: [], segments: [{ lo: 0, hi: 1000, status: "diverged", reason: "MTOW iteration diverged at iteration 3: x" }], feasible: [] }, stale: false });
  const slices = new Map(specs.map((s) => [s.key, broken(s.key)]));
  const items = bannerItems({ design: { [battery.key]: 256, [wingspan.key]: 15, [rotors.key]: 6 }, specs, slices });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "unfixable");
  assert.match(items[0].text, /^Changing battery specific energy, wingspan, lift rotor count alone does not help; .* evtolpy diverges: MTOW iteration diverged at iteration 3\.$/);
  assert.deepEqual(items[0].fixes, []);
  const two = bannerItems({ design: { [battery.key]: 256, [wingspan.key]: 15, [rotors.key]: 6 }, specs: [battery, wingspan], slices });
  assert.deepEqual(two.map((i) => i.id), [battery.key, wingspan.key]);
});
