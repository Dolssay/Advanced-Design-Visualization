# WebViz Viewer

This folder contains a static browser viewer for the `GTB777.csv` dataset.

## Files

- `index.html` - page shell for the scatterplot matrix viewer
- `main.js` - entrypoint that loads the CSV and attaches the plot
- `scripts/filteredGTB777.js` - CSV loader and data filter
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

1. Generate or update the dataset:
   ```bash
   python "src/Demo 1/filterGTB777.py"
   ```
   This writes `data/GTB777.csv` at the repository root.

2. Start a local HTTP server from the repository root:
   ```powershell
   npx.cmd http-server . -p 8000
   ```

   This serves the repository so the browser can load module imports and CSV data correctly.

3. Open the viewer in your browser:
   ```text
   http://localhost:8000/src/Demo%201/WebViz/index.html
   ```

   Do not open the file as `file://...`.

## Layout

- Plots linked to the Content box (label filter and highlighted points) sit in one column with the sticky Content box on their right: Scatterplot Matrix, Parallel Coordinates, Box & Violin by Label, Design-Space Heatmap, then the Tornado Plot (filter only, no highlighted points).
- Plots that ignore the Content box (the Prediction Profiler) follow below at full width.
- New linked plots go into `LINKED_PLOTS` in `main.js`; standalone ones into `STANDALONE_PLOTS`.

## Notes

- The page uses ES module imports and fetches `../../../data/GTB777.csv`.
- Serving via `http://localhost:8000` avoids browser restrictions on local module imports and CSV loading.
- If you change the data file, refresh the page to reload the updated dataset.

## Troubleshooting

- If the browser shows a module import error, confirm the server is running and that you opened `http://localhost:8000/...` rather than a `file://` URL.
- If `GTB777.csv` fails to load, verify the file exists at `data/GTB777.csv` in the repository root.
