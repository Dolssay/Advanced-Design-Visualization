"""Scan / refine / merge with fake solvers: no evtolpy, no worker pool."""

import asyncio

from app.services.feasibility import (
    SliceJob,
    allowed_range,
    grid_values,
    merge_segments,
    refine_candidates,
    run_slices,
)


def _job(lo=0.0, hi=10.0, bounds=(), integer=False, resolution=11, key="x"):
    limit = (lo, hi)
    scan = allowed_range(limit, list(bounds))
    values = grid_values(*scan, resolution, integer) if scan else []
    return SliceJob(key=key, limit=limit, current=5, bounds=list(bounds), integer=integer,
                    make_config=lambda v: {"x": v}, scan=scan if values else None, values=values)


def _solver(predicate, calls):
    async def size_fn(configs):
        calls.append(len(configs))
        return [{"status": "Success", "mtow_kg": 1.0, "iterations": 3} if predicate(c["x"])
                else {"status": "ValueError", "message": f"fails at {c['x']}", "mtow_kg": None, "iterations": None}
                for c in configs]
    return size_fn


def _lines(jobs, size_fn, refine):
    async def collect():
        return [line async for line in run_slices(jobs, size_fn, refine)]
    return asyncio.run(collect())


def test_boundary_lands_within_one_refinement_step():
    calls = []
    job = _job(0, 10, resolution=11)           # coarse step 1
    refine = 3
    (line,) = _lines([job], _solver(lambda x: x >= 3, calls), refine)
    assert [s["status"] for s in line["segments"]] == ["diverged", "converged"]
    boundary = line["segments"][0]["hi"]
    assert abs(boundary - 3) <= 1 / 2 ** refine
    assert line["feasible"] == [[boundary, 10.0]]
    assert line["segments"][0]["reason"] == "fails at 0.0"   # first failed point's message
    assert calls == [11, 1, 1, 1]              # coarse scan, then one midpoint per round


def test_merge_segments_joins_runs_and_keeps_edges():
    pts = [{"value": v, "status": s, "message": m} for v, s, m in
           [(0, "diverged", "first"), (1, "diverged", "second"), (2, "converged", None),
            (3, "converged", None), (4, "max_iter", "slow")]]
    segs = merge_segments(pts, 0, 4)
    assert segs == [
        {"lo": 0, "hi": 1.5, "status": "diverged", "reason": "first"},
        {"lo": 1.5, "hi": 3.5, "status": "converged"},
        {"lo": 3.5, "hi": 4, "status": "max_iter", "reason": "slow"},
    ]


def test_grid_and_refine_for_integers():
    assert grid_values(2, 7, 13, integer=True) == [2, 3, 4, 5, 6, 7]
    assert grid_values(0, 1, 5, integer=False) == [0, 0.25, 0.5, 0.75, 1]
    pts = [{"value": 2, "status": "converged"}, {"value": 3, "status": "diverged"},
           {"value": 6, "status": "diverged"}, {"value": 9, "status": "converged"}]
    assert refine_candidates(pts, integer=True) == [7]       # 2|3 are neighbours already; 6|9 -> 7
    assert refine_candidates(pts, integer=False) == [2.5, 7.5]


def test_constraint_bounds_cut_the_scan_range():
    calls = []
    bounds = [{"id": "C6", "lo": 2.0, "hi": None, "text": "needs span"}, {"id": "C1", "lo": None, "hi": 8.0, "text": "D-value"}]
    job = _job(0, 10, bounds=bounds, resolution=7)
    (line,) = _lines([job], _solver(lambda x: True, calls), 2)
    assert job.scan == (2.0, 8.0) and job.values == [2, 3, 4, 5, 6, 7, 8]
    assert [(s["lo"], s["hi"], s["status"]) for s in line["segments"]] == [
        (0.0, 2.0, "constraint"), (2.0, 8.0, "converged"), (8.0, 10.0, "constraint")]
    assert line["segments"][0]["reason"] == "C6: needs span"
    assert line["segments"][-1]["reason"] == "C1: D-value"
    assert line["feasible"] == [[2.0, 8.0]]
    assert calls == [7]


def test_empty_intersection_never_calls_the_solver():
    calls = []
    bounds = [{"id": "C6", "lo": None, "hi": 0.23, "text": "12 rotors must fit"}]
    job = _job(0.5, 4.0, bounds=bounds)
    assert job.scan is None
    (line,) = _lines([job], _solver(lambda x: True, calls), 3)
    assert calls == []
    assert line["segments"] == [{"lo": 0.5, "hi": 4.0, "status": "constraint", "reason": "C6: 12 rotors must fit"}]
    assert line["feasible"] == [] and line["points"] == []


def test_jobs_are_batched_together():
    calls = []
    jobs = [_job(0, 10, resolution=6, key="a"), _job(0, 10, resolution=6, key="b")]
    lines = _lines(jobs, _solver(lambda x: x >= 5, calls), 1)
    assert [l["param"] for l in lines] == ["a", "b"]
    assert calls == [12, 2]                    # both coarse grids in one call, both midpoints in one call
