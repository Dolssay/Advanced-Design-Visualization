"""
03_constraint_analysis.py

Identifies which Subpart B constraints are actually binding across the DOE,
and where in design-variable space each one dominates.

Two outputs:
  1. A ranked bar chart of "how often is each constraint the binding one"
     across the sampled design space (using normalized margins so degrees,
     ratios, and seconds are comparable).
  2. A 2D design-variable scatter (pick your two most important DVs from
     script 02) colored by which constraint is binding at each point --
     this is the visual "constraint map" of the feasible region.

Usage (from repository root):
    python "tools/demo1-prep/misc/03_constraint_analysis.py" data/full_htp_doe.csv --x DV_ARHT --y DV_SHT
"""

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

from data_utils import load_doe, compute_margins, normalized_margins, add_feasibility
from htp_config import CONSTRAINTS

DEFAULT_CSV = Path("data/full_htp_doe.csv")

EXCLUDE = ["Cert_S125_RoD_TD"]  # constraints without a real numeric limit set yet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path", nargs="?", default=str(DEFAULT_CSV))
    ap.add_argument("--x", default="DV_ARHT", help="design variable for x-axis of constraint map")
    ap.add_argument("--y", default="DV_SHT", help="design variable for y-axis of constraint map")
    ap.add_argument("--out-prefix", default="constraint_analysis")
    args = ap.parse_args()

    df = load_doe(args.csv_path)
    margins = compute_margins(df)
    df_full = add_feasibility(df, margins, exclude_cols=EXCLUDE)

    n_feasible = df_full["Feasible"].sum()
    print(f"{n_feasible} / {len(df_full)} design points "
          f"({100*n_feasible/len(df_full):.1f}%) satisfy every modeled constraint.")

    # --- 1. Which constraint binds most often? ---
    use_cols = [c for c in margins.columns if c.replace("margin__", "") not in EXCLUDE]
    norm = normalized_margins(margins[use_cols])
    binding_col = norm.idxmin(axis=1).str.replace("margin__", "", regex=False)
    binding_counts = binding_col.value_counts()
    binding_frac = binding_counts / len(df_full)

    # also count outright violations (margin < 0) per constraint, not just "closest"
    violation_frac = (margins[use_cols] < 0).mean().rename(
        lambda c: c.replace("margin__", ""))

    summary = pd.DataFrame({
        "pct_of_designs_closest_to_this_limit": (binding_frac * 100).round(1),
        "pct_of_designs_violating_this_limit": (violation_frac * 100).round(1),
    }).reindex(binding_frac.index).sort_values(
        "pct_of_designs_closest_to_this_limit", ascending=False)
    summary["subpart"] = [CONSTRAINTS[c]["subpart"] for c in summary.index]

    print("\nConstraint criticality ranking (top 10):")
    print(summary.head(10).to_string())
    summary.to_csv(f"{args.out_prefix}_summary.csv")
    print(f"\nSaved full ranking: {args.out_prefix}_summary.csv")

    top_n = min(12, len(summary))
    fig, ax = plt.subplots(figsize=(8, 0.4 * top_n + 2))
    plot_data = summary.head(top_n).iloc[::-1]
    ax.barh(plot_data.index, plot_data["pct_of_designs_closest_to_this_limit"],
            color="firebrick")
    ax.set_xlabel("% of sampled design points where this is the binding constraint")
    ax.set_title("Which certification requirements shape the feasible region?")
    fig.tight_layout()
    fig.savefig(f"{args.out_prefix}_ranking.png", dpi=200, bbox_inches="tight")
    print(f"Saved: {args.out_prefix}_ranking.png")

    # --- 2. Constraint map over two design variables ---
    if args.x in df.columns and args.y in df.columns:
        fig2, ax2 = plt.subplots(figsize=(7, 6))
        top_constraints = binding_col.value_counts().head(6).index
        cmap = plt.get_cmap("tab10")
        for i, c in enumerate(top_constraints):
            mask = binding_col == c
            ax2.scatter(df.loc[mask, args.x], df.loc[mask, args.y],
                        s=10, alpha=0.7, color=cmap(i), label=c)
        infeasible = ~df_full["Feasible"]
        if infeasible.any():
            ax2.scatter(df.loc[infeasible, args.x], df.loc[infeasible, args.y],
                        s=14, facecolors="none", edgecolors="black",
                        linewidths=0.6, label="infeasible (any violation)")
        ax2.set_xlabel(args.x)
        ax2.set_ylabel(args.y)
        ax2.set_title("Binding constraint by design-variable region")
        ax2.legend(fontsize=7, loc="best")
        fig2.tight_layout()
        fig2.savefig(f"{args.out_prefix}_map.png", dpi=200, bbox_inches="tight")
        print(f"Saved: {args.out_prefix}_map.png")
    else:
        print(f"Skipping constraint map: {args.x} or {args.y} not in columns.")


if __name__ == "__main__":
    main()
