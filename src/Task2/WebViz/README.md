# WebViz Viewer

This folder contains a static browser viewer for the `GTB777.csv` dataset.

## Files

- `index.html` — page shell for the scatterplot matrix viewer
- `main.js` — entrypoint that loads the CSV and attaches the plot
- `filteredGTB777.js` — CSV loader and data filter
- `splomGTB777.js` — scatterplot matrix builder
- `zoomablePlot.js` — zoom/pan scatterplot cell renderer
- `README.md` — this file

## Setup

1. Generate or update the dataset:
   ```bash
   python src/Task2/filterGTB777.py
   ```
   This writes `src/Task2/data/GTB777.csv`.

2. Start a local HTTP server from the repository root (`Task`):
   ```powershell
   cd "e:\Work\Summer 2026\AOE\Task"
   npx http-server . -p 8000
   ```

   This serves the repository so the browser can load module imports and CSV data correctly.

3. Open the viewer in your browser:
   ```text
   http://localhost:8000/src/Task2/WebViz/index.html
   ```

   Do not open the file as `file://...`.

## Notes

- The page uses ES module imports and fetches `../data/GTB777.csv`.
- Serving via `http://localhost:8000` avoids browser restrictions on local module imports and CSV loading.
- If you change the data file, refresh the page to reload the updated dataset.

## Troubleshooting

- If the browser shows a module import error, confirm the server is running and that you opened `http://localhost:8000/...` rather than a `file://` URL.
- If `GTB777.csv` fails to load, verify the file exists at `src/Task2/data/GTB777.csv` relative to `src/Task2/WebViz/index.html`.
