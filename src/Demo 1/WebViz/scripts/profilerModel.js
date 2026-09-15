const DEFAULT_FACTOR_TRANSFORM = "identity";
const DEFAULT_RESPONSE_TRANSFORM = "log";

const TRANSFORMS = {
  identity: {
    forward: (value) => value,
    inverse: (value) => value
  },
  log: {
    forward: (value) => Math.log(value),
    inverse: (value) => Math.exp(value)
  }
};

function resolveTransform(spec) {
  if (spec == null || spec === "identity") {
    return TRANSFORMS.identity;
  }

  if (spec === "log") {
    return TRANSFORMS.log;
  }

  if (spec.type === "shiftedLog") {
    const delta = spec.delta ?? 0;
    return {
      forward: (value) => Math.log(value + delta),
      inverse: (value) => Math.exp(value) - delta
    };
  }

  throw new Error(`Unknown transform: ${JSON.stringify(spec)}`);
}

function normalizeTerms(specs, defaultTransform) {
  if (!Array.isArray(specs) || !specs.length) {
    throw new Error("profilerModel: factors and responses must be non-empty arrays.");
  }

  return specs.map((spec) => {
    const entry = typeof spec === "string" ? { key: spec } : spec;
    if (!entry?.key) {
      throw new Error("profilerModel: every factor and response needs a key.");
    }
    const transform = entry.transform ?? defaultTransform;
    return {
      key: entry.key,
      label: entry.label ?? entry.key,
      transform,
      ops: resolveTransform(transform)
    };
  });
}

function cholesky(matrix, size) {
  const lower = Array.from({ length: size }, () => new Float64Array(size));

  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k++) {
        sum -= lower[i][k] * lower[j][k];
      }

      if (i === j) {
        if (!(sum > 0)) {
          return null;
        }
        lower[i][i] = Math.sqrt(sum);
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }

  return lower;
}

function choleskySolve(lower, rhs, size) {
  const forward = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    let sum = rhs[i];
    for (let k = 0; k < i; k++) {
      sum -= lower[i][k] * forward[k];
    }
    forward[i] = sum / lower[i][i];
  }

  const solution = new Float64Array(size);
  for (let i = size - 1; i >= 0; i--) {
    let sum = forward[i];
    for (let k = i + 1; k < size; k++) {
      sum -= lower[k][i] * solution[k];
    }
    solution[i] = sum / lower[i][i];
  }

  return solution;
}

function solveNormalEquations(matrix, rhsList, size) {
  let trace = 0;
  for (let i = 0; i < size; i++) {
    trace += matrix[i][i];
  }

  const scale = trace / size || 1;
  let ridge = 0;

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = matrix.map((row, i) => {
      const copy = Float64Array.from(row);
      copy[i] += ridge;
      return copy;
    });

    const lower = cholesky(candidate, size);
    if (lower) {
      return {
        ridge,
        solutions: rhsList.map((rhs) => choleskySolve(lower, rhs, size))
      };
    }

    ridge = ridge === 0 ? scale * 1e-12 : ridge * 100;
  }

  return null;
}

function collectDesign(rows, factorTerms, responseTerms) {
  const factorCount = factorTerms.length;
  const responseCount = responseTerms.length;
  const capacity = rows.length;

  const design = new Float64Array(capacity * factorCount);
  const rawFactors = new Float64Array(capacity * factorCount);
  const transformedResponses = responseTerms.map(() => new Float64Array(capacity));
  const rawResponses = responseTerms.map(() => new Float64Array(capacity));

  let count = 0;

  for (const row of rows) {
    let usable = true;
    const factorSlot = count * factorCount;

    for (let f = 0; f < factorCount && usable; f++) {
      const raw = Number(row?.[factorTerms[f].key]);
      const value = Number.isFinite(raw) ? factorTerms[f].ops.forward(raw) : Number.NaN;
      if (!Number.isFinite(value)) {
        usable = false;
        break;
      }
      rawFactors[factorSlot + f] = raw;
      design[factorSlot + f] = value;
    }

    for (let r = 0; r < responseCount && usable; r++) {
      const raw = Number(row?.[responseTerms[r].key]);
      const value = Number.isFinite(raw) ? responseTerms[r].ops.forward(raw) : Number.NaN;
      if (!Number.isFinite(value)) {
        usable = false;
        break;
      }
      rawResponses[r][count] = raw;
      transformedResponses[r][count] = value;
    }

    if (usable) {
      count += 1;
    }
  }

  return { design, rawFactors, transformedResponses, rawResponses, count };
}

export function createLogLinearModel({ factors, responses, rows, options = {} } = {}) {
  const factorTerms = normalizeTerms(factors, options.factorTransform ?? DEFAULT_FACTOR_TRANSFORM);
  const responseTerms = normalizeTerms(responses, options.responseTransform ?? DEFAULT_RESPONSE_TRANSFORM);
  const factorCount = factorTerms.length;

  if (!Array.isArray(rows)) {
    throw new Error("profilerModel: rows must be an array.");
  }

  const { design, rawFactors, transformedResponses, rawResponses, count } =
    collectDesign(rows, factorTerms, responseTerms);

  if (count <= factorCount) {
    throw new Error(`profilerModel: need more than ${factorCount} usable rows to fit, got ${count}.`);
  }

  const factorStats = factorTerms.map(() => ({
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    mean: 0,
    transformedMean: 0,
    transformedSd: 1,
    degenerate: false
  }));

  for (let i = 0; i < count; i++) {
    const slot = i * factorCount;
    for (let f = 0; f < factorCount; f++) {
      const raw = rawFactors[slot + f];
      const stats = factorStats[f];
      if (raw < stats.min) stats.min = raw;
      if (raw > stats.max) stats.max = raw;
      stats.mean += raw;
      stats.transformedMean += design[slot + f];
    }
  }

  for (const stats of factorStats) {
    stats.mean /= count;
    stats.transformedMean /= count;
  }

  for (let i = 0; i < count; i++) {
    const slot = i * factorCount;
    for (let f = 0; f < factorCount; f++) {
      const deviation = design[slot + f] - factorStats[f].transformedMean;
      factorStats[f].transformedSd += deviation * deviation;
    }
  }

  for (const stats of factorStats) {
    const variance = stats.transformedSd / count;
    stats.transformedSd = Math.sqrt(variance);
    if (!(stats.transformedSd > 0)) {
      stats.transformedSd = 1;
      stats.degenerate = true;
    }
  }

  const responseStats = responseTerms.map((term, r) => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let mean = 0;
    let transformedMean = 0;
    for (let i = 0; i < count; i++) {
      const raw = rawResponses[r][i];
      if (raw < min) min = raw;
      if (raw > max) max = raw;
      mean += raw;
      transformedMean += transformedResponses[r][i];
    }
    return {
      key: term.key,
      min,
      max,
      mean: mean / count,
      transformedMean: transformedMean / count
    };
  });

  // Standardized design so the normal equations stay well conditioned when the
  // factors live on wildly different scales (span fraction vs planform area).
  const gram = Array.from({ length: factorCount }, () => new Float64Array(factorCount));
  const projections = responseTerms.map(() => new Float64Array(factorCount));
  const centeredScratch = new Float64Array(factorCount);

  for (let i = 0; i < count; i++) {
    const slot = i * factorCount;

    for (let f = 0; f < factorCount; f++) {
      const stats = factorStats[f];
      centeredScratch[f] = stats.degenerate
        ? 0
        : (design[slot + f] - stats.transformedMean) / stats.transformedSd;
    }

    for (let a = 0; a < factorCount; a++) {
      const value = centeredScratch[a];
      if (value === 0) continue;
      for (let b = 0; b <= a; b++) {
        gram[a][b] += value * centeredScratch[b];
      }
    }

    for (let r = 0; r < responseTerms.length; r++) {
      const residual = transformedResponses[r][i] - responseStats[r].transformedMean;
      for (let f = 0; f < factorCount; f++) {
        projections[r][f] += centeredScratch[f] * residual;
      }
    }
  }

  for (let a = 0; a < factorCount; a++) {
    for (let b = a + 1; b < factorCount; b++) {
      gram[a][b] = gram[b][a];
    }
  }

  const solved = solveNormalEquations(gram, projections, factorCount);
  if (!solved) {
    throw new Error("profilerModel: normal equations are singular even after ridge regularization.");
  }

  const fits = new Map();

  responseTerms.forEach((term, r) => {
    const standardized = solved.solutions[r];
    const coefficients = new Float64Array(factorCount);

    for (let f = 0; f < factorCount; f++) {
      coefficients[f] = factorStats[f].degenerate
        ? 0
        : standardized[f] / factorStats[f].transformedSd;
    }

    let intercept = responseStats[r].transformedMean;
    for (let f = 0; f < factorCount; f++) {
      intercept -= coefficients[f] * factorStats[f].transformedMean;
    }

    fits.set(term.key, { term, coefficients, intercept });
  });

  function predictTransformed(fit, slot) {
    let total = fit.intercept;
    for (let f = 0; f < factorCount; f++) {
      total += fit.coefficients[f] * design[slot + f];
    }
    return total;
  }

  responseTerms.forEach((term, r) => {
    const fit = fits.get(term.key);
    let sseTransformed = 0;
    let sstTransformed = 0;
    let sseOriginal = 0;
    let sstOriginal = 0;

    for (let i = 0; i < count; i++) {
      const predictedTransformed = predictTransformed(fit, i * factorCount);
      const actualTransformed = transformedResponses[r][i];
      const deviationTransformed = actualTransformed - responseStats[r].transformedMean;
      const errorTransformed = actualTransformed - predictedTransformed;
      sseTransformed += errorTransformed * errorTransformed;
      sstTransformed += deviationTransformed * deviationTransformed;

      const actual = rawResponses[r][i];
      const errorOriginal = actual - term.ops.inverse(predictedTransformed);
      const deviationOriginal = actual - responseStats[r].mean;
      sseOriginal += errorOriginal * errorOriginal;
      sstOriginal += deviationOriginal * deviationOriginal;
    }

    fit.r2 = sstTransformed > 0 ? 1 - sseTransformed / sstTransformed : 1;
    fit.r2Original = sstOriginal > 0 ? 1 - sseOriginal / sstOriginal : 1;
    fit.rmse = Math.sqrt(sseOriginal / count);
  });

  function getFit(responseKey) {
    const fit = fits.get(responseKey);
    if (!fit) {
      throw new Error(`profilerModel: unknown response "${responseKey}".`);
    }
    return fit;
  }

  // Back-transforming exp(mean of log y) yields the conditional median rather
  // than the mean. The retransformation bias is negligible at these R2 values.
  function predict(responseKey, factorValues) {
    const fit = getFit(responseKey);
    let total = fit.intercept;

    for (let f = 0; f < factorCount; f++) {
      const term = factorTerms[f];
      const raw = Number(factorValues?.[term.key]);
      if (!Number.isFinite(raw)) {
        return Number.NaN;
      }
      total += fit.coefficients[f] * term.ops.forward(raw);
    }

    return fit.term.ops.inverse(total);
  }

  return {
    predict,
    getR2(responseKey) {
      return getFit(responseKey).r2;
    },
    getFitSummary(responseKey) {
      const fit = getFit(responseKey);
      return {
        key: fit.term.key,
        transform: fit.term.transform,
        intercept: fit.intercept,
        r2: fit.r2,
        r2Original: fit.r2Original,
        rmse: fit.rmse
      };
    },
    getFactorKeys() {
      return factorTerms.map((term) => term.key);
    },
    getResponseKeys() {
      return responseTerms.map((term) => term.key);
    },
    getFactorStats(factorKey) {
      const index = factorTerms.findIndex((term) => term.key === factorKey);
      if (index < 0) {
        return null;
      }
      const stats = factorStats[index];
      return { min: stats.min, max: stats.max, mean: stats.mean };
    },
    getResponseStats(responseKey) {
      const stats = responseStats.find((entry) => entry.key === responseKey);
      return stats ? { min: stats.min, max: stats.max, mean: stats.mean } : null;
    },
    getSampleCount() {
      return count;
    },
    getRidge() {
      return solved.ridge;
    },
    toJSON() {
      const serializedResponses = {};

      for (const term of responseTerms) {
        const fit = fits.get(term.key);
        const coefficients = {};
        factorTerms.forEach((factorTerm, f) => {
          coefficients[factorTerm.key] = fit.coefficients[f];
        });

        serializedResponses[term.key] = {
          transform: term.transform,
          intercept: fit.intercept,
          coefficients,
          r2: fit.r2,
          r2Original: fit.r2Original,
          rmse: fit.rmse
        };
      }

      return {
        version: 1,
        sampleCount: count,
        factors: factorTerms.map((term, f) => ({
          key: term.key,
          label: term.label,
          transform: term.transform,
          min: factorStats[f].min,
          max: factorStats[f].max,
          mean: factorStats[f].mean
        })),
        responses: serializedResponses
      };
    }
  };
}

export function createCoefficientModel(json) {
  if (!json?.factors?.length || !json?.responses) {
    throw new Error("profilerModel: coefficient JSON needs factors and responses.");
  }

  const factorTerms = json.factors.map((entry) => ({
    key: entry.key,
    label: entry.label ?? entry.key,
    transform: entry.transform ?? DEFAULT_FACTOR_TRANSFORM,
    ops: resolveTransform(entry.transform ?? DEFAULT_FACTOR_TRANSFORM),
    min: entry.min,
    max: entry.max,
    mean: entry.mean
  }));

  const fits = new Map();

  for (const [responseKey, entry] of Object.entries(json.responses)) {
    const transform = entry.transform ?? DEFAULT_RESPONSE_TRANSFORM;
    fits.set(responseKey, {
      key: responseKey,
      transform,
      ops: resolveTransform(transform),
      intercept: entry.intercept ?? 0,
      coefficients: factorTerms.map((term) => entry.coefficients?.[term.key] ?? 0),
      r2: entry.r2 ?? Number.NaN,
      r2Original: entry.r2Original ?? Number.NaN,
      rmse: entry.rmse ?? Number.NaN
    });
  }

  function getFit(responseKey) {
    const fit = fits.get(responseKey);
    if (!fit) {
      throw new Error(`profilerModel: unknown response "${responseKey}".`);
    }
    return fit;
  }

  return {
    predict(responseKey, factorValues) {
      const fit = getFit(responseKey);
      let total = fit.intercept;

      for (let f = 0; f < factorTerms.length; f++) {
        const term = factorTerms[f];
        const raw = Number(factorValues?.[term.key]);
        if (!Number.isFinite(raw)) {
          return Number.NaN;
        }
        total += fit.coefficients[f] * term.ops.forward(raw);
      }

      return fit.ops.inverse(total);
    },
    getR2(responseKey) {
      return getFit(responseKey).r2;
    },
    getFitSummary(responseKey) {
      const fit = getFit(responseKey);
      return {
        key: fit.key,
        transform: fit.transform,
        intercept: fit.intercept,
        r2: fit.r2,
        r2Original: fit.r2Original,
        rmse: fit.rmse
      };
    },
    getFactorKeys() {
      return factorTerms.map((term) => term.key);
    },
    getResponseKeys() {
      return Array.from(fits.keys());
    },
    getFactorStats(factorKey) {
      const term = factorTerms.find((entry) => entry.key === factorKey);
      if (!term || !Number.isFinite(term.min) || !Number.isFinite(term.max)) {
        return null;
      }
      return { min: term.min, max: term.max, mean: term.mean ?? (term.min + term.max) / 2 };
    },
    getResponseStats() {
      return null;
    },
    getSampleCount() {
      return json.sampleCount ?? null;
    },
    getRidge() {
      return 0;
    },
    toJSON() {
      return json;
    }
  };
}
