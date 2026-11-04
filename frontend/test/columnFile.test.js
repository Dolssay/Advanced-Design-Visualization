import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readColumnFile } from "../demo1/scripts/columnFile.js";

const toArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

test("readColumnFile: reads the Demo 1 dataset", () => {
  const file = readFileSync(new URL("../public/data/GTB777.bin", import.meta.url));
  const { rows, labels, columns } = readColumnFile(toArrayBuffer(file));
  assert.ok(rows > 0);
  assert.ok(labels.includes("Infeasible"));
  assert.ok(columns.Label instanceof Uint8Array);
  assert.ok(columns["Cert 25.107 V2/VSR"] instanceof Float64Array);
  for (const column of Object.values(columns)) assert.equal(column.length, rows);
  assert.ok(Math.max(...columns.Label) < labels.length);
});

test("readColumnFile: rejects files that are not column files", () => {
  const html = new TextEncoder().encode("<!doctype html><html></html>");
  assert.throws(() => readColumnFile(toArrayBuffer(Buffer.from(html))), /not a column file/);
  assert.throws(() => readColumnFile(new ArrayBuffer(0)), /not a column file/);
});
