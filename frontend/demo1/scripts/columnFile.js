// Reads the column file tools/demo1-prep/filterGTB777.py writes: uint32 header length,
// JSON header, then each column's little-endian bytes from the next 8-byte boundary.
// Columns come back as typed-array views on the buffer, so nothing is parsed or copied.
const ARRAY_TYPES = { f4: Float32Array, f8: Float64Array, u1: Uint8Array };

export function readColumnFile(buffer) {
  const headerLength = buffer.byteLength >= 4 ? new DataView(buffer).getUint32(0, true) : 0;
  if (!headerLength || 4 + headerLength > buffer.byteLength) {
    throw new Error("not a column file from filterGTB777.py");
  }
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  const start = Math.ceil((4 + headerLength) / 8) * 8;
  const columns = {};
  for (const { name, dtype, offset } of header.columns) {
    columns[name] = new ARRAY_TYPES[dtype](buffer, start + offset, header.rows);
  }
  return { rows: header.rows, labels: header.labels, columns };
}
