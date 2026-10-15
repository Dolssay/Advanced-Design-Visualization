"""
04_pareto_tradeoff.py

Multi-objective tradeoff exploration:
  1. Computes the non-dominated (Pareto) front between two objectives
     (default: OEW vs. CD), restricted to feasible designs only.
  2. Plots the front, colored by a third objective (e.g. block fuel) so you
     can see all three at once.
  3. Pulls out the two "bookend" designs -- the one that minimizes objective
     A and the one that minimizes objective B along the front -- and
     compares their geometry (DV_*) side by side, both as a table and a
     normalized bar chart. This is the direct answer to "what does a
     min-weight airplane look like vs. a min-drag airplane".

Usage (from repository root):
    python "tools/demo1-prep/misc/04_pareto_tradeoff.py" data/full_htp_doe.csv --obj-a OEW_lbm --obj-b CD
"""

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from data_utils import load_doe, compute_margins, add_feasibility
from htp_config import DESIGN_VARS

DEFAULT_CSV = Path("data/full_htp_doe.csv")

EXCLUDE = ["Cert_S125_RoD_TD"]


def pareto_mask(df, obj_a, obj_b):
    """Non-dominated set for two objectives, both assumed 'minimize'."""
    vals = df[[obj_a, obj_b]].values
    n = len(vals)
    is_pareto = np.ones(n, dtype=bool)
    for i in range(n):
        if not is_pareto[i]:
            continue
        dominates = np.all(vals <= vals[i], axis=1) & np.any(vals < vals[i], axis=1)
        if dominates.any():
            is_pareto[i] = False
    return is_pareto


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path", nargs="?", default=str(DEFAULT_CSV))
    ap.add_argument("--obj-a", default="OEW_lbm")
    ap.add_argument("--obj-b", default="CD")
    ap.add_argument("--color-by", default="Mission_BlockFuel_lbm")
    ap.add_argument("--feasible-only", action="store_true", default=True)
    ap.add_argument("--out-prefix", default="pareto_tradeoff")
    args = ap.parse_args()

    df = load_doe(args.csv_path)
    margins = compute_margins(df)
    df_full = add_feasibility(df, margins, exclude_cols=EXCLUDE)

    pool = df_full[df_full["Feasible"]] if args.feasible_only else df_full
    if len(pool) == 0:
        print("No feasible designs under current constraint limits -- "
              "check htp_config.py thresholds, or re-run without --feasible-only. "
              "Falling back to the full (unconstrained) population for this demo.")
        pool = df_full

    mask = pareto_mask(pool.reset_index(drop=True), args.obj_a, args.obj_b)
    pool = pool.reset_index(drop=True)
    front = pool[mask].sort_values(args.obj_a)

    print(f"Pareto front: {len(front)} non-dominated designs out of {len(pool)} "
          f"evaluated ({args.obj_a} vs {args.obj_b}).")

    # --- Plot: objective space, front highlighted, colored by 3rd objective ---
    fig, ax = plt.subplots(figsize=(7, 6))
    sc = ax.scatter(pool[args.obj_a], pool[args.obj_b], c=pool[args.color_by],
                     cmap="viridis", s=10, alpha=0.5, label="feasible designs")
    ax.plot(front[args.obj_a], front[args.obj_b], "r-o", ms=4, lw=1.2,
            label="Pareto front", zorder=3)
    fig.colorbar(sc, ax=ax, label=args.color_by)
    ax.set_xlabel(args.obj_a)
    ax.set_ylabel(args.obj_b)
    ax.set_title(f"Tradeoff: {args.obj_a} vs {args.obj_b}\n(color = {args.color_by})")
    ax.legend()
    fig.tight_layout()
    fig.savefig(f"{args.out_prefix}_front.png", dpi=200, bbox_inches="tight")
    print(f"Saved: {args.out_prefix}_front.png")

    # --- Bookend designs: min(obj_a) end vs min(obj_b) end of the front ---
    design_vars = [c for c in DESIGN_VARS if c in df.columns]
    row_min_a = front.loc[front[args.obj_a].idxmin()]
    row_min_b = front.loc[front[args.obj_b].idxmin()]

    compare = pd.DataFrame({
        f"min-{args.obj_a} design": row_min_a[design_vars + [args.obj_a, args.obj_b]],
        f"min-{args.obj_b} design": row_min_b[design_vars + [args.obj_a, args.obj_b]],
    })
    compare["pct_difference"] = (
        (compare.iloc[:, 1] - compare.iloc[:, 0]) / compare.iloc[:, 0].abs() * 100
    ).round(1)
    print("\nGeometry at the two ends of the Pareto front:")
    print(compare.to_string())
    compare.to_csv(f"{args.out_prefix}_bookend_geometry.csv")
    print(f"\nSaved: {args.out_prefix}_bookend_geometry.csv")

    # --- Normalized bar chart of geometry difference ---
    dv_compare = compare.loc[design_vars]
    norm = dv_compare.iloc[:, :2].div(dv_compare.iloc[:, :2].max(axis=1), axis=0)

    fig2, ax2 = plt.subplots(figsize=(8, 4.5))
    x = np.arange(len(design_vars))
    w = 0.35
    ax2.bar(x - w / 2, norm.iloc[:, 0], w, label=norm.columns[0], color="steelblue")
    ax2.bar(x + w / 2, norm.iloc[:, 1], w, label=norm.columns[1], color="firebrick")
    ax2.set_xticks(x)
    ax2.set_xticklabels(design_vars, rotation=30, ha="right")
    ax2.set_ylabel("Value normalized to max of the two designs")
    ax2.set_title("Geometry comparison: min-weight-end vs min-drag-end of Pareto front")
    ax2.legend()
    fig2.tight_layout()
    fig2.savefig(f"{args.out_prefix}_geometry_comparison.png", dpi=200, bbox_inches="tight")
    print(f"Saved: {args.out_prefix}_geometry_comparison.png")


if __name__ == "__main__":
    main()
