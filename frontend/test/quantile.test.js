import { test } from "node:test";
import assert from "node:assert/strict";
import { quantile } from "../demo1/scripts/quantile.js";

// Reference: interpolate between neighbours of a fully sorted copy.
function sortedQuantile(values, q) {
  const sorted = Float64Array.from(values).sort();
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

test("quantile: matches a full sort, with ties, sorted and reversed input", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cases = [
    Float64Array.from({ length: 1001 }, random),
    Float64Array.from({ length: 500 }, () => Math.floor(random() * 5)), // many ties
    Float64Array.from({ length: 300 }, (_, i) => i),
    Float64Array.from({ length: 300 }, (_, i) => -i),
    Float64Array.of(3),
    Float64Array.of(2, 1)
  ];
  for (const values of cases) {
    for (const q of [0, 0.1, 0.5, 0.9, 1]) {
      assert.equal(quantile(Float64Array.from(values), q), sortedQuantile(values, q));
    }
  }
});

test("quantile: empty input is NaN", () => {
  assert.ok(Number.isNaN(quantile(new Float64Array(0), 0.5)));
});
