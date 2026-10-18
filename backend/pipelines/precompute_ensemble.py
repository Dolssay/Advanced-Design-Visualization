"""Precompute LHS ensembles so the demo opens with data instead of a ~2 min wait.

Run from backend/ (output/ is git-ignored; each teammate regenerates it):
    python -m pipelines.precompute_ensemble                       # 2,000 Archer designs, seed 0
    python -m pipelines.precompute_ensemble --n 500 --seed 1 --baseline Joby_s4
    python -m pipelines.precompute_ensemble --bounds my_box.json  # {"payload_kg": [400, 500], ...}

Writes, under --out (default output/prebuilt):
    ensembles/<ensemble_id>.json   the same payload POST /api/v1/evtol/ensemble returns
    ensembles/index.json           one summary line per collection, for a picker

The backend container mounts output/prebuilt read-only at /srv/prebuilt
(deploy/docker-compose.yml). The id is a hash of (baseline, n, seed, bounds), so
re-running with the same arguments overwrites the same file.
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from app.services.ensemble import build_payload, sample_inputs
from app.services.evtol_model import apply_overrides, load_catalogue, size_summary
from app.services.runner import _init_worker

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _write_json(path: Path, payload) -> None:
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    tmp.replace(path)


def _update_index(directory: Path, payload: dict) -> None:
    path = directory / "index.json"
    entries = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    entries = [e for e in entries if e["ensemble_id"] != payload["ensemble_id"]]
    entries.append({k: payload[k] for k in ("ensemble_id", "baseline", "seed", "bounds", "status_counts",
                                            "n_samples", "created", "elapsed_s")})
    _write_json(path, sorted(entries, key=lambda e: e["created"]))


def main() -> None:
    parser = argparse.ArgumentParser(description="Size an LHS ensemble offline and save it for the API to serve.")
    parser.add_argument("--baseline", default="Archer_Midnight", help="Name of a JSON file in data/baselines/")
    parser.add_argument("--n", type=int, default=2000, help="Number of samples")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--bounds", type=Path, help='JSON file {"param": [lo, hi]}; default is the study box')
    parser.add_argument("--out", type=Path, default=BACKEND_DIR / "output" / "prebuilt")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = parser.parse_args()

    with open(BACKEND_DIR / "data" / "baselines" / f"{args.baseline}.json", encoding="utf-8") as fh:
        baseline = json.load(fh)
    bounds = json.loads(args.bounds.read_text(encoding="utf-8")) if args.bounds else None
    catalogue = load_catalogue()

    inputs = sample_inputs(catalogue, args.n, args.seed, bounds)
    configs = [apply_overrides(baseline, overrides, catalogue, enforce_bounds=False) for overrides in inputs]

    print(f"Sizing {len(configs)} {args.baseline} designs on {args.workers} workers…", flush=True)
    started = time.perf_counter()
    summaries = []
    with ProcessPoolExecutor(args.workers, mp_context=mp.get_context("spawn"), initializer=_init_worker) as pool:
        for i, summary in enumerate(pool.map(size_summary, configs, chunksize=4), start=1):
            summaries.append(summary)
            if i % 200 == 0 or i == len(configs):
                rate = i / (time.perf_counter() - started)
                print(f"  {i}/{len(configs)}  {rate:.1f} designs/s  ~{(len(configs) - i) / rate:.0f} s left", flush=True)
    elapsed = round(time.perf_counter() - started, 1)

    payload = build_payload(args.baseline, args.seed, bounds, catalogue, inputs, summaries)
    payload.update({"n_samples": len(inputs), "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "elapsed_s": elapsed})
    directory = args.out / "ensembles"
    directory.mkdir(parents=True, exist_ok=True)
    _write_json(directory / f"{payload['ensemble_id']}.json", payload)
    _update_index(directory, payload)
    counts = " · ".join(f"{k} {v}" for k, v in payload["status_counts"].items())
    print(f"Saved {payload['ensemble_id']} ({counts}) in {elapsed} s -> {directory}")


if __name__ == "__main__":
    main()
