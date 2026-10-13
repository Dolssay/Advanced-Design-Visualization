"""Health probes and platform info."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api import paths

router = APIRouter(tags=["meta"])


@router.get(paths.HEALTHZ, include_in_schema=False)
def healthz() -> dict:
    """Liveness: the process is up and answering."""
    return {"status": "ok"}


@router.get(paths.READYZ, include_in_schema=False)
def readyz(request: Request):
    """Readiness: baselines loaded and the warm-up sizing succeeded."""
    state = request.app.state
    if state.ready:
        return {"status": "ready"}
    return JSONResponse(status_code=503, content={"status": state.ready_status, "error": state.ready_error})


@router.get(paths.INFO)
def info(request: Request) -> dict:
    """Who am I: versions, readiness and the list of API routes."""
    state = request.app.state
    settings = state.settings
    api_routes = sorted(
        {
            (method, route.path)
            for route in request.app.routes
            if getattr(route, "path", "").startswith(paths.API_V1)
            for method in getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}
        },
        key=lambda r: (r[1], r[0]),
    )
    return {
        "name": "Advanced Design Visualization API",
        "version": settings.app_version,
        "git_sha": settings.git_sha,
        "evtolpy_sha": settings.evtolpy_sha,
        "ready": state.ready,
        "baselines": state.baselines.names(),
        "routes": [{"method": m, "path": p} for m, p in api_routes],
    }
