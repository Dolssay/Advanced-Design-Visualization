# Demo 1: GTB777 WebViz

Interactive browser viewer for the GT B777 horizontal-tail ensemble. The
page loads `data/GTB777.csv` and shows a scatterplot matrix with zoom,
selection, and overlaid tail sketches.

Run every command from the repository root.

## Setup

```
pip install pandas --break-system-packages
```

Put the Monte Carlo export at `data/MonteCarlo.csv`. The filter script
writes the viewer dataset to `data/GTB777.csv`.

## 0. Filter the source CSV

```
python "src/Demo 1/filterGTB777.py"
```

This keeps the selected geometry and performance columns and adds JMP-style
`Label` values. Override paths with `--input` / `--output` if needed; both
default to files under `data/` at the repository root.

## 1. Serve the viewer

```
npx.cmd http-server . -p 8000
```

Do not open the page as `file://`. ES modules and CSV loading need HTTP.

## 2. Open the scatterplot matrix

```
http://localhost:8000/src/Demo%201/WebViz/index.html
```

Grey/colored points, brushing, and the Content panel all share the same
filtered GTB777 table.

## 3. Optional: JMP-style Python analysis

The original HTP design-space scripts (scatterplot matrix, variable
importance, constraint ranking, Pareto tradeoff) live in `misc/`. See
`misc/README.md`. Those scripts expect a full DOE export at
`data/full_htp_doe.csv`.

## Notes

- The viewer fetches `../../../data/GTB777.csv` from `WebViz/`.
- Refresh the page after regenerating the CSV.
- Python analysis helpers that are not part of the web demo are in `misc/`.
