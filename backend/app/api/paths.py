"""Every URL the backend serves, in one place.

The frontend calls exactly these paths (frontend/shared/api/endpoints.js), and
both the Vite dev proxy and nginx forward /api/* unchanged, so the path you see
in the browser's network tab is the path declared here.
tests/test_route_contract.py fails if the two files drift apart.

Shape: /api/<version>/<domain>/<resource>[/<id>[/<sub-resource>]]
"""

# Infrastructure (Kubernetes probes): not versioned, not called by the frontend.
HEALTHZ = "/healthz"
READYZ = "/readyz"

API_V1 = "/api/v1"

# Platform-wide
INFO = f"{API_V1}/info"

# Demo 2: evtolpy sizing
EVTOL = f"{API_V1}/evtol"
EVTOL_BASELINES = f"{EVTOL}/baselines"
EVTOL_BASELINE = f"{EVTOL}/baselines/{{name}}"
EVTOL_PARAMETERS = f"{EVTOL}/parameters"
EVTOL_SIZE = f"{EVTOL}/size"
EVTOL_RUN = f"{EVTOL}/runs/{{run_id}}"
EVTOL_RUN_IMAGE = f"{EVTOL}/runs/{{run_id}}/images/{{kind}}.png"
EVTOL_SWEEP = f"{EVTOL}/sweep"
EVTOL_SENSITIVITY = f"{EVTOL}/sensitivity"
EVTOL_ENSEMBLE = f"{EVTOL}/ensemble"
EVTOL_FEASIBILITY = f"{EVTOL}/feasibility"
EVTOL_SCREENING = f"{EVTOL}/screening"


def run_image_url(run_id: str, kind: str) -> str:
    return EVTOL_RUN_IMAGE.format(run_id=run_id, kind=kind)
