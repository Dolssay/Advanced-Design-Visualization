# Demo 1 data prep (offline)

Offline Python tools behind Demo 1. The viewer itself now lives in
`frontend/demo1/` and reads `frontend/public/data/GTB777.bin`.

Run every command from the repository root.

## Setup

```
pip install pandas --break-system-packages
```

Put the Monte Carlo export at `data/MonteCarlo.csv` (git-ignored). Write the
viewer dataset to `frontend/public/data/GTB777.bin`.

## 0. Filter the source CSV

```
python tools/demo1-prep/filterGTB777.py --output frontend/public/data/GTB777.bin
```

Full 1M-design set (about 185 MB, git-ignored; open `/demo1/?data=GTB777-1M`):

```
python tools/demo1-prep/filterGTB777.py --input data/MonteCarlo1M.csv --output frontend/public/data/GTB777-1M.bin
```

This keeps the selected geometry and performance columns and adds JMP-style
`Label` values. The output is one binary file: a JSON header, then each column as
raw little-endian bytes (Float64 values, Uint8 label codes), so the browser loads it
without parsing. Override paths with `--input` / `--output` if needed; both
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

- The viewer fetches `/data/GTB777.bin` (`frontend/public/data/GTB777.bin`).
- Refresh the page after regenerating the CSV.
- Python analysis helpers that are not part of the web demo are in `misc/`.
