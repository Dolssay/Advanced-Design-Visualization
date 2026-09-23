// Off-main-thread worker for the design-space heatmap (see heatmapPlot.js).
//
// The rows are posted once (`init`, transferred, zero-copy) and kept here. Every later
// `bin` request only carries the axis/metric/filter choices, so changing the view never
// re-sends 42k rows. The worker bins, smooths, colorizes and -- when OffscreenCanvas is
// available -- encodes the grid as a tiny PNG (one pixel per cell). The main thread then
// only swaps an <image> href and lets the browser stretch it over the plot area, so a
// redraw costs one image decode instead of thousands of SVG rects or canvas fills.

import { binHeatmap, colorizeHeatmap } from "./heatmapBinning.js";

let dataset = null;
let lut = null;

async function encodePng(rgba, nx, ny) {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(nx, ny);
  const context = canvas.getContext("2d");
  context.putImageData(new ImageData(rgba, nx, ny), 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

self.onmessage = async (event) => {
  const message = event.data;

  if (message?.type === "init") {
    dataset = { columns: message.columns, labelCodes: message.labelCodes };
    lut = message.lut;
    return;
  }

  if (message?.type === "bin") {
    if (!dataset) return;
    const started = performance.now();
    const result = binHeatmap(dataset, message.request);
    const rgba = colorizeHeatmap(result, lut);
    const blob = await encodePng(rgba, result.nx, result.ny);
    const elapsedMs = performance.now() - started;

    const payload = {
      type: "result",
      requestId: message.requestId,
      nx: result.nx,
      ny: result.ny,
      values: result.values,
      rawCounts: result.rawCounts,
      vmin: result.vmin,
      vmax: result.vmax,
      used: result.used,
      elapsedMs,
      blob,
      rgba: blob ? null : rgba
    };
    const transfer = [result.values.buffer, result.rawCounts.buffer];
    if (!blob) transfer.push(rgba.buffer);
    self.postMessage(payload, transfer);
  }
};
