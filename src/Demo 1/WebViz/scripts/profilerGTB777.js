import { createLogLinearModel } from "./profilerModel.js";
import { createProfiler } from "./profiler.js";

const FACTORS = [
  { key: "ARHT", label: "ARHT" },
  { key: "TRHT", label: "TRHT" },
  { key: "TCHT", label: "TCHT" },
  { key: "SWPHT (deg)", label: "SWPHT", unit: "deg" },
  { key: "SHT (sqft)", label: "SHT", unit: "sqft" },
  { key: "ETAIE", label: "ETAIE" },
  { key: "ETAOE", label: "ETAOE" },
  { key: "CRE", label: "CRE" }
];

const RESPONSES = [
  { key: "OEW (1000 lbm)", label: "OEW", unit: "1000 lbm" },
  { key: "Block Fuel (1000 lbm)", label: "Block Fuel", unit: "1000 lbm" },
  { key: "Cruise CD (count)", label: "Cruise CD", unit: "count" }
];

export function createGTB777ProfilerModel(data) {
  return createLogLinearModel({ factors: FACTORS, responses: RESPONSES, rows: data });
}

export function createGTB777Profiler(data, model = null) {
  const fitted = model ?? createGTB777ProfilerModel(data);

  return createProfiler({
    factors: FACTORS,
    responses: RESPONSES,
    model: fitted,
    title: "GTB777 Prediction Profiler",
    subtitle: `Fitted response surface over all ${fitted.getSampleCount()} designs. Curves come from the regression, not the sampled points.`
  });
}
