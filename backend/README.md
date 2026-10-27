# Backend: FastAPI + evtolpy

Serves Demo 2: sizes eVTOL designs with evtolpy, renders the five matplotlib plots,
and runs sweeps, one-at-a-time sensitivity and LHS ensembles.

## Run

```bash
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

- http://localhost:8000/api/docs: interactive API docs
- http://localhost:8000/readyz: 200 once the Archer Midnight warm-up sizing passes

Run everything from `backend/`. `pyproject.toml` puts `.` and `evtolpy/` on the
path for pytest; the Dockerfile sets `PYTHONPATH=/srv:/srv/evtolpy`. The app also
adds `evtolpy/` itself, so plain `uvicorn` works without setting anything.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SIZING_WORKERS` | min(4, CPUs) | Worker processes for sizing |
| `SIZING_TIMEOUT_S` | 60 | Per-design timeout |
| `MAX_SWEEP_POINTS` | 41 | Largest sweep accepted |
| `MAX_ENSEMBLE_SAMPLES` | 200 | Largest ensemble accepted |
| `RUNS_DIR` | system temp `/adv-viz-runs` | Cached runs and PNGs |
| `BASELINES_DIR` | `data/baselines` | Baseline aircraft JSON |
| `ALLOWED_ORIGINS` | empty | CORS origins, comma-separated. Not needed behind Vite or nginx |
| `WARMUP_BASELINE` | `Archer_Midnight` | Sized at startup to gate readiness |
| `GIT_SHA`, `EVTOLPY_SHA` | `dev`, `vendored` | Shown by `/api/v1/info`; set as Docker build args |

## How sizing works

`app/services/evtol_model.py` is the only module that touches evtolpy.

1. `apply_overrides()` copies a baseline, sets the requested catalogue parameters
   (validated against `app/params/evtol_parameters.json`), and couples the rotors:
   tilt = lift and rotor_count = lift + tilt.
2. `size_design()` writes the config to a private temp file (evtolpy's `Aircraft()`
   only takes a path), runs `_iterate_mtow()`, then reads the masses, energies,
   power, drag and geometry **after** convergence. Failures come back as a status
   (`ValueError` when the MTOW iteration diverges); they don't raise.
3. `FastAircraft` subclasses `Aircraft` so its environ/mission/power/propulsion
   accessors stop returning `copy.deepcopy` on every read. That takes one Archer
   Midnight sizing from about 11 s to 0.25 s with identical results
   (`tests/test_evtol_model.py::test_fast_aircraft_matches_upstream_exactly`).
   It also memoizes the derived wing/tail geometry (wing area was recomputed ~380k
   times per run) until the next attribute write, which brings a run to ~0.1 s.
   evtolpy itself is unmodified, ready for the submodule switch.
4. `SizingRunner` runs this in a spawn-based process pool (pyplot isn't thread-safe;
   spawn behaves the same on Windows and Linux). `/size` results and PNGs are
   cached under `RUNS_DIR/<run_id>/`, where run_id hashes baseline + config.

## Tests

```bash
pytest
```

- `test_evtol_model.py`: speed-up equivalence, Archer regression (MTOW 3268.8 kg), overrides, constraints
- `test_api.py`: every route, including error codes
- `test_route_contract.py`: frontend `endpoints.js` and backend routes must match

## Batch pipelines

Moved from `src/Demo 2/`. They now share the API's sizing code.

```bash
python -m pipelines.lhs --n 150                     # samples only
python -m pipelines.ensemble --n 200 --seed 0       # samples + sizing + plots -> output/GLEEinput/
python -m pipelines.export_failed_configs           # JSON for each failed run
python -m pipelines.precompute_ensemble             # 2,000 Archer designs -> output/prebuilt/ensembles/
```

`precompute_ensemble` saves the same payload `POST /api/v1/evtol/ensemble` returns,
keyed by a hash of (baseline, n, seed, bounds), so the demo opens with a ready-made
ensemble instead of a ~2 min wait. The files are git-ignored; regenerate them on your
machine. `deploy/docker-compose.yml` mounts `output/prebuilt` read-only at `/srv/prebuilt`.

`pipelines/ensemble.py` keeps the GLEE CSV columns and image names. The column
"Cruise Speed (m/s)" is a historical header: the value is the cruise time in seconds.

## Production / Kubernetes Deployment (Prebuilt Ensembles)

On Kubernetes / Rancher, ready-made ensembles are mounted read-only at `/srv/prebuilt` via a PersistentVolumeClaim (`prebuilt` in `deploy/k8s/base/prebuilt-pvc.yaml`).
The PVC is populated once by a Kubernetes Job (`deploy/k8s/base/precompute-job.yaml`) running:
```bash
python -m pipelines.precompute_ensemble --out /srv/prebuilt
```
The backend container reads `PREBUILT_DIR=/srv/prebuilt` at startup, allowing instant loading of ensembles with zero runtime sizing delay.
