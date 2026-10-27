"""LHS ensembles, shared by POST /ensemble and pipelines/precompute_ensemble.py.

Both build the same rows and the same ensemble id, so a collection precomputed
offline is indistinguishable from one sized on request.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.services.evtol_model import SUMMARY_OUTPUTS, catalogue_index, status_class


def ensemble_id(baseline: str, n_samples: int, seed: int, bounds: dict[str, list[float]] | None) -> str:
    canonical = json.dumps({"baseline": baseline, "n_samples": n_samples, "seed": seed, "bounds": bounds or None},
                           sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def sample_inputs(catalogue: dict[str, Any], n_samples: int, seed: int,
                  bounds: dict[str, list[float]] | None = None) -> list[dict[str, float]]:
    """LHS sample over the study box, or over `bounds` ({param: [lo, hi]}) where given.
    A lift_rotor_count bound also applies to tilt_rotor_count, which moves with it."""
    from pipelines.lhs import IDX, LOWS, HIGHS, NAMES, lhs_repair

    lows, highs = LOWS.astype(float).copy(), HIGHS.astype(float).copy()
    for key, (lo, hi) in (bounds or {}).items():
        if key not in IDX:
            raise KeyError(key)
        targets = [key, "tilt_rotor_count"] if key == "lift_rotor_count" else [key]
        for k in targets:
            lows[IDX[k]], highs[IDX[k]] = min(lo, hi), max(lo, hi)

    index = catalogue_index(catalogue)
    inputs = []
    for row in lhs_repair(n_samples=n_samples, seed=seed, lows=lows, highs=highs):
        values = dict(zip(NAMES, row))
        inputs.append({k: (int(v) if index[k]["integer"] else round(float(v), 4))
                       for k, v in values.items() if k in index})
    return inputs


def build_payload(baseline: str, seed: int, bounds: dict[str, list[float]] | None, catalogue: dict[str, Any],
                  inputs: list[dict[str, float]], summaries: list[dict[str, Any]]) -> dict[str, Any]:
    index = catalogue_index(catalogue)
    rows = []
    counts: dict[str, int] = {}
    for i, (inp, s) in enumerate(zip(inputs, summaries)):
        st = status_class(s.get("status"))
        counts[st] = counts.get(st, 0) + 1
        rows.append({"run": i + 1, "batch": 0, **inp, **s, "status": st})
    return {
        "ensemble_id": ensemble_id(baseline, len(inputs), seed, bounds),
        "baseline": baseline,
        "seed": seed,
        "bounds": bounds or None,
        "inputs": [index[k] for k in inputs[0]] if inputs else [],
        "outputs": SUMMARY_OUTPUTS,
        "status_counts": counts,
        "rows": rows,
    }


def normalize_collection(collection: dict[str, Any]) -> dict[str, Any]:
    """Ensure rows have standard status and batch, and status_counts is normalized."""
    counts: dict[str, int] = {}
    for r in collection.get("rows", []):
        if "batch" not in r:
            r["batch"] = 0
        r["status"] = status_class(r.get("status"))
        st = r["status"]
        counts[st] = counts.get(st, 0) + 1
    collection["status_counts"] = counts
    return collection
