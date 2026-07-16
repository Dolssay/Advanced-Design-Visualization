"""
data_utils.py

Shared helpers: load the DOE csv and compute constraint margins /
feasibility from htp_config.CONSTRAINTS.
"""

import numpy as np
import pandas as pd

from htp_config import CONSTRAINTS, constraint_columns_present


def load_doe(csv_path):
    """Load the raw DOE csv, drop fully-empty columns (e.g. unused 'Obj')."""
    df = pd.read_csv(csv_path)
    df = df.dropna(axis=1, how="all")
    return df


def compute_margins(df, constraints=None):
    """
    Compute one margin column per constraint, named 'margin__<original_col>'.

    Convention: margin >= 0 means the constraint is satisfied; margin < 0
    means it's violated; margin very close to 0 means it's actively binding.
    Margins are NOT normalized -- use normalized_margins() for cross-constraint
    comparisons (e.g. ranking which constraint binds most often).
    """
    constraints = constraints or CONSTRAINTS
    present = constraint_columns_present(df.columns)
    margins = pd.DataFrame(index=df.index)

    for col in present:
        spec = constraints[col]
        op, limit = spec["op"], spec["limit"]
        vals = df[col]
        if op == ">=":
            m = vals - limit
        elif op == "<=":
            m = limit - vals
        elif op == "abs<=":
            m = limit - vals.abs()
        else:
            raise ValueError(f"Unknown op {op} for {col}")
        margins[f"margin__{col}"] = m

    return margins


def normalized_margins(margins_df):
    """
    Scale each margin column to a comparable unit-free range so that
    'which constraint is most binding' comparisons aren't dominated by
    columns with naturally large magnitudes (e.g. degrees vs damping ratio).
    Uses margin / (std of that margin column), a robust-ish z-like scaling.
    """
    std = margins_df.std(ddof=0).replace(0, np.nan)
    return margins_df / std


def add_feasibility(df, margins_df, exclude_cols=None):
    """
    Append 'Feasible' (bool) and 'MinMargin'/'BindingConstraint' columns to df,
    based on all margin columns being >= 0. exclude_cols lets you skip
    constraints you haven't set real limits for yet (e.g. Cert_S125_RoD_TD).
    """
    exclude_cols = exclude_cols or []
    use_cols = [c for c in margins_df.columns
                if c.replace("margin__", "") not in exclude_cols]
    sub = margins_df[use_cols]

    out = df.copy()
    out["Feasible"] = (sub >= 0).all(axis=1)
    out["MinMargin"] = sub.min(axis=1)
    out["BindingConstraint"] = sub.idxmin(axis=1).str.replace("margin__", "", regex=False)
    return out
