"""Runtime settings, read once from environment variables.

Every setting has a default that works for local development, so
`uvicorn app.main:app --reload` runs with no environment at all.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app import __version__

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _list(name: str, default: str) -> list[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_version: str = __version__
    git_sha: str = field(default_factory=lambda: os.environ.get("GIT_SHA", "dev"))
    evtolpy_sha: str = field(default_factory=lambda: os.environ.get("EVTOLPY_SHA", "vendored"))

    # Same-origin through the Vite proxy (dev) and nginx (containers), so CORS is
    # only needed when a page on another origin calls the API directly.
    allowed_origins: list[str] = field(default_factory=lambda: _list("ALLOWED_ORIGINS", ""))

    baselines_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("BASELINES_DIR", BACKEND_DIR / "data" / "baselines"))
    )
    runs_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get("RUNS_DIR", Path(tempfile.gettempdir()) / "adv-viz-runs")
        )
    )

    # Worker processes for sizing. One Archer Midnight sizing takes ~0.25 s.
    sizing_workers: int = field(default_factory=lambda: _int("SIZING_WORKERS", min(4, os.cpu_count() or 1)))
    sizing_timeout_s: int = field(default_factory=lambda: _int("SIZING_TIMEOUT_S", 60))
    max_sweep_points: int = field(default_factory=lambda: _int("MAX_SWEEP_POINTS", 41))
    max_ensemble_samples: int = field(default_factory=lambda: _int("MAX_ENSEMBLE_SAMPLES", 200))

    # Size this baseline at startup; /readyz stays 503 until it succeeds.
    warmup_baseline: str = field(default_factory=lambda: os.environ.get("WARMUP_BASELINE", "Archer_Midnight"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
