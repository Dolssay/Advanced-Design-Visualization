# Advanced Design Visualization

Code for the Advanced Visualization Methods for Design project, IDOPt Lab, Virginia Tech.
One repository hosts three demos for exploring complex aircraft design spaces:

| Demo | What it is | Where |
| --- | --- | --- |
| 1 | GTB777 horizontal-tail ensemble viewer (static, D3) | `frontend/demo1/` |
| 2 | eVTOL sizing with evtolpy: frontend calls a FastAPI backend | `frontend/demo2/` + `backend/` |
| 3 | F-16 multi-fidelity sizing (MATLAB), planned | — |

## Layout

```
frontend/            Vite multi-page app (vanilla ES modules + D3)
  index.html         landing page            -> /
  demo1/             GTB777 WebViz           -> /demo1/
  demo2/             eVTOL sizing UI         -> /demo2/
  shared/api/        endpoints.js (every backend URL) + client.js
  public/data/       GTB777.csv
  nginx/             production nginx config (serves dist/, proxies /api)
backend/             FastAPI app wrapping evtolpy
  app/api/paths.py   every backend URL, in one file
  app/api/           routes: meta.py (health, info), evtol.py (Demo 2)
  app/services/      evtolpy adapter, process pool, run cache
  app/viz/           matplotlib plot helpers (PNG output)
  app/params/        parameter catalogue (ranges, steps, units)
  pipelines/         batch tools: LHS ensemble for GLEE, failed-config export
  evtolpy/evtol/     vendored evtolpy (to become a git submodule)
  data/baselines/    Archer Midnight + V&V aircraft JSON
tools/demo1-prep/    offline scripts that produced Demo 1's dataset
deploy/              docker-compose.yml (Kubernetes manifests come next)
docs/api.md          route reference
```

## Run it locally (no containers)

Two terminals. Python 3.11+ and Node 18+.

```bash
# 1. backend  -> http://localhost:8000  (API docs at /api/docs)
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows;  source .venv/bin/activate on macOS/Linux
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

```bash
# 2. frontend -> http://localhost:5173
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards every `/api/*` request to the backend
unchanged, so the frontend calls `/api/v1/evtol/size` and FastAPI serves
`/api/v1/evtol/size`. The URL is identical in dev, in containers and on Rancher.
Demo 1 works without the backend.

Point Vite at a backend elsewhere with `BACKEND_URL=http://host:8000 npm run dev`.

## API naming

Every route reads like a path: `/api/<version>/<domain>/<resource>[/<id>[/<sub-resource>]]`.

```
GET  /api/v1/info
GET  /api/v1/evtol/baselines
GET  /api/v1/evtol/baselines/{name}
GET  /api/v1/evtol/parameters
POST /api/v1/evtol/size
GET  /api/v1/evtol/runs/{run_id}
GET  /api/v1/evtol/runs/{run_id}/images/{kind}.png
POST /api/v1/evtol/sweep
POST /api/v1/evtol/sensitivity
POST /api/v1/evtol/ensemble
POST /api/v1/evtol/screening
```

The backend declares them in `backend/app/api/paths.py`; the frontend names the same
strings in `frontend/shared/api/endpoints.js`. `backend/tests/test_route_contract.py`
fails if the two disagree. Demo 3 will add `/api/v1/f16/...` beside `/api/v1/evtol/...`.
Details in [docs/api.md](docs/api.md).

## Tests and build

```bash
cd backend && pytest          # 22 tests: model, API, route contract
cd frontend && npm run build  # bundles all three pages into frontend/dist
```

## Containers (production-like)

```bash
docker compose -f deploy/docker-compose.yml up --build    # -> http://localhost:8080
```

`frontend/Dockerfile` builds the Vite bundle and serves it with unprivileged nginx,
which forwards `/api/*` to `BACKEND_URL` (default `http://backend:8000`).
`backend/Dockerfile` runs uvicorn as user 10001. Both listen on unprivileged ports
(8080, 8000) for Rancher's restricted pod security.

## Batch pipeline (GLEE input)

```bash
cd backend
python -m pipelines.ensemble --n 200 --seed 0      # -> output/GLEEinput/...
python -m pipelines.export_failed_configs
```
