# Demo 1 data prep (offline)

Offline Python tools behind Demo 1. The viewer itself now lives in
`frontend/demo1/` and reads `frontend/public/data/GTB777.csv`.

Run every command from the repository root.

## Setup

```
pip install pandas --break-system-packages
```

Put the Monte Carlo export at `data/MonteCarlo.csv` (git-ignored). Write the
viewer dataset to `frontend/public/data/GTB777.csv`.

## 0. Filter the source CSV

```
python tools/demo1-prep/filterGTB777.py --output frontend/public/data/GTB777.csv
```

This keeps the selected geometry and performance columns and adds JMP-style
`Label` values. Override paths with `--input` / `--output` if needed; both
default to files under `data/` at the repository root.

## 1. View it

From `frontend/`, run `npm run dev` and open `http://localhost:5173/demo1/`.
See `frontend/demo1/README.md`.

## 2. Optional: JMP-style Python analysis

The original HTP design-space scripts (scatterplot matrix, variable
importance, constraint ranking, Pareto tradeoff) live in `misc/`. See
`misc/README.md`. Those scripts expect a full DOE export at
`data/full_htp_doe.csv`.

## Notes

- The viewer fetches `/data/GTB777.csv` (`frontend/public/data/GTB777.csv`).
- Refresh the page after regenerating the CSV.
- Python analysis helpers that are not part of the web demo are in `misc/`.
