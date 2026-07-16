"""
01_scatterplot_matrix.py

Recreates the look of the JMP scatterplot matrix: a lower-triangular grid of
pairwise scatterplots, shared axes down columns / across rows, full
population in grey with a highlighted subset (feasible, or Pareto-optimal)
overplotted in black.

Usage:
    python 01_scatterplot_matrix.py <csv_path> [--highlight feasible|pareto]
"""

import argparse
import sys

import matplotlib.pyplot as plt
import pandas as pd

from data_utils import load_doe, compute_margins, add_feasibility
from htp_config import CONSTRAINTS

# Variables shown in the matrix -- edit this list for your own responses
MATRIX_VARS = ["OEW_lbm", "Mission_BlockFuel_lbm", "CD"]
MATRIX_LABELS = {
    "OEW_lbm": "OEW (1000 lbm)",
    "Mission_BlockFuel_lbm": "Block Fuel (1000 lbm)",
    "CD": "Cruise CD (count)",
}
MATRIX_SCALE = {  # divide raw values by this before plotting, to match JMP axis units
    "OEW_lbm": 1000.0,
    "Mission_BlockFuel_lbm": 1000.0,
    "CD": 1 / 1e4,  # CD as drag counts (CD * 10,000)
}


def plot_scatterplot_matrix(df, variables, highlight_mask, highlight_label,
                             labels=None, scale=None, out_path=None):
    labels = labels or {v: v for v in variables}
    scale = scale or {v: 1.0 for v in variables}
    n = len(variables)

    fig, axes = plt.subplots(n - 1, n - 1, figsize=(3.2 * (n - 1), 3.2 * (n - 1)))
    if n == 2:
        axes = [[axes]]

    plot_df = df.copy()
    for v in variables:
        plot_df[v] = plot_df[v] * scale.get(v, 1.0)

    for row in range(1, n):          # rows = variables[1:]
        for col in range(0, n - 1):  # cols = variables[:-1]
            ax = axes[row - 1][col]
            if col >= row:
                ax.axis("off")
                continue

            xvar, yvar = variables[col], variables[row]
            x, y = plot_df[xvar], plot_df[yvar]

            ax.scatter(x[~highlight_mask], y[~highlight_mask],
                       s=4, c="0.65", alpha=0.5, linewidths=0, zorder=1)
            ax.scatter(x[highlight_mask], y[highlight_mask],
                       s=4, c="black", alpha=0.8, linewidths=0, zorder=2)

            if row == n - 1:
                ax.set_xlabel(labels.get(xvar, xvar))
            else:
                ax.set_xticklabels([])
            if col == 0:
                ax.set_ylabel(labels.get(yvar, yvar))
            else:
                ax.set_yticklabels([])

            ax.tick_params(direction="in", top=True, right=True)
            for spine in ax.spines.values():
                spine.set_visible(True)

    fig.suptitle(f"Black = {highlight_label}   |   Grey = full design space", y=1.02)
    fig.tight_layout()
    if out_path:
        fig.savefig(out_path, dpi=200, bbox_inches="tight")
        print(f"Saved: {out_path}")
    return fig


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--highlight", choices=["feasible", "pareto"], default="feasible")
    ap.add_argument("--out", default="scatterplot_matrix.png")
    args = ap.parse_args()

    df = load_doe(args.csv_path)

    if args.highlight == "feasible":
        margins = compute_margins(df)
        df_full = add_feasibility(df, margins, exclude_cols=["Cert_S125_RoD_TD"])
        mask = df_full["Feasible"]
        label = "certification-feasible (all Subpart B margins >= 0)"
    else:
        if "Unconstrained Pareto Front" not in df.columns:
            print("No 'Unconstrained Pareto Front' column found; falling back to feasible.",
                  file=sys.stderr)
            margins = compute_margins(df)
            df_full = add_feasibility(df, margins, exclude_cols=["Cert_S125_RoD_TD"])
            mask = df_full["Feasible"]
            label = "certification-feasible"
        else:
            mask = df["Unconstrained Pareto Front"].astype(bool)
            label = "unconstrained Pareto front"

    plot_scatterplot_matrix(df, MATRIX_VARS, mask, label,
                             labels=MATRIX_LABELS, scale=MATRIX_SCALE, out_path=args.out)


if __name__ == "__main__":
    main()
