"""Demo 2 routes: evtolpy sizing, sweeps, sensitivity and ensembles."""

from __future__ import annotations

import math
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
)
from app.services.ensemble import build_payload, sample_inputs
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


@router.post(paths.EVTOL_ENSEMBLE)
async def ensemble(body: EnsembleRequest, request: Request) -> dict:
    """Latin Hypercube ensemble, the interactive version of pipelines/precompute_ensemble.py."""
    state = request.app.state
    if body.n_samples > state.settings.max_ensemble_samples:
        raise HTTPException(422, {"code": "too_many_samples",
                                  "message": f"Limit is {state.settings.max_ensemble_samples} samples."})
    base = _baseline(request, body.baseline)
    inputs = sample_inputs(state.catalogue, body.n_samples, body.seed)
    configs = [_apply(request, base, overrides, enforce_bounds=False) for overrides in inputs]
    summaries = await _map(request, size_summary, configs)
    return build_payload(body.baseline, body.seed, None, state.catalogue, inputs, summaries)
