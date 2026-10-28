"""14 CFR Part 25 checks for the GTB777 data, shared with Demo 1.

The requirements, their limits and the source columns live in
frontend/demo1/scripts/certRequirements.json so the Python tools and the web page
use the same numbers.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

REQUIREMENTS_JSON = (
    Path(__file__).resolve().parents[2] / "frontend" / "demo1" / "scripts" / "certRequirements.json"
)


def load_requirements(path=REQUIREMENTS_JSON):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["requirements"]


def native_values(df, requirements):
    """One column per requirement, in its own units (see certRequirements.json)."""
    missing = [r["source"] for r in requirements if r["source"] not in df.columns]
    if missing:
        raise KeyError(f"Missing certification columns in input CSV: {missing}")
    out = pd.DataFrame(index=df.index)
    for r in requirements:
        raw = df[r["source"]].astype(float)
        if r["transform"] == "exp":
            raw = np.exp(raw)
        elif r["transform"] == "pct":
            raw = raw * 100
        out[r["column"]] = raw
    return out


def margins(values, requirements):
    """Margin to each limit: percent of the limit, or percentage points when the limit is 0."""
    out = pd.DataFrame(index=values.index)
    for r in requirements:
        v, lim = values[r["column"]], r["limit"]
        out[r["column"]] = (v - lim) if lim == 0 else (v - lim) / abs(lim) * 100
    return out


def passes(values, requirements):
    out = pd.DataFrame(index=values.index)
    for r in requirements:
        v, lim = values[r["column"]], r["limit"]
        out[r["column"]] = v > lim if r["op"] == ">" else v >= lim
    return out
