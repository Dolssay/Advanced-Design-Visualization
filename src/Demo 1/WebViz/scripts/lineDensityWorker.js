// Generic off-main-thread rasterizer for dense multi-line ("parallel coordinates" style)
// backgrounds. This module knows nothing about any specific dataset, aircraft, or plot --
// it only understands linear axes (a numeric domain mapped to a pixel range) and rows of
// raw numeric values. Any plot that needs to rasterize many overlapping polylines without
// blocking the main thread can reuse this file by posting it a `buildBackground` job that
// describes its own axes and rows.
//
// Each plot instance creates its own Worker from this module (see parallelCoordinates.js).
// That is deliberate: heavy work for one plot then never shares a thread with another
// plot's rendering, whether that other plot renders on the main thread or in its own
// separate worker.

const canvasesByKey = new Map();
const currentRequestByKey = new Map();

function getCanvas(key, rasterWidth, rasterHeight) {
  let canvas = canvasesByKey.get(key);
  if (!canvas || canvas.width !== rasterWidth || canvas.height !== rasterHeight) {
    canvas = new OffscreenCanvas(rasterWidth, rasterHeight);
    canvasesByKey.set(key, canvas);
  }
  return canvas;
}

function projectValue(value, domainMin, domainMax, outMin, outMax) {
  if (domainMax === domainMin) {
    return outMin;
  }
  return outMin + ((value - domainMin) / (domainMax - domainMin)) * (outMax - outMin);
}

async function buildBackground(job) {
  const {
    requestId,
    canvasKey,
    width,
    height,
    renderScale,
    dimensionCount,
    axisPositions,
    axisScales,
    rows,
    style,
    chunkRows,
    progressIntervalMs
  } = job;

  const rasterWidth = Math.max(1, Math.round(width * renderScale));
  const rasterHeight = Math.max(1, Math.round(height * renderScale));
  const canvas = getCanvas(canvasKey, rasterWidth, rasterHeight);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, rasterWidth, rasterHeight);
  context.globalAlpha = style.alpha;
  context.lineWidth = Math.max(0.5, style.lineWidth * renderScale);
  context.strokeStyle = style.color;
  context.lineJoin = "round";
  context.lineCap = "round";

  const numRows = dimensionCount > 0 ? Math.floor(rows.length / dimensionCount) : 0;

  let path = new Path2D();
  let lastPost = performance.now();
  let rowIndex = 0;

  while (rowIndex < numRows) {
    if (currentRequestByKey.get(canvasKey) !== requestId) {
      return; // superseded by a newer build for this canvasKey; abandon quietly
    }

    const endIndex = Math.min(rowIndex + chunkRows, numRows);
    for (let r = rowIndex; r < endIndex; r++) {
      const base = r * dimensionCount;
      for (let d = 0; d < dimensionCount; d++) {
        const value = rows[base + d];
        const x = axisPositions[d] * renderScale;
        const y = projectValue(
          value,
          axisScales[d * 4],
          axisScales[d * 4 + 1],
          axisScales[d * 4 + 2],
          axisScales[d * 4 + 3]
        ) * renderScale;
        if (d === 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      }
    }
    rowIndex = endIndex;

    const now = performance.now();
    const isDone = rowIndex >= numRows;
    if (now - lastPost >= progressIntervalMs || isDone) {
      context.stroke(path);
      path = new Path2D();
      lastPost = now;

      const bitmap = await createImageBitmap(canvas);
      if (currentRequestByKey.get(canvasKey) !== requestId) {
        bitmap.close();
        return;
      }
      postMessage({ type: "progress", requestId, canvasKey, bitmap, done: isDone }, [bitmap]);
    }
  }
}

self.onmessage = (event) => {
  const job = event.data;
  if (job?.type === "buildBackground") {
    currentRequestByKey.set(job.canvasKey, job.requestId);
    buildBackground(job);
  }
};
