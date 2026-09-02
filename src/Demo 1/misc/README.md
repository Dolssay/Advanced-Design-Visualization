# HTP Design-Space Exploration Toolkit

Python replacement for the JMP workflow, built around your four goals.

Run every command from the repository root. Data files live under `data/`
at the root, not next to these scripts.

## Setup

```
pip install pandas numpy matplotlib scikit-learn --break-system-packages
```

Put your full DOE export at `data/full_htp_doe.csv` (same column
schema as the sample you provided — this is a like-for-like drop-in).

## 0. Before you run anything: fix the constraint limits

**Open `src/Demo 1/misc/htp_config.py` first.** The `CONSTRAINTS` dict has one entry per
`Cert_S*` column. The speed-ratio (§25.107) and OEI climb-gradient
(§25.121) limits are real regulatory numbers for a two-engine airplane and
are safe defaults. Everything involving elevator/rudder/aileron authority
limits (degrees), the §25.181 damping-ratio / time-to-double guideline
values, and the §25.125 touchdown sink rate are placeholders — they depend
on your specific airplane and certification basis. Get the real numbers
from your flight-dynamics/loads team and edit them there; every script
reads from this one file, so you only fix it once.

## 1. Recreate the JMP-style scatterplot matrix

```
python "src/Demo 1/misc/01_scatterplot_matrix.py" data/full_htp_doe.csv --highlight feasible
```

Grey = full sampled design space, black = the subset that satisfies every
constraint in `htp_config.py` (or pass `--highlight pareto` to instead
highlight the `Unconstrained Pareto Front` column already in your data).
Edit `MATRIX_VARS` at the top of the script to plot different response
variables.

## 2. Which variables are important

```
python "src/Demo 1/misc/02_variable_importance.py" data/full_htp_doe.csv
```

Fits a random-forest surrogate per objective (OEW, block fuel, CD) and
ranks `DV_*` by permutation importance. The rank heatmap is the key output:
a variable that's rank-1 for every objective is just a hard design driver
you need to get right; a variable that's rank-1 for CD but rank-6 for OEW
is a genuine tradeoff lever.

## 3. Which constraints are active and shrink the space

```
python "src/Demo 1/misc/03_constraint_analysis.py" data/full_htp_doe.csv --x DV_ARHT --y DV_SHT
```

Ranks every `Cert_S*` constraint by how often it's the *tightest* margin
across your sampled points (not just how often it's violated), and maps
which constraint dominates which region of two chosen design variables —
swap `--x`/`--y` for whichever pair scores highest in step 2. This is the
piece that tells you e.g. "the low-aspect-ratio, small-tail corner of the
space is being carved off by the §25.121(a) 2nd-segment climb requirement,
not by controllability."

## 4. Multi-objective tradeoff and geometry comparison

```
python "src/Demo 1/misc/04_pareto_tradeoff.py" data/full_htp_doe.csv --obj-a OEW_lbm --obj-b CD
```

Computes the non-dominated front between two objectives among *feasible*
designs only, plots it colored by a third objective (block fuel by
default), and — the direct answer to your weight-vs-drag question — pulls
out the geometry at each end of the front and compares them side by side
in a table (`*_bookend_geometry.csv`) and a normalized bar chart. Re-run
with `--obj-a Mission_BlockFuel_lbm --obj-b CD` or any other objective pair
you want to inspect.

## Notes on the sample data

The 7-row file you provided is enough to prove every script runs
end-to-end (which I did), but it's far too small for the importance
rankings, constraint-binding frequencies, or Pareto front to mean anything
statistically — you'll see that reflected as a warning when you run script
02. Point everything at your real DOE (thousands of design points, per the
image you shared) for real results. The pipeline doesn't need changes to
scale up, just a bigger CSV.
