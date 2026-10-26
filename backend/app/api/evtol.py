"""Demo 2 routes: evtolpy sizing, sweeps, sensitivity, ensembles and feasibility slices."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import time
from functools import partial
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.api import paths
from app.api.schemas import EnsembleRequest, FeasibilityRequest, ScreeningRequest, SensitivityRequest, SizeRequest, SweepRequest
from app.config import MAX_SCREENING_RUNS
from app.services.evtol_model import (
    IMAGE_KINDS,
    SUMMARY_OUTPUTS,
    OverrideError,
    apply_overrides,
    catalogue_index,
    check_constraints,
    constraint_interval,
    design_values,
    effective_range,
    size_design,
    size_summary,
)
from app.services.ensemble import build_payload, sample_inputs
from app.services.feasibility import SliceJob, allowed_range, grid_values, run_slices, slice_id
from app.services.runner import SizingTimeout
from app.services.screening import analyze_screening, build_screening_design
from app.services.store import run_id_for

log = logging.getLogger("adv_viz")
router = APIRouter(tags=["evtol"])

# Slices after the priority ones are sized this many at a time, so their lines
# trickle out instead of all arriving when the last one finishes.
FEASIBILITY_GROUP = 4


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
            {"name": name, "label": _label(name), "design": design_values(store.get(name), catalogue),
             # Tilt and total rotor counts are not sliders; the C4/C5 rows of the constraints box need them.
             "rotors": {k: store.get(name)["propulsion"].get(k) for k in ("lift_rotor_count", "tilt_rotor_count", "rotor_count")}}
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
                   "max_ensemble_samples": settings.max_ensemble_samples,
                   "max_screening_runs": MAX_SCREENING_RUNS},
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


@router.post(paths.EVTOL_FEASIBILITY)
async def feasibility(body: FeasibilityRequest, request: Request) -> StreamingResponse:
    """Feasible range of each slider with the other inputs held at the current
    design. NDJSON: cached slices first, then one line per computed parameter
    (priority first), then a summary line. Validation errors are raised before
    the stream starts, so they are normal 404/422 responses.

    Cancellation: Starlette cancels this generator as soon as the client
    disconnects (StreamingResponse listens for http.disconnect), which also
    cancels the pending runner.map, so no further round is submitted. Don't call
    request.is_disconnected() in here: it would compete with that listener for
    the same receive channel.
    """
    state = request.app.state
    index = catalogue_index(state.catalogue)
    keys = body.parameters or list(index)
    unknown = [k for k in [*keys, *body.priority] if k not in index]
    if unknown:
        raise HTTPException(422, {"code": "unknown_parameter", "message": f"Unknown parameters: {unknown}"})

    base = _baseline(request, body.baseline)
    base_config = _apply(request, base, body.overrides)
    design = design_values(base_config, state.catalogue)
    max_iter = state.settings.feasibility_max_iter

    def make_config(key: str, value: float) -> dict:
        return apply_overrides(base, {**body.overrides, key: value}, state.catalogue, enforce_bounds=False)

    cached: list[dict] = []
    jobs: dict[str, SliceJob] = {}
    ids: dict[str, str] = {}
    for key in dict.fromkeys(keys):
        spec = index[key]
        ids[key] = slice_id(body.baseline, design, key, body.resolution, body.refine, max_iter)
        hit = state.slices.load(ids[key])
        if hit is not None:
            cached.append({**hit, "current": design[key]})  # the slice doesn't depend on key's own value
            continue
        limit = effective_range(spec, base[spec["section"]][key])
        bounds = constraint_interval(base_config, key)
        scan = allowed_range(limit, bounds)
        values = grid_values(*scan, body.resolution, spec["integer"]) if scan else []
        jobs[key] = SliceJob(key=key, limit=limit, current=design[key], bounds=bounds, integer=spec["integer"],
                             make_config=partial(make_config, key), scan=scan if values else None, values=values)

    first = [jobs[k] for k in dict.fromkeys(body.priority) if k in jobs]
    rest = [job for job in jobs.values() if job not in first]
    groups = [g for g in [first] if g] + [rest[i:i + FEASIBILITY_GROUP] for i in range(0, len(rest), FEASIBILITY_GROUP)]

    sizer = partial(size_summary, max_iter=max_iter)
    counter = {"runs": 0}

    async def size_fn(configs: list[dict]) -> list[dict]:
        counter["runs"] += len(configs)
        return await state.runner.map(sizer, configs)

    def ndjson(obj: dict) -> str:
        return json.dumps(obj) + "\n"

    async def stream():
        started = time.perf_counter()
        for line in cached:
            yield ndjson(line)
        try:
            for group in groups:
                async for line in run_slices(group, size_fn, body.refine):
                    state.slices.save(ids[line["param"]], line)
                    yield ndjson(line)
        except SizingTimeout as exc:
            # Headers are already out; report the failure as a line instead of a 504.
            yield ndjson({"error": {"code": "sizing_timeout", "message": str(exc)}})
            return
        except asyncio.CancelledError:
            log.info("feasibility cancelled by the client after %d runs", counter["runs"])
            raise
        yield ndjson({"done": True, "n_runs": counter["runs"],
                      "elapsed_s": round(time.perf_counter() - started, 2), "cached": len(cached)})

    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"})

@router.post(paths.EVTOL_SCREENING)
async def screening(body: ScreeningRequest, request: Request) -> dict:
    state = request.app.state
    base = _baseline(request, body.baseline)
    unknown_outputs = sorted(set(body.outputs) - set(SUMMARY_OUTPUTS))
    if unknown_outputs or not body.outputs or len(set(body.outputs)) != len(body.outputs):
        reason = (
            f"Unknown outputs: {unknown_outputs}."
            if unknown_outputs
            else "Outputs must be a non-empty list without duplicates."
        )
        raise HTTPException(422, {
            "code": "invalid_screening_outputs",
            "message": reason,
        })

    factor_count = sum(1 for spec in state.catalogue["parameters"] if spec["key"] != "tilt_rotor_count")
    n_runs = body.r * (factor_count + 1)
    if n_runs > MAX_SCREENING_RUNS:
        raise HTTPException(422, {
            "code": "too_many_screening_runs",
            "message": f"{n_runs} runs requested; the limit is {MAX_SCREENING_RUNS}.",
        })

    try:
        design = build_screening_design(
            state.catalogue, body.r, body.levels, body.seed, body.bounds
        )
    except ValueError as exc:
        raise HTTPException(422, {"code": "invalid_screening_request", "message": str(exc)}) from exc

    canonical = json.dumps(body.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    cache_key = hashlib.sha256(canonical.encode()).hexdigest()
    cached = state.runs.load_screening(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    started = time.perf_counter()
    configs = [
        _apply(request, base, point, enforce_bounds=False)
        for point in design.overrides
    ]
    summaries = await _map(request, size_summary, configs)
    n_constraint = sum(bool(check_constraints(config)) for config in configs)
    payload = analyze_screening(
        design,
        summaries,
        body.outputs,
        body.r,
        body.seed,
        n_constraint=n_constraint,
        elapsed_s=time.perf_counter() - started,
    )
    payload["baseline"] = body.baseline
    payload["cached"] = False
    payload["elapsed_s"] = round(time.perf_counter() - started, 3)
    state.runs.save_screening(cache_key, payload)
    return payload
