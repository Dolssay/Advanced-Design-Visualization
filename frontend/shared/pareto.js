// Pure Pareto module: computes non-dominated front for multi-objective optimization.

/**
 * Computes the non-dominated (Pareto) front for a list of rows given objective definitions.
 *
 * @param {Array<Object>} rows - Array of design rows.
 * @param {Array<{key: string, sense: "min"|"max"}>} objectives - Objectives to optimize.
 * @returns {Array<Object>} Array of non-dominated rows from the converged set.
 */
export function paretoFront(rows, objectives) {
  if (!rows || !rows.length || !objectives || !objectives.length) {
    return [];
  }

  // Filter candidates: only converged rows with finite numeric values for all objectives
  const candidates = rows.filter((r) => {
    if (r.status !== undefined && r.status !== "converged") {
      return false;
    }
    for (const obj of objectives) {
      const val = r[obj.key];
      if (typeof val !== "number" || !Number.isFinite(val)) {
        return false;
      }
    }
    return true;
  });

  if (candidates.length <= 1) {
    return candidates.slice();
  }

  // Fast 2-objective sweep: O(n log n)
  if (objectives.length === 2) {
    const [obj1, obj2] = objectives;
    const sense1 = obj1.sense || "min";
    const sense2 = obj2.sense || "min";

    // Normalize so both are strictly minimized
    const xVal = (r) => (sense1 === "max" ? -r[obj1.key] : r[obj1.key]);
    const yVal = (r) => (sense2 === "max" ? -r[obj2.key] : r[obj2.key]);

    // Sort primarily by x ascending, secondarily by y ascending
    const sorted = candidates.slice().sort((a, b) => {
      const dx = xVal(a) - xVal(b);
      return dx !== 0 ? dx : yVal(a) - yVal(b);
    });

    const front = [];
    let runningBestY = Number.POSITIVE_INFINITY;
    let i = 0;

    while (i < sorted.length) {
      const currentX = xVal(sorted[i]);
      // Collect group of points with identical x
      const group = [];
      while (i < sorted.length && xVal(sorted[i]) === currentX) {
        group.push(sorted[i]);
        i++;
      }

      // In this group, points with minimum y have the best y
      const minY = yVal(group[0]); // sorted by y ascending, so first has minY
      // If minY is strictly better than runningBestY, all points in group with y == minY are non-dominated
      if (minY < runningBestY) {
        for (const item of group) {
          if (yVal(item) === minY) {
            front.push(item);
          }
        }
        runningBestY = minY;
      }
    }

    // Sort front by original obj1 value
    front.sort((a, b) => (sense1 === "max" ? b[obj1.key] - a[obj1.key] : a[obj1.key] - b[obj1.key]));
    return front;
  }

  // 3 or more objectives: O(n^2) pairwise dominance check
  function dominates(a, b) {
    let strictlyBetter = false;
    for (const obj of objectives) {
      const va = a[obj.key];
      const vb = b[obj.key];
      if (obj.sense === "max") {
        if (va < vb) return false;
        if (va > vb) strictlyBetter = true;
      } else {
        if (va > vb) return false;
        if (va < vb) strictlyBetter = true;
      }
    }
    return strictlyBetter;
  }

  return candidates.filter((b) => !candidates.some((a) => dominates(a, b)));
}
