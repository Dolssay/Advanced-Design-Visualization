"""Demo 2 routes: evtolpy sizing, sweeps, sensitivity and ensembles."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.api import paths
from app.api.schemas import EnsembleRequest, SensitivityRequest, SizeRequest, SweepRequest
from app.services.evtol_model import (
    IMAGE_KINDS,
    SUMMARY_OUTPUTS,
    OverrideError,
    apply_overrides,
    catalogue_index,
    check_constraints,
    design_values,
    size_design,
    size_summary,
    status_class,
)
from app.services.ensemble import build_payload, ensemble_id, normalize_collection, sample_inputs
from app.services.runner import SizingTimeout
from app.services.store import run_id_for

router = APIRouter(tags=["evtol"])


def _label(name: str) -> str:
    return name.replace("_", " ")


def _baseline(request: Request, name: str) -> dict[str, Any]:
    config = request.app.state.baselines.get(name)
    if config is None:
        raise HTTPException(404, {"code": "unknown_baseline", "message": f"No baseline named '{name}'.",
                                  "available": request.app.state.baselines.names()})
    return config


def _apply(request: Request, base: dict, overrides: dict, enforce_bounds: bool = True) -> dict:
    try:
        return apply_overrides(base, overrides, request.app.state.catalogue, enforce_bounds=enforce_bounds)
    except OverrideError as exc:
        raise HTTPException(422, {"code": "invalid_overrides", "message": str(exc), "errors": exc.errors})


async def _run(request: Request, fn, *args):
    try:
        return await request.app.state.runner.run(fn, *args)
    except SizingTimeout as exc:
        raise HTTPException(504, {"code": "sizing_timeout", "message": str(exc)})


async def _map(request: Request, fn, items):
    try:
        return await request.app.state.runner.map(fn, items)
    except SizingTimeout as exc:
        raise HTTPException(504, {"code": "sizing_timeout", "message": str(exc)})


# --------------------------------------------------------------------------- reference data

@router.get(paths.EVTOL_BASELINES)
def list_baselines(request: Request) -> dict:
    catalogue = request.app.state.catalogue
    store = request.app.state.baselines
    return {
        "baselines": [
            {"name": name, "label": _label(name), "design": design_values(store.get(name), catalogue)}
            for name in store.names()
        ]
    }


@router.get(paths.EVTOL_BASELINE)
def get_baseline(name: str, request: Request) -> dict:
    return _baseline(request, name)


@router.get(paths.EVTOL_PARAMETERS)
def get_parameters(request: Request) -> dict:
    settings = request.app.state.settings
    return {
        **request.app.state.catalogue,
        "outputs": SUMMARY_OUTPUTS,
        "images": IMAGE_KINDS,
        "limits": {"max_sweep_points": settings.max_sweep_points,
                   "max_ensemble_samples": settings.max_ensemble_samples},
    }


# --------------------------------------------------------------------------- single design

@router.post(paths.EVTOL_SIZE)
async def size(body: SizeRequest, request: Request) -> dict:
    state = request.app.state
    base = _baseline(request, body.baseline)
    config = _apply(request, base, body.overrides)
    run_id = run_id_for(body.baseline, config)

    cached = state.runs.load(run_id)
    if cached is not None:
        return {**cached, "cached": True}

    result = await _run(request, size_design, config, _label(body.baseline), str(state.runs.run_dir(run_id)))
    if result["status"] not in ("Success", "NotConverged"):
        raise HTTPException(422, {"code": "sizing_failed", "status": result["status"], "message": result["message"]})

    payload = {
        "run_id": run_id,
        "baseline": body.baseline,
        "design": design_values(config, state.catalogue),
        "warnings": check_constraints(config),
        "result": result,
        "images": [
            {"kind": kind, "label": IMAGE_KINDS[kind], "url": paths.run_image_url(run_id, kind)}
            for kind in result.get("images", [])
        ],
    }
    state.runs.save(run_id, payload)
    return {**payload, "cached": False}


@router.get(paths.EVTOL_RUN)
def get_run(run_id: str, request: Request) -> dict:
    payload = request.app.state.runs.load(run_id)
    if payload is None:
        raise HTTPException(404, {"code": "unknown_run", "message": f"No run '{run_id}'."})
    return payload


@router.get(paths.EVTOL_RUN_IMAGE, response_class=FileResponse)
def get_run_image(run_id: str, kind: str, request: Request):
    if kind not in IMAGE_KINDS:
        raise HTTPException(404, {"code": "unknown_image", "message": f"Image kinds: {list(IMAGE_KINDS)}"})
    path = request.app.state.runs.image_path(run_id, kind)
    if path is None:
        raise HTTPException(404, {"code": "unknown_run", "message": f"No image '{kind}' for run '{run_id}'."})
    # Run ids are content hashes, so an image never changes once written.
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=31536000, immutable"})


# --------------------------------------------------------------------------- batches

def _sweep_values(spec: dict, start: float, stop: float, step: float) -> list[float]:
    if stop < start:
        start, stop = stop, start
    n = int(math.floor((stop - start) / step + 1e-9)) + 1
    values = [round(start + i * step, 10) for i in range(n)]
    if spec["integer"]:
        values = sorted({int(round(v)) for v in values})
    return values


@router.post(paths.EVTOL_SWEEP)
async def sweep(body: SweepRequest, request: Request) -> dict:
    state = request.app.state
    index = catalogue_index(state.catalogue)
    spec = index.get(body.parameter)
    if spec is None:
        raise HTTPException(422, {"code": "unknown_parameter", "message": f"Unknown parameter '{body.parameter}'."})

    start = spec["min"] if body.start is None else body.start
    stop = spec["max"] if body.stop is None else body.stop
    step = spec["step"] if body.step is None else body.step
    values = _sweep_values(spec, start, stop, step)
    if len(values) > state.settings.max_sweep_points:
        raise HTTPException(422, {
            "code": "too_many_points",
            "message": f"{len(values)} points requested; the limit is {state.settings.max_sweep_points}. Use a larger step.",
        })

    base = _baseline(request, body.baseline)
    base_config = _apply(request, base, body.overrides)
    configs = [_apply(request, base, {**body.overrides, body.parameter: v}) for v in values]
    summaries = await _map(request, size_summary, configs)

    return {
        "baseline": body.baseline,
        "parameter": spec,
        "design": design_values(base_config, state.catalogue),
        "outputs": SUMMARY_OUTPUTS,
        "points": [
            {"value": v, **s, "warnings": [w["id"] for w in check_constraints(c)]}
            for v, s, c in zip(values, summaries, configs)
        ],
    }


@router.post(paths.EVTOL_SENSITIVITY)
async def sensitivity(body: SensitivityRequest, request: Request) -> dict:
    """One-at-a-time sensitivity: each input moved down and up around the design."""
    state = request.app.state
    index = catalogue_index(state.catalogue)
    keys = body.parameters or list(index)
    unknown = [k for k in keys if k not in index]
    if unknown:
        raise HTTPException(422, {"code": "unknown_parameter", "message": f"Unknown parameters: {unknown}"})

    base = _baseline(request, body.baseline)
    base_config = _apply(request, base, body.overrides)
    design = design_values(base_config, state.catalogue)

    jobs: list[tuple[str, float, float]] = []
    for key in keys:
        spec, v = index[key], float(design[key])
        if spec["integer"]:
            low, high = v - spec["step"], v + spec["step"]
            low = max(low, 1)
        else:
            delta = abs(v) * body.delta_pct / 100.0
            low, high = v - delta, v + delta
        if low == high:
            continue
        jobs.append((key, low, high))

    configs = [base_config]
    for key, low, high in jobs:
        for value in (low, high):
            configs.append(_apply(request, base, {**body.overrides, **{key: value}}, enforce_bounds=False))
    summaries = await _map(request, size_summary, configs)

    rows = []
    for i, (key, low, high) in enumerate(jobs):
        spec = index[key]
        rows.append({
            "key": key, "label": spec["label"], "unit": spec["unit"],
            "base_value": design[key], "low_value": low, "high_value": high,
            "low": summaries[1 + 2 * i], "high": summaries[2 + 2 * i],
        })
    return {
        "baseline": body.baseline,
        "delta_pct": body.delta_pct,
        "design": design,
        "base": summaries[0],
        "outputs": SUMMARY_OUTPUTS,
        "rows": rows,
    }


def validate_bounds(bounds: dict[str, list[float]] | None, catalogue: dict[str, Any]) -> None:
    if not bounds:
        return
    index = catalogue_index(catalogue)
    for key, span in bounds.items():
        if key not in index:
            raise HTTPException(422, {"code": "invalid_bounds", "message": f"Unknown parameter '{key}' in bounds."})
        if not isinstance(span, (list, tuple)) or len(span) != 2:
            raise HTTPException(422, {"code": "invalid_bounds", "message": f"Bounds for '{key}' must be [lo, hi]."})
        lo, hi = span
        spec = index[key]
        limit_min = spec.get("limit_min", spec.get("min"))
        limit_max = spec.get("limit_max", spec.get("max"))
        if min(lo, hi) < limit_min or max(lo, hi) > limit_max:
            raise HTTPException(
                422,
                {
                    "code": "bounds_out_of_range",
                    "message": f"Bounds for '{key}' [{lo}, {hi}] must lie inside slider limits [{limit_min}, {limit_max}].",
                },
            )


def _find_ensemble_file(state, ensemble_id_val: str) -> Path | None:
    runs_file = state.settings.runs_dir / "ensembles" / f"{ensemble_id_val}.json"
    if runs_file.exists():
        return runs_file
    if state.settings.prebuilt_dir and state.settings.prebuilt_dir.exists():
        candidates = [
            state.settings.prebuilt_dir / "ensembles" / f"{ensemble_id_val}.json",
            state.settings.prebuilt_dir / f"{ensemble_id_val}.json",
        ]
        for c in candidates:
            if c.exists():
                return c
    return None


def _update_ensemble_index(directory: Path, payload: dict) -> None:
    path = directory / "index.json"
    entries = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    entries = [e for e in entries if e.get("ensemble_id") != payload["ensemble_id"]]
    entries.append({
        "ensemble_id": payload["ensemble_id"],
        "baseline": payload["baseline"],
        "seed": payload["seed"],
        "bounds": payload.get("bounds"),
        "status_counts": payload.get("status_counts", {}),
        "n_samples": payload.get("n_samples", len(payload.get("rows", []))),
        "created": payload.get("created", datetime.now(timezone.utc).isoformat(timespec="seconds")),
        "elapsed_s": payload.get("elapsed_s", 0.0),
    })
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(sorted(entries, key=lambda e: e.get("created", "")), fh, separators=(",", ":"))
    tmp.replace(path)


def _save_ensemble(runs_dir: Path, payload: dict) -> None:
    directory = runs_dir / "ensembles"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{payload['ensemble_id']}.json"
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    tmp.replace(path)
    _update_ensemble_index(directory, payload)


@router.post(paths.EVTOL_ENSEMBLE)
async def ensemble(body: EnsembleRequest, request: Request) -> dict:
    """Latin Hypercube ensemble, with bounds, caching and append_to support."""
    state = request.app.state
    validate_bounds(body.bounds, state.catalogue)

    if body.append_to:
        if body.n_samples > state.settings.max_ensemble_samples:
            raise HTTPException(422, {"code": "too_many_samples",
                                      "message": f"Limit is {state.settings.max_ensemble_samples} samples."})
        existing_path = _find_ensemble_file(state, body.append_to)
        if existing_path is None:
            raise HTTPException(404, {"code": "unknown_ensemble",
                                      "message": f"No ensemble with id '{body.append_to}'."})
        collection = normalize_collection(json.loads(existing_path.read_text(encoding="utf-8")))
        existing_rows = collection.get("rows", [])
        current_count = len(existing_rows)
        max_batch = max((r.get("batch", 0) for r in existing_rows), default=0)
        new_batch = max_batch + 1
        append_seed = int(hashlib.sha256(f"{body.append_to}:{current_count}".encode()).hexdigest()[:8], 16)
        effective_bounds = body.bounds if body.bounds is not None else collection.get("bounds")
        base = _baseline(request, collection.get("baseline", body.baseline))
        new_inputs = sample_inputs(state.catalogue, body.n_samples, append_seed, effective_bounds)
        configs = [_apply(request, base, overrides, enforce_bounds=False) for overrides in new_inputs]
        new_summaries = await _map(request, size_summary, configs)

        new_rows = []
        for idx, (inp, s) in enumerate(zip(new_inputs, new_summaries)):
            st = status_class(s.get("status"))
            new_rows.append({
                "run": current_count + 1 + idx,
                "batch": new_batch,
                **inp,
                **s,
                "status": st,
            })
        merged_rows = existing_rows + new_rows
        counts: dict[str, int] = {}
        for r in merged_rows:
            st = r["status"]
            counts[st] = counts.get(st, 0) + 1
        collection["rows"] = merged_rows
        collection["status_counts"] = counts
        collection["n_samples"] = len(merged_rows)
        _save_ensemble(state.settings.runs_dir, collection)

        return {
            "ensemble_id": body.append_to,
            "rows": new_rows,
            "n_total": len(merged_rows),
            "batch": new_batch,
            "status_counts": counts,
        }

    # Standard / cached ensemble
    eid = ensemble_id(body.baseline, body.n_samples, body.seed, body.bounds)
    cached_path = _find_ensemble_file(state, eid)
    if cached_path is not None:
        collection = json.loads(cached_path.read_text(encoding="utf-8"))
        return normalize_collection(collection)

    if body.n_samples > state.settings.max_ensemble_samples:
        raise HTTPException(422, {"code": "too_many_samples",
                                  "message": f"Limit is {state.settings.max_ensemble_samples} samples."})

    base = _baseline(request, body.baseline)
    inputs = sample_inputs(state.catalogue, body.n_samples, body.seed, body.bounds)
    configs = [_apply(request, base, overrides, enforce_bounds=False) for overrides in inputs]
    summaries = await _map(request, size_summary, configs)
    payload = build_payload(body.baseline, body.seed, body.bounds, state.catalogue, inputs, summaries)
    payload["n_samples"] = len(inputs)
    payload["created"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _save_ensemble(state.settings.runs_dir, payload)
    return payload


@router.get(paths.EVTOL_ENSEMBLES)
def list_ensembles(request: Request) -> list[dict]:
    state = request.app.state
    merged: dict[str, dict] = {}
    prebuilt = getattr(state, "prebuilt_index", None)
    if prebuilt is None and state.settings.prebuilt_dir and state.settings.prebuilt_dir.exists():
        for p in (state.settings.prebuilt_dir / "ensembles" / "index.json", state.settings.prebuilt_dir / "index.json"):
            if p.exists():
                try:
                    prebuilt = json.loads(p.read_text(encoding="utf-8"))
                except Exception:
                    pass
                break
    for e in (prebuilt or []):
        merged[e["ensemble_id"]] = e
    runs_index_path = state.settings.runs_dir / "ensembles" / "index.json"
    if runs_index_path.exists():
        try:
            runs_entries = json.loads(runs_index_path.read_text(encoding="utf-8"))
            for e in runs_entries:
                merged[e["ensemble_id"]] = e
        except Exception:
            pass
    return list(merged.values())


@router.get(paths.EVTOL_COLLECTION)
def get_ensemble(id: str, request: Request) -> dict:
    state = request.app.state
    path = _find_ensemble_file(state, id)
    if path is None:
        raise HTTPException(404, {"code": "unknown_ensemble", "message": f"No ensemble with id '{id}'."})
    collection = json.loads(path.read_text(encoding="utf-8"))
    return normalize_collection(collection)
