"""Request bodies. Responses are plain JSON documented in docs/api.md."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DesignRequest(BaseModel):
    baseline: str = Field("Archer_Midnight", description="Baseline name from /api/v1/evtol/baselines")
    overrides: dict[str, float] = Field(
        default_factory=dict,
        description="Catalogue parameter -> value. Keys from /api/v1/evtol/parameters.",
        examples=[{"payload_kg": 453, "batt_spec_energy_w_h_p_kg": 256}],
    )


class SizeRequest(DesignRequest):
    pass


class SweepRequest(DesignRequest):
    parameter: str = Field(..., examples=["batt_spec_energy_w_h_p_kg"])
    start: float | None = Field(None, description="Defaults to the catalogue minimum")
    stop: float | None = Field(None, description="Defaults to the catalogue maximum")
    step: float | None = Field(None, gt=0, description="Defaults to the catalogue step")


class SensitivityRequest(DesignRequest):
    delta_pct: float = Field(10.0, gt=0, le=50, description="Perturbation of continuous inputs, % of the design value")
    parameters: list[str] | None = Field(None, description="Defaults to every catalogue parameter")


class EnsembleRequest(BaseModel):
    baseline: str = "Archer_Midnight"
    n_samples: int = Field(50, ge=1)
    seed: int = 0
