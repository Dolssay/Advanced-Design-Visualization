// Pure binning + colorizing core for the design-space heatmap. No DOM access, so the
// same code runs inside heatmapWorker.js (normal path) and on the main thread (fallback
// for browsers without module workers).
//
// Rows arrive as columnar Float32Arrays plus a Uint8Array of label codes. A request asks
// for an nx x ny grid over two columns and one metric:
//   count - number of designs per cell
//   mean  - mean of another column per cell
//   share - fraction of designs per cell whose label is in `metric.labelMask`
// Optional Gaussian smoothing is applied to the numerator and the denominator separately
// (a kernel-weighted ratio), so smoothed means/shares stay inside the data's range and
// sparse cells borrow strength from their neighbours instead of flickering.

function gaussianKernel(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k++) {
    const value = Math.exp(-0.5 * (k / sigma) ** 2);
    kernel[k + radius] = value;
    total += value;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
  return { kernel, radius };
}

// Separable blur: one horizontal pass then one vertical pass, O(cells * kernel).
function blur(grid, nx, ny, sigma) {
  if (!(sigma > 0)) return grid;
  const { kernel, radius } = gaussianKernel(sigma);
  const temp = new Float64Array(grid.length);
  const out = new Float64Array(grid.length);

  for (let j = 0; j < ny; j++) {
    const rowOffset = j * nx;
    for (let i = 0; i < nx; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const ii = i + k;
        if (ii >= 0 && ii < nx) sum += grid[rowOffset + ii] * kernel[k + radius];
      }
      temp[rowOffset + i] = sum;
    }
  }

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const jj = j + k;
        if (jj >= 0 && jj < ny) sum += temp[jj * nx + i] * kernel[k + radius];
      }
      out[j * nx + i] = sum;
    }
  }

  return out;
}

export function binHeatmap({ columns, labelCodes }, request) {
  const {
    xCol,
    yCol,
    xDomain,
    yDomain,
    nx,
    ny,
    metric,
    labelMask,
    smoothing = 0,
    minCount = 1
  } = request;

  const xs = columns[xCol];
  const ys = columns[yCol];
  const valueColumn = metric.kind === "mean" ? columns[metric.col] : null;
  const shareMask = metric.kind === "share" ? metric.labelMask : null;
  const cellCount = nx * ny;
  const rawCounts = new Float64Array(cellCount);
  const rawSums = new Float64Array(cellCount);
  const xScale = nx / ((xDomain[1] - xDomain[0]) || 1);
  const yScale = ny / ((yDomain[1] - yDomain[0]) || 1);
  let used = 0;

  for (let r = 0; r < xs.length; r++) {
    if (!labelMask[labelCodes[r]]) continue;
    const x = xs[r];
    const y = ys[r];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - xDomain[0]) * xScale)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - yDomain[0]) * yScale)));
    const cell = j * nx + i;
    rawCounts[cell] += 1;
    if (valueColumn) {
      rawSums[cell] += valueColumn[r];
    } else if (shareMask) {
      rawSums[cell] += shareMask[labelCodes[r]] ? 1 : 0;
    }
    used++;
  }

  const counts = blur(rawCounts, nx, ny, smoothing);
  const sums = metric.kind === "count" ? null : blur(rawSums, nx, ny, smoothing);
  const values = new Float32Array(cellCount);
  const valid = new Uint8Array(cellCount);
  let vmin = Number.POSITIVE_INFINITY;
  let vmax = Number.NEGATIVE_INFINITY;
  // Count cells need at least one design. Mean/share cells need `minCount` designs; with
  // smoothing on, that is the kernel-weighted (effective) count.
  const threshold = metric.kind === "count" ? 0.5 : Math.max(minCount, 1) - 1e-6;

  for (let c = 0; c < cellCount; c++) {
    const effective = metric.kind === "count" ? rawCounts[c] : counts[c];
    if (effective < threshold) {
      values[c] = Number.NaN;
      continue;
    }
    const value = metric.kind === "count" ? counts[c] : sums[c] / counts[c];
    values[c] = value;
    valid[c] = 1;
    if (value < vmin) vmin = value;
    if (value > vmax) vmax = value;
  }

  if (!Number.isFinite(vmin)) {
    vmin = 0;
    vmax = 1;
  }
  // Shares and counts are anchored at zero so the lightest color always means "none".
  if (metric.kind !== "mean") vmin = 0;
  if (vmax === vmin) vmax = vmin + (metric.kind === "share" ? 1 : 1e-9);

  const rawCountsOut = new Float32Array(rawCounts);
  return { nx, ny, values, valid, rawCounts: rawCountsOut, vmin, vmax, used };
}

// Paint the grid into RGBA pixels, one pixel per cell, with row 0 at the *top* (highest
// y bin) so the image can be stretched straight over the plot area.
export function colorizeHeatmap(result, lut) {
  const { nx, ny, values, valid, vmin, vmax } = result;
  const rgba = new Uint8ClampedArray(nx * ny * 4);
  const span = vmax - vmin || 1;
  const lastIndex = lut.length / 4 - 1;

  for (let j = 0; j < ny; j++) {
    const targetRow = ny - 1 - j;
    for (let i = 0; i < nx; i++) {
      const cell = j * nx + i;
      const target = (targetRow * nx + i) * 4;
      if (!valid[cell]) {
        rgba[target + 3] = 0;
        continue;
      }
      const t = Math.max(0, Math.min(1, (values[cell] - vmin) / span));
      const index = Math.round(t * lastIndex) * 4;
      rgba[target] = lut[index];
      rgba[target + 1] = lut[index + 1];
      rgba[target + 2] = lut[index + 2];
      rgba[target + 3] = 255;
    }
  }

  return rgba;
}
