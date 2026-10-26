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


class FeasibilityRequest(DesignRequest):
    """1-D feasibility slices: for each parameter, which values close with every
    other input held at the current design. Streamed as NDJSON."""

    parameters: list[str] | None = Field(None, description="Defaults to every catalogue parameter")
    priority: list[str] = Field(default_factory=list, description="Slices to stream first (the slider being edited)")
    resolution: int = Field(13, ge=3, le=41, description="Grid points across the slider range (integers use every value)")
    refine: int = Field(3, ge=0, le=6, description="Bisection steps at each status change")


class EnsembleRequest(BaseModel):
    baseline: str = "Archer_Midnight"
    n_samples: int = Field(50, ge=1)
    seed: int = 0


class ScreeningRequest(BaseModel):
    baseline: str = "Archer_Midnight"
    r: int = Field(20, ge=1, description="Number of Morris trajectories")
    levels: int = Field(4, ge=2, description="Number of grid levels (must be even)")
    seed: int = Field(0, description="Deterministic sampler and bootstrap seed")
    bounds: dict[str, list[float]] | None = Field(
        None, description="Optional parameter bounds as {parameter: [low, high]}"
    )
    outputs: list[str] = Field(
        default_factory=lambda: [
            "mtow_kg",
            "empty_mass_kg",
            "battery_mass_kg",
            "total_energy_kw_hr",
            "cruise_l_p_d",
        ]
    )
