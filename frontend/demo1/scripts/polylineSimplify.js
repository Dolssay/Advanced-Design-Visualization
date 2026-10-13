// Ramer-Douglas-Peucker simplification for small polylines (e.g. one parallel-coordinates
// row's axis-to-axis vertices). Drops vertices that don't move the rendered path by more
// than `tolerance` pixels, so the stroked output looks the same while costing less to
// rasterize. Works on any [x, y] point list -- no dataset- or chart-specific assumptions,
// so it is safe to reuse for any future dense-line plot, not just this GTB777 demo.
export function simplifyPolyline(points, tolerance) {
  if (!(tolerance > 0) || points.length <= 2) {
    return points;
  }

  const [startX, startY] = points[0];
  const [endX, endY] = points[points.length - 1];
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy) || 1;

  let maxDistance = 0;
  let splitIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const distance = Math.abs(dy * px - dx * py + endX * startY - endY * startX) / length;
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0], points[points.length - 1]];
  }

  const left = simplifyPolyline(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyPolyline(points.slice(splitIndex), tolerance);
  return left.slice(0, -1).concat(right);
}
