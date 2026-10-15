"""The frontend must call exactly the URLs the backend declares.

Reads frontend/shared/api/endpoints.js, turns every `/api/...` path (with
`${param}` placeholders) into FastAPI's `{param}` form, and checks each one is
a real route. Skipped when the frontend folder isn't present (e.g. inside the
backend Docker image).
"""

import re
from pathlib import Path

import pytest

from app.api import paths
from app.main import create_app

ENDPOINTS_JS = Path(__file__).resolve().parents[2] / "frontend" / "shared" / "api" / "endpoints.js"


def _frontend_paths() -> set[str]:
    source = ENDPOINTS_JS.read_text(encoding="utf-8")
    raw = re.findall(r"[`\"'](/api/[^`\"']*)[`\"']", source)
    # `${run_id}` and `${enc(run_id)}` both become FastAPI's `{run_id}`
    return {re.sub(r"\$\{(?:\w+\()?(\w+)\)?\}", r"{\1}", p) for p in raw}


@pytest.mark.skipif(not ENDPOINTS_JS.exists(), reason="frontend not checked out next to backend")
def test_frontend_calls_only_declared_routes():
    backend = {route.path for route in create_app().routes if route.path.startswith(paths.API_V1)}
    frontend = _frontend_paths()
    assert frontend, "no /api paths found in endpoints.js"
    assert frontend <= backend, f"frontend calls undeclared routes: {sorted(frontend - backend)}"


@pytest.mark.skipif(not ENDPOINTS_JS.exists(), reason="frontend not checked out next to backend")
def test_every_api_route_has_a_frontend_name():
    backend = {route.path for route in create_app().routes if route.path.startswith(paths.API_V1)}
    missing = backend - _frontend_paths()
    assert not missing, f"backend routes with no entry in endpoints.js: {sorted(missing)}"
