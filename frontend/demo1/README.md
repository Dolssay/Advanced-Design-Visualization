# WebViz Viewer

This folder contains a static browser viewer for the GTB777 dataset (`GTB777.bin`).

## Files

- `index.html` - page shell for the scatterplot matrix viewer
- `main.js` - entrypoint that loads the CSV and attaches the plot
- `scripts/filteredGTB777.js` - dataset loader and data filter
- `scripts/columnFile.js` - reads the binary column file into typed arrays
- `scripts/splomGTB777.js` - scatterplot matrix builder
- `scripts/tools.js` - shared toolbar and plot interaction controller
- `scripts/zoomablePlot.js` - zoom/pan scatterplot cell renderer
- `scripts/profiler.js` - config-driven prediction profiler renderer, reusable across demos
- `scripts/profilerModel.js` - least-squares fit and the predict/coefficient-JSON interface
- `scripts/profilerGTB777.js` - GTB777 factor and response config, plus the profiler's controller wiring
- `scripts/tornadoPlot.js` - model-based one-at-a-time sensitivity (tornado) plot
- `scripts/boxViolinPlot.js` - box & violin plot of every column, split by feasibility label
- `scripts/heatmapPlot.js` - design-space heatmap (two columns binned, colored by count, label share or mean output)
- `scripts/heatmapWorker.js` / `scripts/heatmapBinning.js` - worker thread and pure binning core behind the heatmap
- `scripts/gtb777Dimensions.js` - shared column/label metadata for the box & violin plot and heatmap
- `stylings/` - CSS files for the page, toolbar, matrix, and plot cells
- `README.md` - this file

## Setup

1. Regenerate the dataset only if the Monte Carlo export changed (see `tools/demo1-prep/README.md`):
   ```bash
   python tools/demo1-prep/filterGTB777.py --input data/MonteCarlo.csv --output frontend/public/data/GTB777.bin
   ```
   For the full 1M-design set (not in git), write `GTB777-1M.bin` from `data/MonteCarlo1M.csv` and open `/demo1/?data=GTB777-1M`.

2. Start the Vite dev server from `frontend/`:
   ```bash
   npm install
   npm run dev
   ```

3. Open the viewer at `http://localhost:5173/demo1/`.

Demo 1 needs no backend. The page loads d3 from npm (`shared/d3-global.js`) instead of a CDN.

## Layout

- Plots linked to the Content box (label filter and highlighted points) sit in one column with the sticky Content box on their right: Scatterplot Matrix, Parallel Coordinates, Box & Violin by Label, Design-Space Heatmap, then the Tornado Plot (filter only, no highlighted points).
- Plots that ignore the Content box (the Prediction Profiler) follow below at full width.
- New linked plots go into `LINKED_PLOTS` in `main.js`; standalone ones into `STANDALONE_PLOTS`.

## Notes

- The page fetches `/data/GTB777.bin`, served from `frontend/public/data/` (Vite in dev, nginx in the container).
- Use the dev server rather than `file://`: ES modules, workers and the CSV fetch need HTTP.
- If you change the data file, refresh the page to reload the updated dataset.

## Troubleshooting

- If the browser shows a module import error, confirm `npm run dev` is running and that you opened `http://localhost:5173/demo1/`.
- If `GTB777.bin` fails to load, verify the file exists at `frontend/public/data/GTB777.bin`.
