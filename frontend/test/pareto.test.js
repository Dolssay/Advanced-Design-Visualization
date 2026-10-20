import { test } from "node:test";
import assert from "node:assert/strict";
import { paretoFront } from "../shared/pareto.js";

test("paretoFront: empty or invalid inputs", () => {
  assert.deepEqual(paretoFront([], [{ key: "a", sense: "min" }]), []);
  assert.deepEqual(paretoFront(null, [{ key: "a", sense: "min" }]), []);
  assert.deepEqual(paretoFront([{ a: 1 }], []), []);
  assert.deepEqual(paretoFront([{ a: 1 }], null), []);
});

test("paretoFront: single point", () => {
  const row = { id: 1, x: 10, y: 20, status: "converged" };
  const res = paretoFront([row], [{ key: "x", sense: "min" }, { key: "y", sense: "min" }]);
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 1);
});

test("paretoFront: only converged rows take part", () => {
  const rows = [
    { id: 1, mtow_kg: 2000, total_energy_kw_hr: 100, status: "converged" },
    { id: 2, mtow_kg: 1000, total_energy_kw_hr: 50, status: "diverged" }, // better numbers, but diverged!
    { id: 3, mtow_kg: 1500, total_energy_kw_hr: 80, status: "max_iter" }, // max_iter
    { id: 4, mtow_kg: 2500, total_energy_kw_hr: 90, status: "converged" },
  ];
  const objectives = [
    { key: "mtow_kg", sense: "min" },
    { key: "total_energy_kw_hr", sense: "min" }
  ];
  const front = paretoFront(rows, objectives);
  // Row 2 and 3 must be excluded because not converged.
  // Between 1 (2000, 100) and 4 (2500, 90):
  // 1 has lower mtow, 4 has lower energy -> both are on front!
  assert.equal(front.length, 2);
  const ids = front.map((r) => r.id).sort();
  assert.deepEqual(ids, [1, 4]);
});

test("paretoFront: 2-objective min/min with known expected results", () => {
  // A: (1, 5) -> on front
  // B: (2, 3) -> on front
  // C: (3, 2) -> on front
  // D: (2, 4) -> dominated by B (2, 3)
  // E: (4, 4) -> dominated by B, C
  // F: (5, 1) -> on front
  const rows = [
    { id: "A", x: 1, y: 5 },
    { id: "B", x: 2, y: 3 },
    { id: "C", x: 3, y: 2 },
    { id: "D", x: 2, y: 4 },
    { id: "E", x: 4, y: 4 },
    { id: "F", x: 5, y: 1 },
  ];
  const objectives = [
    { key: "x", sense: "min" },
    { key: "y", sense: "min" }
  ];
  const front = paretoFront(rows, objectives);
  const frontIds = front.map((r) => r.id);
  assert.deepEqual(frontIds, ["A", "B", "C", "F"]);
});

test("paretoFront: all-dominated input", () => {
  // Star point dominates every other point
  const rows = [
    { id: "best", x: 10, y: 10 },
    { id: "d1", x: 15, y: 20 },
    { id: "d2", x: 20, y: 15 },
    { id: "d3", x: 30, y: 30 },
  ];
  const front = paretoFront(rows, [
    { key: "x", sense: "min" },
    { key: "y", sense: "min" }
  ]);
  assert.equal(front.length, 1);
  assert.equal(front[0].id, "best");
});

test("paretoFront: handles ties properly", () => {
  // Two points with identical objective values
  const rows = [
    { id: "T1", x: 10, y: 20 },
    { id: "T2", x: 10, y: 20 },
    { id: "Worse", x: 15, y: 25 },
  ];
  const front = paretoFront(rows, [
    { key: "x", sense: "min" },
    { key: "y", sense: "min" }
  ]);
  assert.equal(front.length, 2);
  const ids = front.map((r) => r.id).sort();
  assert.deepEqual(ids, ["T1", "T2"]);
});

test("paretoFront: mixed min and max senses (2 objectives)", () => {
  // Minimize MTOW, maximize Cruise L/D
  const rows = [
    { id: "A", mtow: 2000, ld: 12 }, // low weight, high LD -> non-dominated
    { id: "B", mtow: 2500, ld: 14 }, // higher weight, higher LD -> non-dominated
    { id: "C", mtow: 2200, ld: 11 }, // heavier than A, worse LD than A -> dominated by A
    { id: "D", mtow: 3000, ld: 10 }, // dominated by all
  ];
  const front = paretoFront(rows, [
    { key: "mtow", sense: "min" },
    { key: "ld", sense: "max" }
  ]);
  const ids = front.map((r) => r.id).sort();
  assert.deepEqual(ids, ["A", "B"]);
});

test("paretoFront: 3 objectives (MTOW min, Energy min, L/D max)", () => {
  const rows = [
    { id: "1", mtow: 2000, energy: 200, ld: 10, status: "converged" },
    { id: "2", mtow: 2200, energy: 180, ld: 10, status: "converged" },
    { id: "3", mtow: 2100, energy: 190, ld: 12, status: "converged" }, // best L/D
    { id: "4", mtow: 2500, energy: 250, ld: 8, status: "converged" },  // dominated by 1, 2, 3
  ];
  const objectives = [
    { key: "mtow", sense: "min" },
    { key: "energy", sense: "min" },
    { key: "ld", sense: "max" }
  ];
  const front = paretoFront(rows, objectives);
  const ids = front.map((r) => r.id).sort();
  assert.deepEqual(ids, ["1", "2", "3"]);
});

test("paretoFront: ignores null, undefined and NaN objective values", () => {
  const rows = [
    { id: "1", x: 10, y: 20 },
    { id: "2", x: null, y: 15 },
    { id: "3", x: 5, y: undefined },
    { id: "4", x: NaN, y: 10 },
  ];
  const front = paretoFront(rows, [{ key: "x", sense: "min" }, { key: "y", sense: "min" }]);
  assert.equal(front.length, 1);
  assert.equal(front[0].id, "1");
});
