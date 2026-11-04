import { test } from "node:test";
import assert from "node:assert/strict";
import { binPoints, growMarkers, colorize, nearestPoint } from "../demo1/scripts/scatterRaster.js";

const view = { x0: 0, x1: 4, y0: 0, y1: 4, width: 4, height: 4 };

test("binPoints: later label wins a shared pixel, outside and NaN points are dropped", () => {
  const xs = new Float64Array([0.5, 0.5, 0.5, 9, NaN]);
  const ys = new Float64Array([3.5, 3.5, 3.5, 1, 1]);
  const order = new Uint8Array([2, 0, 1, 3, 3]);
  const { top, pick } = binPoints(xs, ys, order, xs.length, view);
  assert.equal(top[0], 3); // y = 3.5 is the top row
  assert.equal(pick[0], 0);
  assert.equal(top.filter(Boolean).length, 1);
});

test("growMarkers: a pixel grows by before/after on both axes", () => {
  const top = new Uint8Array(25);
  top[2 * 5 + 2] = 1;
  const grown = growMarkers(top, 5, 5, 1, 2);
  const lit = [];
  for (let i = 0; i < 25; i++) if (grown[i]) lit.push([i % 5, Math.floor(i / 5)]);
  // columns and rows 1..4 (one before, two after)
  assert.equal(lit.length, 16);
  assert.deepEqual(lit[0], [1, 1]);
  assert.deepEqual(lit.at(-1), [4, 4]);
});

test("colorize and nearestPoint", () => {
  const rgba = colorize(new Uint8Array([0, 2]), [[1, 2, 3, 4], [5, 6, 7, 8]]);
  assert.deepEqual([...rgba], [0, 0, 0, 0, 5, 6, 7, 8]);

  const pick = new Int32Array(16).fill(-1);
  pick[0] = 7;
  pick[15] = 9;
  const at = { 7: 0, 9: 18 };
  assert.equal(nearestPoint(pick, 4, 4, 1, 1, 2, (i) => at[i]), 7);
  assert.equal(nearestPoint(pick, 4, 4, 1, 1, 1, (i) => at[i]), 7);
  assert.equal(nearestPoint(pick, 4, 4, 2.5, 2.5, 0, (i) => at[i]), -1);
});
