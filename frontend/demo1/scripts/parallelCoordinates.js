import d3 from "../../shared/d3-global.js";
import { createParallelCoordinates as createSharedParallelCoordinates } from "../../shared/plots/parallelCoordinates.js";
import { getGTB777SketchColor } from "./sketchGTB777.js";
import { getHighlightOutlineColor } from "./colorUtils.js";
import { HIGHLIGHT_OUTLINE_COLOR, LABEL_COLORS, SELECTION_COLOR } from "./gtb777Dimensions.js";

const drawOrder = {
  Infeasible: 0,
  "Level 2-2": 1,
  "Level 2-1": 2,
  "Level 1-1": 3,
};

const colorDomain = ["Infeasible", "Level 2-2", "Level 2-1", "Level 1-1"];
const colorRange = LABEL_COLORS;

const dimensions = [
  { key: "ARHT", label: "ARHT" },
  { key: "TRHT", label: "TRHT" },
  { key: "TCHT", label: "TCHT" },
  { key: "SWPHT (deg)", label: "SWPHT (deg)" },
  { key: "SHT (sqft)", label: "SHT (sqft)" },
  { key: "ETAIE", label: "ETAIE" },
  { key: "ETAOE", label: "ETAOE" },
  { key: "CRE", label: "CRE" },
  { key: "OEW (1000 lbm)", label: "OEW (1000 lbm)" },
  { key: "Block Fuel (1000 lbm)", label: "Block Fuel (1000 lbm)" },
  { key: "Cruise CD (count)", label: "Cruise CD (count)" },
];

export function createParallelCoordinates(data, controller = null, contentController = null) {
  const color = d3.scaleOrdinal(colorDomain, colorRange);
  return createSharedParallelCoordinates(data, {
    dimensions,
    colorBy: (row) => color(row.Label),
    drawOrder,
    title: "GTB777 Parallel Coordinates",
    subtitle: "Each line represents one aircraft design; colors indicate feasibility level.",
    colorDomain,
    colorRange,
    controller,
    contentController,
    workerUrl: new URL("./lineDensityWorker.js", import.meta.url),
    getSketchColor: getGTB777SketchColor,
    getHighlightOutlineColor: getHighlightOutlineColor,
  });
}
