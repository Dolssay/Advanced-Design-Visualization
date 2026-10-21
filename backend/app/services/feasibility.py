"""Feasible range of each slider around the current design (Demo 2, F1-1).

For one parameter *p*, with every other input held at its current value: which
values of *p* give a design that closes? The answer is a list of contiguous
``segments`` across the slider range, each with one status:

    constraint  violates C1-C6 (found analytically, never sized)
    converged / max_iter / diverged / error   from the solver, see status_class()

Everything here is pure Python: the solver comes in as ``size_fn`` (a batch
function, so the route can send one ``runner.map`` per round and tests can pass
a fake), and configs come from each job's ``make_config``.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable

from app.services.evtol_model import status_class

CONSTRAINT = "constraint"
_EPS = 1e-9

Point = dict[str, Any]
SizeFn = Callable[[list[dict[str, Any]]], Awaitable[list[dict[str, Any]]]]


@dataclass
class SliceJob:
    key: str
    limit: tuple[float, float]              # effective slider range
    current: float                          # value in the current design
    bounds: list[dict[str, Any]]            # constraint_interval(config, key)
    integer: bool
    make_config: Callable[[float], dict[str, Any]]
    scan: tuple[float, float] | None        # allowed_range(limit, bounds); None = nothing to size
    values: list[float]                     # coarse grid inside `scan`
    points: list[Point] = field(default_factory=list)


def slice_id(baseline: str, design: dict[str, float], key: str, resolution: int, refine: int, max_iter: int) -> str:
    """Cache key of one slice. It leaves out ``key``'s own value on purpose: the
    slice for *p* does not depend on *p*, so it stays valid while *p* is dragged."""
    canonical = json.dumps({
        "baseline": baseline, "param": key, "resolution": resolution, "refine": refine, "max_iter": max_iter,
        "others": {k: v for k, v in design.items() if k != key},
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


# --------------------------------------------------------------------------- grid

def grid_values(lo: float, hi: float, resolution: int, integer: bool) -> list[float]:
    """``resolution`` evenly spaced values from lo to hi inclusive; every integer
    for integer parameters."""
    if integer:
        return list(range(math.ceil(lo - _EPS), math.floor(hi + _EPS) + 1))
    if hi - lo <= _EPS:
        return [round(lo, 6)]
    n = max(2, int(resolution))
    return [round(lo + (hi - lo) * i / (n - 1), 6) for i in range(n)]


def allowed_range(limit: tuple[float, float], bounds: list[dict[str, Any]]) -> tuple[float, float] | None:
    """The slider range cut down by the analytic constraints; None when empty."""
    lo, hi = limit
    for b in bounds:
        if b.get("lo") is not None:
            lo = max(lo, float(b["lo"]))
        if b.get("hi") is not None:
            hi = min(hi, float(b["hi"]))
    return (lo, hi) if lo <= hi + _EPS else None


# --------------------------------------------------------------------------- points

def point_from_summary(value: float, summary: dict[str, Any]) -> Point:
    return {
        "value": value,
        "status": status_class(summary.get("status")),
        "mtow_kg": summary.get("mtow_kg"),
        "iterations": summary.get("iterations"),
        "message": summary.get("message"),
    }


def _sorted(points: list[Point]) -> list[Point]:
    return sorted(points, key=lambda p: p["value"])


def refine_candidates(points: list[Point], integer: bool) -> list[float]:
    """Midpoint of every pair of neighbouring points whose status differs.
    Sizing these once is one bisection step for every boundary of the slice."""
    out: list[float] = []
    pts = _sorted(points)
    for a, b in zip(pts, pts[1:]):
        if a["status"] == b["status"]:
            continue
        if integer:
            if b["value"] - a["value"] <= 1:
                continue
            out.append((a["value"] + b["value"]) // 2)
        else:
            mid = round((a["value"] + b["value"]) / 2, 6)
            if a["value"] < mid < b["value"]:
                out.append(mid)
    return out


def merge_segments(points: list[Point], lo: float, hi: float) -> list[dict[str, Any]]:
    """Join neighbouring points of equal status into segments covering [lo, hi].
    A boundary sits halfway between the last point of one status and the first
    of the next; a failed segment keeps the first solver message as ``reason``."""
    runs: list[dict[str, Any]] = []
    for p in _sorted(points):
        if runs and runs[-1]["status"] == p["status"]:
            runs[-1]["last"] = p["value"]
            continue
        runs.append({"status": p["status"], "first": p["value"], "last": p["value"], "message": p.get("message")})

    segments = []
    for i, run in enumerate(runs):
        seg_lo = lo if i == 0 else round((runs[i - 1]["last"] + run["first"]) / 2, 6)
        seg_hi = hi if i == len(runs) - 1 else round((run["last"] + runs[i + 1]["first"]) / 2, 6)
        seg: dict[str, Any] = {"lo": seg_lo, "hi": seg_hi, "status": run["status"]}
        if run["status"] != "converged" and run["message"]:
            seg["reason"] = run["message"]
        segments.append(seg)
    return segments


# --------------------------------------------------------------------------- slice

def _reason(bounds: list[dict[str, Any]]) -> str:
    return "; ".join(f"{b['id']}: {b.get('text') or 'constraint violated'}" for b in bounds)


def _constraint_reason(bounds: list[dict[str, Any]], side: str, edge: float) -> str:
    """The constraints whose bound on this side is what cuts the range at ``edge``."""
    cutting = [b for b in bounds if b.get(side) is not None and abs(float(b[side]) - edge) <= _EPS]
    return _reason(cutting or bounds)


def _public_point(p: Point) -> dict[str, Any]:
    return {"value": p["value"], "status": p["status"], "mtow_kg": p["mtow_kg"], "iterations": p["iterations"]}


def build_slice(job: SliceJob) -> dict[str, Any]:
    """One NDJSON line: the merged segments of a job whose points are sized."""
    lo, hi = job.limit
    segments: list[dict[str, Any]] = []
    if job.scan is None:
        # The analytic constraints leave no allowed value: all constraint, never sized.
        segments.append({"lo": lo, "hi": hi, "status": CONSTRAINT, "reason": _reason(job.bounds)})
    else:
        scan_lo, scan_hi = job.scan
        if scan_lo > lo + _EPS:
            segments.append({"lo": lo, "hi": scan_lo, "status": CONSTRAINT,
                             "reason": _constraint_reason(job.bounds, "lo", scan_lo)})
        segments.extend(merge_segments(job.points, scan_lo, scan_hi))
        if scan_hi < hi - _EPS:
            segments.append({"lo": scan_hi, "hi": hi, "status": CONSTRAINT,
                             "reason": _constraint_reason(job.bounds, "hi", scan_hi)})

    return {
        "param": job.key,
        "limit": [lo, hi],
        "current": job.current,
        "constraint": job.bounds,
        "segments": segments,
        "feasible": [[s["lo"], s["hi"]] for s in segments if s["status"] == "converged"],
        "points": [_public_point(p) for p in _sorted(job.points)],
    }


# --------------------------------------------------------------------------- driver

async def _size_round(batch: list[tuple[SliceJob, float]], size_fn: SizeFn) -> None:
    if not batch:
        return
    summaries = await size_fn([job.make_config(value) for job, value in batch])
    for (job, value), summary in zip(batch, summaries):
        job.points.append(point_from_summary(value, summary))


async def run_slices(jobs: list[SliceJob], size_fn: SizeFn, refine: int) -> AsyncIterator[dict[str, Any]]:
    """Coarse scan, then ``refine`` bisection rounds, for all jobs together: one
    ``size_fn`` call per round so the worker pool stays full. Yields one line per
    job once the group is done. Jobs with nothing to size cost no solver runs."""
    active = [job for job in jobs if job.scan is not None and job.values]
    await _size_round([(job, v) for job in active for v in job.values], size_fn)
    for _ in range(refine):
        batch = [(job, v) for job in active for v in refine_candidates(job.points, job.integer)]
        if not batch:
            break
        await _size_round(batch, size_fn)
    for job in jobs:
        yield build_slice(job)
