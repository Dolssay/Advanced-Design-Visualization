// Shared GTB777 column and label metadata. Every plot takes its label and selection
// colors from here, and these come from the tokens in shared/tokens.css, so a label
// reads the same everywhere.
import { cssVar } from "./colorUtils.js";

export const LABEL_DOMAIN = ["Infeasible", "Level 2-2", "Level 2-1", "Level 1-1"];
export const LABEL_COLORS = [
  cssVar("--gtb-label-infeasible", "#b0b0b0"),
  cssVar("--gtb-label-l22", "#d62728"),
  cssVar("--gtb-label-l21", "#000000"),
  cssVar("--gtb-label-l11", "#4a90e2")
];

export function getLabelColor(label) {
  const index = LABEL_DOMAIN.indexOf(label);
  return index >= 0 ? LABEL_COLORS[index] : cssVar("--muted", "#5f5f5b");
}

// Color for a design that has been click-selected (added to the Content box's
// highlighted points list), used by every linked plot.
export const SELECTION_COLOR = cssVar("--selection", "#861f41");
export const HIGHLIGHT_OUTLINE_COLOR = cssVar("--ink", "#141414");

export const DIMENSIONS = [
  { key: "ARHT", label: "ARHT", unit: "", group: "input" },
  { key: "TRHT", label: "TRHT", unit: "", group: "input" },
  { key: "TCHT", label: "TCHT", unit: "", group: "input" },
  { key: "SWPHT (deg)", label: "SWPHT", unit: "deg", group: "input" },
  { key: "SHT (sqft)", label: "SHT", unit: "sqft", group: "input" },
  { key: "ETAIE", label: "ETAEI", unit: "", group: "input" },
  { key: "ETAOE", label: "ETAEO", unit: "", group: "input" },
  { key: "CRE", label: "CRE", unit: "", group: "input" },
  { key: "OEW (1000 lbm)", label: "OEW", unit: "1000 lbm", group: "output" },
  { key: "Block Fuel (1000 lbm)", label: "Block Fuel", unit: "1000 lbm", group: "output" },
  { key: "Cruise CD (count)", label: "Cruise CD", unit: "counts", group: "output" }
];

export function formatDimensionTitle(dimension) {
  return dimension.unit ? `${dimension.label} (${dimension.unit})` : dimension.label;
}

// Compact number formatting that keeps small design-variable values (e.g. TCHT 0.088)
// readable without printing long float tails.
export function formatValue(value) {
  if (!Number.isFinite(value)) {
    return "–";
  }
  const magnitude = Math.abs(value);
  if (magnitude >= 100) return value.toFixed(1);
  if (magnitude >= 10) return value.toFixed(2);
  if (magnitude >= 1) return value.toFixed(3);
  return value.toFixed(4);
}
