// Every backend URL the frontend calls, written exactly as the backend declares it
// (backend/app/api/paths.py). Dev (Vite) and production (nginx) both forward /api/*
// unchanged, so these strings are also what you see in the network tab and in the
// backend's /api/docs page. backend/tests/test_route_contract.py fails if this file
// and paths.py drift apart.
//
// Shape: /api/<version>/<domain>/<resource>[/<id>[/<sub-resource>]]

const enc = encodeURIComponent;

export const API = {
  info: "/api/v1/info",

  evtol: {
    baselines: "/api/v1/evtol/baselines",
    baseline: (name) => `/api/v1/evtol/baselines/${enc(name)}`,
    parameters: "/api/v1/evtol/parameters",
    size: "/api/v1/evtol/size",
    run: (run_id) => `/api/v1/evtol/runs/${enc(run_id)}`,
    runImage: (run_id, kind) => `/api/v1/evtol/runs/${enc(run_id)}/images/${enc(kind)}.png`,
    sweep: "/api/v1/evtol/sweep",
    sensitivity: "/api/v1/evtol/sensitivity",
    ensemble: "/api/v1/evtol/ensemble"
  }
};
