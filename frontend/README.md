# Frontend

A Vite multi-page app: plain ES modules and D3, no framework.

```bash
npm install
npm run dev       # http://localhost:5173, proxies /api/* to http://localhost:8000
npm run build     # -> dist/
npm run preview   # serve dist/ with the same /api proxy
```

| URL | Source |
| --- | --- |
| `/` | `index.html` (landing) |
| `/demo1/` | `demo1/` (GTB777 viewer, needs no backend) |
| `/demo2/` | `demo2/` (eVTOL sizing, needs the backend) |
| `/data/GTB777.csv` | `public/data/GTB777.csv` |

## Calling the backend

```js
import { API } from "../shared/api/endpoints.js";
import { apiGet, apiPost } from "../shared/api/client.js";

const catalogue = await apiGet(API.evtol.parameters);
const run = await apiPost(API.evtol.size, { baseline: "Archer_Midnight", overrides: { payload_kg: 480 } });
```

`apiStream(path, body, { onLine })` reads an NDJSON response line by line; Demo 2's
slider shading uses it on `/api/v1/evtol/feasibility` (`demo2/scripts/feasibility.js`).
The pure parts of that feature (`demo2/scripts/feasibilityModel.js`) are covered by
`npm test` (`node --test`).

`endpoints.js` holds every backend URL as written in `backend/app/api/paths.py`.
Add a route in both places; `backend/tests/test_route_contract.py` checks they match.
Paths are relative (`/api/...`), so the same build works behind Vite, nginx or a
Kubernetes Ingress without configuration.

Demo 2 includes a Screening tab with Morris μ*–σ and importance charts. It opens
with a clearly marked illustrative JSON sample; **Run screening** requests live
results from `POST /api/v1/evtol/screening`.

Use `BACKEND_URL` to proxy to a backend that isn't on localhost:8000:

```bash
BACKEND_URL=http://10.0.0.5:8000 npm run dev          # PowerShell: $env:BACKEND_URL="..."; npm run dev
```

## Container

`Dockerfile` builds `dist/` and serves it with `nginxinc/nginx-unprivileged` on port
8080. `nginx/default.conf.template` forwards `/api/` to `${BACKEND_URL}` with the
path unchanged, gzips the CSV and caches hashed assets.
