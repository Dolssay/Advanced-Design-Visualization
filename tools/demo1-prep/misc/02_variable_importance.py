"""
02_variable_importance.py

Ranks design variables (DV_*) by their influence on each objective
separately, using permutation importance on a random-forest surrogate
(non-parametric, captures nonlinearity/interactions without you having to
specify a model form -- appropriate for a space-filling DOE).

Produces one bar chart per objective, plus a combined heatmap so you can see
at a glance which variables matter for ALL objectives (real constraints on
your design) vs. which matter for only ONE (the source of your tradeoffs).

Usage (from repository root):
    python "tools/demo1-prep/misc/02_variable_importance.py" data/full_htp_doe.csv
"""

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.model_selection import train_test_split

from data_utils import load_doe
from htp_config import DESIGN_VARS, OBJECTIVES

DEFAULT_CSV = Path("data/full_htp_doe.csv")


def importance_for_objective(df, design_vars, objective, random_state=0):
    X = df[design_vars].values
    y = df[objective].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=random_state)

    rf = RandomForestRegressor(n_estimators=300, random_state=random_state, n_jobs=-1)
    rf.fit(X_train, y_train)
    r2 = rf.score(X_test, y_test)

    result = permutation_importance(
        rf, X_test, y_test, n_repeats=20, random_state=random_state, n_jobs=-1)

    imp = pd.Series(result.importances_mean, index=design_vars).sort_values(ascending=False)
    imp_std = pd.Series(result.importances_std, index=design_vars)[imp.index]
    return imp, imp_std, r2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path", nargs="?", default=str(DEFAULT_CSV))
    ap.add_argument("--out-prefix", default="variable_importance")
    args = ap.parse_args()

    df = load_doe(args.csv_path)
    design_vars = [c for c in DESIGN_VARS if c in df.columns]
    objectives = [c for c in OBJECTIVES if c in df.columns]

    if len(df) < 20:
        print(f"WARNING: only {len(df)} rows loaded -- permutation importance needs a "
              f"real DOE sample (hundreds+) to be meaningful. Proceeding anyway so you "
              f"can see the pipeline run; re-run on your full dataset for real results.")

    all_importances = {}

    fig, axes = plt.subplots(1, len(objectives), figsize=(5 * len(objectives), 4.5))
    if len(objectives) == 1:
        axes = [axes]

    for ax, obj in zip(axes, objectives):
        imp, imp_std, r2 = importance_for_objective(df, design_vars, obj)
        all_importances[obj] = imp

        ax.barh(imp.index[::-1], imp.values[::-1], xerr=imp_std.values[::-1],
                color="steelblue", ecolor="black", capsize=2)
        ax.set_title(f"{obj}\n(surrogate R^2={r2:.2f})")
        ax.set_xlabel("Permutation importance\n(drop in R^2 when shuffled)")

    fig.tight_layout()
    fig.savefig(f"{args.out_prefix}_by_objective.png", dpi=200, bbox_inches="tight")
    print(f"Saved: {args.out_prefix}_by_objective.png")

    # Combined heatmap: rank each variable within each objective (1 = most important)
    imp_df = pd.DataFrame(all_importances).reindex(design_vars)
    rank_df = imp_df.rank(ascending=False, axis=0)

    fig2, ax2 = plt.subplots(figsize=(1.6 * len(objectives) + 2, 0.5 * len(design_vars) + 1.5))
    im = ax2.imshow(rank_df.values, cmap="RdYlGn_r", vmin=1, vmax=len(design_vars))
    ax2.set_xticks(range(len(objectives)))
    ax2.set_xticklabels(objectives, rotation=30, ha="right")
    ax2.set_yticks(range(len(design_vars)))
    ax2.set_yticklabels(design_vars)
    for i in range(len(design_vars)):
        for j in range(len(objectives)):
            ax2.text(j, i, int(rank_df.values[i, j]), ha="center", va="center", fontsize=9)
    ax2.set_title("Importance rank per objective (1 = most important)")
    fig2.colorbar(im, ax=ax2, label="rank (1=most important)")
    fig2.tight_layout()
    fig2.savefig(f"{args.out_prefix}_rank_heatmap.png", dpi=200, bbox_inches="tight")
    print(f"Saved: {args.out_prefix}_rank_heatmap.png")

    print("\nVariables that rank high (important) for ALL objectives are hard constraints")
    print("on your design -- there's no tradeoff to exploit there, just get them right.")
    print("Variables whose rank diverges strongly between objectives are exactly where")
    print("your multi-objective tradeoff lives.")


if __name__ == "__main__":
    main()
