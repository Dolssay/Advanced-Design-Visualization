# WebViz Agent Notes

These instructions apply to files in this `frontend/demo1` directory (formerly `src/Demo 1/WebViz`) and its subdirectories.

## Project Structure

- Keep `index.html`, `main.js`, and `README.md` at the root of `demo1`.
- Store JavaScript helper modules in `scripts/`.
- Store CSS stylesheets in `stylings/`.
- The viewer loads `/data/GTB777.csv` from `frontend/public/data/`; do not copy data into `demo1`.

## JavaScript

- Use ES module imports. `main.js` imports `../shared/d3-global.js` first so the global `d3` exists before any plot module runs; keep it the first import.
- Import local helper modules from `./scripts/...` in root files and relative sibling paths inside `scripts/`.
- Keep menu/sidebar helpers in `scripts/contentbox.js` when working on the Content panel.
- Keep left-side plot navigation in `scripts/tiltleTab.js`.
- The Content box is created once in `main.js` (not inside any plot) and sits in a sticky right-hand column beside every plot listed in `LINKED_PLOTS`. A new plot that reacts to the label filter or highlighted points belongs in `LINKED_PLOTS`; one that does not belongs in `STANDALONE_PLOTS`, below.
- Heavy per-row work for a plot runs in its own worker (`lineDensityWorker.js` for parallel coordinates, `heatmapWorker.js` for the heatmap); keep the pure math in a DOM-free module so the main-thread fallback can reuse it.
- Keep the shared aircraft sketch renderer in `scripts/sketchGTB777.js`; reuse its `getGTB777SketchColor()` anywhere a "drawn" point needs a consistent highlight color (the scatterplot matrix's sketch panel and the parallel coordinates highlighted lines both depend on it).
- Keep the parallel coordinates renderer in `scripts/parallelCoordinates.js` (`createParallelCoordinates`). It follows the same `controller`/`contentController` pattern as `scripts/splomGTB777.js`: a canvas layer draws the bulk of the lines in chunks via `requestAnimationFrame` (for performance across the full dataset) while an SVG overlay draws axes and labels; it re-renders on `contentController` label-filter events and on `controller` pin/draw events the same way the scatterplot matrix cells do.
- `scripts/parallelCoordinates.js` is currently a standalone module — it is not yet imported by `main.js` or linked from `index.html`. When wiring it up, add an entry to the `PLOTS` array in `main.js` (e.g. `{ id: "plot-parallel-coordinates", title: "Parallel Coordinates" }`), pass that `id` to `createPlotSection` from `scripts/tiltleTab.js` so it appears in the left-side navigation, and give it its own stylesheet (see CSS section below) before considering it finished.
- Prefer CSS classes over inline style assignments.
- Use inline styles only for runtime values that must be computed dynamically, such as canvas dimensions, tooltip positions, cursor state, and selection overlay geometry.
- The frontend is a Vite multi-page app (`frontend/vite.config.js`). Keep D3-dependent code as plain ES modules; no framework.

## CSS

- Put shared page styles in `stylings/base.css`.
- Put left-side plot navigation styles in `stylings/tiltleTab.css`.
- Put toolbar styles in `stylings/tools.css`.
- Put Content panel styles in `stylings/content.css`.
- Put scatterplot matrix styles in `stylings/splomGTB777.css`.
- Put plot cell, canvas, tooltip, and selection overlay styles in `stylings/zoomablePlot.css`.
- Put box & violin styles in `stylings/boxViolinPlot.css` and heatmap styles in `stylings/heatmapPlot.css`.
- Put parallel coordinates styles in `stylings/parallelCoordinates.css`, styling the `parallel-*` classes from `scripts/parallelCoordinates.js` (`parallel-container`, `parallel-header`, `parallel-title`, `parallel-subtitle`, `parallel-frame`, `parallel-canvas`, `parallel-svg`, `parallel-axis`, `parallel-axis-label`, `parallel-legend`, `parallel-legend-item`, `parallel-legend-swatch`). This file does not exist yet — create it and link it from `index.html` as part of finishing the parallel coordinates plot.
- If JavaScript needs to pass dynamic visual values to CSS, prefer CSS custom properties over hardcoded inline declarations.

## HTML

- Link all stylesheet files from `index.html`.
- Keep the app root as `<div id="app"></div>`.
- Keep the module entrypoint as `./main.js`.

## Validation

- From `frontend/`, run `npm run dev` and open `http://localhost:5173/demo1/`.
- `npm run build` must succeed (it bundles the workers too).
- Do not test via `file://`, because ES modules and CSV loading require HTTP serving.
