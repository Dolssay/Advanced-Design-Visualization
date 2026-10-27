"""Morris screening design generation and elementary-effect statistics."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
from SALib.sample.morris import sample as morris_sample

from app.services.evtol_model import catalogue_index

BOOTSTRAP_RESAMPLES = 1_000
STABILITY_RESAMPLES = 200
SUCCESS_STATUSES = {"Success", "NotConverged"}


@dataclass
class ScreeningDesign:
    factors: list[dict[str, Any]]
    matrix: np.ndarray
    overrides: list[dict[str, float]]


def build_screening_design(
    catalogue: dict[str, Any],
    r: int,
    levels: int,
    seed: int,
    bounds: dict[str, list[float]] | None = None,
) -> ScreeningDesign:
    """Sample Morris trajectories, rounding integer factors for solver inputs."""
    index = catalogue_index(catalogue)
    factors = [spec for spec in catalogue["parameters"] if spec["key"] != "tilt_rotor_count"]
    keys = [factor["key"] for factor in factors]
    requested_bounds = bounds or {}
    unknown = sorted(set(requested_bounds) - set(keys))
    if unknown:
        raise ValueError(f"Unknown screening bound parameters: {unknown}")
    if levels % 2:
        raise ValueError("Morris levels must be an even integer.")

    ranges: dict[str, tuple[float, float]] = {}
    for factor in factors:
        key = factor["key"]
        raw = requested_bounds.get(key, [factor["min"], factor["max"]])
        if len(raw) != 2:
            raise ValueError(f"Bounds for '{key}' must contain exactly [low, high].")
        try:
            lo, hi = float(raw[0]), float(raw[1])
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Bounds for '{key}' must be numeric.") from exc
        if not math.isfinite(lo) or not math.isfinite(hi) or lo >= hi:
            raise ValueError(f"Bounds for '{key}' must be finite and low < high.")
        ranges[key] = (lo, hi)

    problem = {
        "num_vars": len(factors),
        "names": keys,
        "bounds": [list(ranges[key]) for key in keys],
    }
    matrix = np.asarray(
        morris_sample(problem, N=r, num_levels=levels, seed=seed),
        dtype=float,
    ).reshape(r, len(factors) + 1, len(factors))

    overrides: list[dict[str, float]] = []
    for trajectory in matrix:
        for row in trajectory:
            point: dict[str, float] = {}
            for col, factor in enumerate(factors):
                key = factor["key"]
                value = float(np.rint(row[col])) if index[key]["integer"] else float(row[col])
                point[key] = int(value) if index[key]["integer"] else value
            overrides.append(point)
    return ScreeningDesign(
        factors=[{**factor, "lo": ranges[factor["key"]][0], "hi": ranges[factor["key"]][1]}
                 for factor in factors],
        matrix=matrix,
        overrides=overrides,
    )


def _ranked_top_five(
    factor_keys: list[str],
    effects: dict[str, list[tuple[int, float]]],
) -> list[str]:
    scores = {}
    for key in factor_keys:
        values = [abs(ee) for _, ee in effects[key]]
        scores[key] = float(np.mean(values)) if values else -math.inf
    return sorted(factor_keys, key=lambda key: (-scores[key], factor_keys.index(key)))[:5]


def analyze_screening(
    design: ScreeningDesign,
    summaries: list[dict[str, Any]],
    outputs: list[str],
    r: int,
    seed: int,
    *,
    n_constraint: int = 0,
    elapsed_s: float = 0.0,
) -> dict[str, Any]:
    if len(summaries) != design.matrix.shape[0] * design.matrix.shape[1]:
        raise ValueError("The number of sizing summaries does not match the screening design.")

    factor_keys = [factor["key"] for factor in design.factors]
    ranges = {
        factor["key"]: (float(factor["lo"]), float(factor["hi"]))
        for factor in design.factors
    }
    trajectories = design.matrix.shape[0]
    points_per_trajectory = design.matrix.shape[1]
    matrix = design.matrix.reshape(trajectories, points_per_trajectory, len(factor_keys)).copy()
    for col, factor in enumerate(design.factors):
        if factor.get("integer"):
            matrix[:, :, col] = np.rint(matrix[:, :, col])

    failed = [
        summary.get("status") not in SUCCESS_STATUSES
        for summary in summaries
    ]
    summaries_by_trajectory = np.asarray(summaries, dtype=object).reshape(
        trajectories, points_per_trajectory
    )
    failed_by_trajectory = np.asarray(failed, dtype=bool).reshape(
        trajectories, points_per_trajectory
    )
    effect_map: dict[str, dict[str, list[tuple[int, float]]]] = {
        output: {key: [] for key in factor_keys} for output in outputs
    }
    failed_effects = {key: 0 for key in factor_keys}

    for trajectory in range(trajectories):
        for step in range(points_per_trajectory - 1):
            delta = matrix[trajectory, step + 1] - matrix[trajectory, step]
            changed = np.flatnonzero(np.abs(delta) > 1e-12)
            if len(changed) == 0:
                continue
            if len(changed) != 1:
                raise ValueError("A Morris step changed more than one independent factor.")
            col = int(changed[0])
            key = factor_keys[col]
            lo, hi = ranges[key]
            dx = delta[col] / (hi - lo)
            if failed_by_trajectory[trajectory, step] or failed_by_trajectory[trajectory, step + 1]:
                failed_effects[key] += 1
                continue
            for output in outputs:
                y_a = summaries_by_trajectory[trajectory, step].get(output)
                y_b = summaries_by_trajectory[trajectory, step + 1].get(output)
                if y_a is None or y_b is None:
                    continue
                try:
                    ee = (float(y_b) - float(y_a)) / dx
                except (TypeError, ValueError):
                    continue
                if math.isfinite(ee):
                    effect_map[output][key].append((trajectory, ee))

    rng = np.random.default_rng(seed)
    results: dict[str, list[dict[str, Any]]] = {}
    stability: dict[str, dict[str, Any]] = {}

    for output in outputs:
        per_factor = effect_map[output]
        output_stats = []
        for factor in design.factors:
            key = factor["key"]
            ees = np.asarray([ee for _, ee in per_factor[key]], dtype=float)
            if len(ees):
                absolute = np.abs(ees)
                if len(absolute) > 1:
                    samples = rng.choice(absolute, size=(BOOTSTRAP_RESAMPLES, len(absolute)), replace=True)
                    means = samples.mean(axis=1)
                    low, high = np.percentile(means, [2.5, 97.5])
                    confidence = float((high - low) / 2.0)
                else:
                    confidence = 0.0
                mu = float(np.mean(ees))
                mu_star = float(np.mean(absolute))
                sigma = float(np.std(ees, ddof=1)) if len(ees) > 1 else None
            else:
                mu = mu_star = sigma = confidence = None
            output_stats.append({
                "param": key,
                "mu": mu,
                "mu_star": mu_star,
                "mu_star_conf": confidence,
                "sigma": sigma,
                "n_effects": len(ees),
                "n_failed": failed_effects[key],
            })
        results[output] = output_stats

        reference_top5 = _ranked_top_five(factor_keys, per_factor)
        agreements = 0
        for _ in range(STABILITY_RESAMPLES):
            sampled_trajectories = rng.integers(0, trajectories, size=trajectories).tolist()
            sampled_effects = {
                key: [
                    (trajectory, ee)
                    for trajectory in sampled_trajectories
                    for effect_trajectory, ee in per_factor[key]
                    if effect_trajectory == trajectory
                ]
                for key in factor_keys
            }
            candidate_top5 = _ranked_top_five(factor_keys, sampled_effects)
            if set(candidate_top5) == set(reference_top5):
                agreements += 1
        stability[output] = {
            "top5": reference_top5,
            "agreement": agreements / STABILITY_RESAMPLES,
        }

    input_metadata = [
        {
            "key": factor["key"],
            "label": factor["label"],
            "unit": factor["unit"],
            "group": factor["group"],
            "lo": ranges[factor["key"]][0],
            "hi": ranges[factor["key"]][1],
        }
        for factor in design.factors
    ]
    return {
        "n_runs": len(summaries),
        "n_failed": sum(failed),
        "n_constraint": n_constraint,
        "elapsed_s": round(elapsed_s, 3),
        "r": r,
        "seed": seed,
        "inputs": input_metadata,
        "results": results,
        "stability": stability,
    }


def run_screening(
    catalogue: dict[str, Any],
    size_fn: Callable[[dict[str, float]], dict[str, Any]],
    r: int = 20,
    levels: int = 4,
    seed: int = 0,
    bounds: dict[str, list[float]] | None = None,
    outputs: list[str] | None = None,
) -> dict[str, Any]:
    """Convenience entry point for deterministic analytical and fake-solver tests."""
    design = build_screening_design(catalogue, r, levels, seed, bounds)
    first = size_fn(design.overrides[0])
    summaries = [first, *(size_fn(point) for point in design.overrides[1:])]
    requested_outputs = outputs or [
        key for key in first if key not in {"status", "message", "iterations"}
    ]
    return analyze_screening(design, summaries, requested_outputs, r, seed)
