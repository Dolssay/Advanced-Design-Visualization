"""Baselines in memory and sized runs on disk.

A run is keyed by a hash of (baseline name, full config), so sizing the same
design twice returns the cached result and images.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

REQUIRED_SECTIONS = ("aircraft", "environ", "mission", "power", "propulsion")
RUN_ID = re.compile(r"^[0-9a-f]{16}$")


class BaselineStore:
    def __init__(self, directory: Path):
        self.directory = directory
        self.baselines: dict[str, dict[str, Any]] = {}

    def load(self) -> None:
        loaded = {}
        for path in sorted(self.directory.glob("*.json")):
            with open(path, encoding="utf-8") as fh:
                config = json.load(fh)
            missing = [s for s in REQUIRED_SECTIONS if s not in config]
            if missing:
                raise ValueError(f"Baseline {path.name} is missing sections: {missing}")
            loaded[path.stem] = config
        if not loaded:
            raise ValueError(f"No baseline JSON files found in {self.directory}")
        self.baselines = loaded

    def names(self) -> list[str]:
        return list(self.baselines)

    def get(self, name: str) -> dict[str, Any] | None:
        return self.baselines.get(name)


def run_id_for(name: str, config: dict[str, Any]) -> str:
    canonical = json.dumps({"name": name, "config": config}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


class RunStore:
    def __init__(self, directory: Path):
        self.directory = directory

    def prepare(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)

    def run_dir(self, run_id: str) -> Path:
        if not RUN_ID.match(run_id):
            raise KeyError(run_id)
        return self.directory / run_id

    def load(self, run_id: str) -> dict[str, Any] | None:
        try:
            path = self.run_dir(run_id) / "result.json"
        except KeyError:
            return None
        if not path.exists():
            return None
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    def save(self, run_id: str, payload: dict[str, Any]) -> None:
        directory = self.run_dir(run_id)
        directory.mkdir(parents=True, exist_ok=True)
        tmp = directory / "result.json.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        tmp.replace(directory / "result.json")

    def image_path(self, run_id: str, kind: str) -> Path | None:
        try:
            path = self.run_dir(run_id) / f"{kind}.png"
        except KeyError:
            return None
        return path if path.exists() else None
