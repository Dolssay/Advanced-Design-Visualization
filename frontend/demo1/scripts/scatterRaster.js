// Pure raster core behind zoomablePlot.js, no DOM access. Every point lands in one pixel of
// a grid the size of the plot area; each pixel keeps its top label (later labels draw over
// earlier ones, as the old per-point drawing did) and the index of that point for picking.
// The grid is then grown into the plot's square marker and colored, so the cost of a frame
// is one pass over the points plus a few passes over the pixels, however many points there are.

// view: { x0, x1, y0, y1 } data domain shown, { width, height } grid size in pixels.
export function binPoints(xs, ys, order, count, view) {
  const { width, height } = view;
  const kx = width / (view.x1 - view.x0);
  const ky = height / (view.y1 - view.y0);
  const top = new Uint8Array(width * height); // 0 = empty, else label order + 1
  const pick = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < count; i++) {
    const px = Math.floor((xs[i] - view.x0) * kx);
    const py = Math.floor((view.y1 - ys[i]) * ky);
    if (px < 0 || px >= width || py < 0 || py >= height) continue; // also drops NaN
    const cell = py * width + px;
    const rank = order[i] + 1;
    if (rank >= top[cell]) {
      top[cell] = rank;
      pick[cell] = i;
    }
  }
  return { top, pick };
}

// Max filter so a point at pixel p covers [p - before, p + after] in both directions.
export function growMarkers(top, width, height, before, after) {
  const pass = (source, length, lines, stride, step) => {
    const out = new Uint8Array(source.length);
    for (let line = 0; line < lines; line++) {
      const base = line * stride;
      for (let q = 0; q < length; q++) {
        let best = 0;
        const from = Math.max(0, q - after);
        const to = Math.min(length - 1, q + before);
        for (let p = from; p <= to; p++) {
          const value = source[base + p * step];
          if (value > best) best = value;
        }
        out[base + q * step] = best;
      }
    }
    return out;
  };
  return pass(pass(top, width, height, width, 1), height, width, 1, width);
}

// rgba: one [r, g, b, a] per label order. Returns ImageData-ready bytes.
export function colorize(grown, rgba) {
  const out = new Uint8ClampedArray(grown.length * 4);
  for (let cell = 0; cell < grown.length; cell++) {
    const rank = grown[cell];
    if (!rank) continue;
    out.set(rgba[rank - 1], cell * 4);
  }
  return out;
}

// Index of the point closest to grid position (gx, gy) within `radius` pixels, or -1.
// distance(i) returns that point's squared distance from the pointer, in any unit.
export function nearestPoint(pick, width, height, gx, gy, radius, distance) {
  let best = -1;
  let bestDistance = Infinity;
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);
  for (let py = Math.max(0, cy - radius); py <= Math.min(height - 1, cy + radius); py++) {
    for (let px = Math.max(0, cx - radius); px <= Math.min(width - 1, cx + radius); px++) {
      const i = pick[py * width + px];
      if (i < 0) continue;
      const d = distance(i);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
  }
  return best;
}
