"""FastAPI application factory.

Run locally from backend/:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import evtol, meta
from app.config import Settings, get_settings
from app.services.evtol_model import load_catalogue, size_design
from app.services.runner import SizingRunner
from app.services.store import BaselineStore, RunStore

log = logging.getLogger("adv_viz")


async def _warm_up(app: FastAPI) -> None:
    """Size one baseline so a broken evtolpy fails readiness, not the first user."""
    state = app.state
    name = state.settings.warmup_baseline
    config = state.baselines.get(name)
    if config is None:
        state.ready_status, state.ready_error = "failed", f"Warm-up baseline '{name}' not found."
        return
    try:
        result = await state.runner.run(size_design, config, name)
    except Exception as exc:  # noqa: BLE001 - report any failure through /readyz
        state.ready_status, state.ready_error = "failed", f"{type(exc).__name__}: {exc}"
        return
    if result["status"] != "Success":
        state.ready_status, state.ready_error = "failed", f"Warm-up sizing {result['status']}: {result['message']}"
        return
    state.ready, state.ready_status, state.ready_error = True, "ready", None
    log.info("warm-up sized %s: MTOW %.1f kg", name, result["mtow_kg"])


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state = app.state
        state.settings = settings
        state.ready, state.ready_status, state.ready_error = False, "starting", None
        state.catalogue = load_catalogue()
        state.baselines = BaselineStore(settings.baselines_dir)
        state.baselines.load()
        state.runs = RunStore(settings.runs_dir)
        state.runs.prepare()
        state.runner = SizingRunner(settings.sizing_workers, settings.sizing_timeout_s)
        state.runner.start()
        await _warm_up(app)
        try:
            yield
        finally:
            state.runner.shutdown()

    app = FastAPI(
        title="Advanced Design Visualization API",
        version=settings.app_version,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_origins,
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )

    @app.middleware("http")
    async def request_log(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        if request.url.path not in ("/healthz", "/readyz"):
            log.info("%s %s %s %.0fms id=%s", request.method, request.url.path, response.status_code,
                     (time.perf_counter() - started) * 1000, request_id)
        return response

    app.include_router(meta.router)
    app.include_router(evtol.router)
    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = create_app()
