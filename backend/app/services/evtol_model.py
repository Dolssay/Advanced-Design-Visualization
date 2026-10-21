"""Adapter between the API and the evtolpy package.

Everything here is plain Python with no FastAPI imports, so the same functions
run in the API's worker processes, in the batch pipelines and in tests.
"""

from __future__ import annotations

import copy
import json
import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[2]
EVTOLPY_DIR = BACKEND_DIR / "evtolpy"
if str(EVTOLPY_DIR) not in sys.path:  # PYTHONPATH normally covers this; fallback for ad-hoc runs
    sys.path.insert(0, str(EVTOLPY_DIR))

from evtol.aircraft import Aircraft  # noqa: E402
from evtol.aircraft_modules import aircraft_iteration  # noqa: E402

CATALOGUE_PATH = Path(__file__).resolve().parents[1] / "params" / "evtol_parameters.json"

IMAGE_KINDS = {
    "layout": "Aircraft layout",
    "mass-breakdown": "Mass breakdown",
    "power-profile": "Power profile",
    "energy-profile": "Energy profile",
    "cruise-drag-buildup": "Cruise drag buildup",
}


class FastAircraft(Aircraft):
    """Aircraft with read-only access to its environ/mission/power/propulsion parts.

    evtolpy's accessors return ``copy.deepcopy`` of these objects on every read,
    which made one Archer Midnight sizing take ~11 s. No calculation module writes
    through them, so returning the objects directly gives identical results in
    ~0.25 s. Verified field-by-field in tests/test_evtol_model.py.
    """

    environ = property(lambda self: self._environ)
    mission = property(lambda self: self._mission)
    power = property(lambda self: self._power)
    propulsion = property(lambda self: self._propulsion)

    def __setattr__(self, name: str, value: Any) -> None:
        # Any write (the MTOW iteration sets max_takeoff_mass_kg each step) drops
        # the memoized geometry below.
        self.__dict__.pop("_memo", None)
        super().__setattr__(name, value)


def _memoized(name: str) -> property:
    """Cache one of evtolpy's derived geometry properties until the next write.

    These depend only on the aircraft's own attributes and the constant environ,
    but evtolpy recomputes them on every read: wing_area_m2 alone was read ~380k
    times per Archer sizing, about two thirds of the run time.
    """
    compute = getattr(Aircraft, name).fget

    def get(self):
        memo = self.__dict__.setdefault("_memo", {})
        if name not in memo:
            memo[name] = compute(self)
        return memo[name]

    return property(get)


for _name in ("wing_area_m2", "wing_mac_m", "wing_root_chord_m", "wing_aspect_ratio", "horiz_tail_area_m2",
              "vert_tail_area_m2", "fuselage_fineness_ratio", "fuselage_wetted_area_m2"):
    setattr(FastAircraft, _name, _memoized(_name))


# --------------------------------------------------------------------------- catalogue

def load_catalogue() -> dict[str, Any]:
    with open(CATALOGUE_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def catalogue_index(catalogue: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {p["key"]: p for p in catalogue["parameters"]}


def design_values(config: dict[str, Any], catalogue: dict[str, Any]) -> dict[str, float]:
    """Current value of every catalogue parameter in a full config."""
    return {p["key"]: config[p["section"]][p["key"]] for p in catalogue["parameters"]}


def effective_range(spec: dict[str, Any], baseline_value: float) -> tuple[float, float]:
    """The slider range of one parameter: ``limit_min``/``limit_max`` from the
    catalogue, widened just enough to include the baseline's own value (some
    reference aircraft sit outside the presets, e.g. NASA TR's 1200 s reserve)."""
    v0 = float(baseline_value)
    return min(float(spec["limit_min"]), v0), max(float(spec["limit_max"]), v0)


class OverrideError(ValueError):
    """Raised when requested overrides are unknown or out of range."""

    def __init__(self, errors: list[dict[str, Any]]):
        super().__init__("; ".join(e["message"] for e in errors))
        self.errors = errors


def apply_overrides(
    baseline: dict[str, Any],
    overrides: dict[str, float],
    catalogue: dict[str, Any],
    enforce_bounds: bool = True,
) -> dict[str, Any]:
    """Return a deep copy of ``baseline`` with catalogue parameters replaced.

    Mirrors the field mapping in the old EnsembleDataScript and enforces the
    rotor-count coupling: tilt = lift (C5) and rotor_count = lift + tilt (C4).
    Values are checked against ``effective_range()`` (the slider range, not the
    study box). ``enforce_bounds=False`` skips that check; sensitivity and
    ensemble runs use it to perturb baselines that sit outside the Archer bounds.
    """
    index = catalogue_index(catalogue)
    errors: list[dict[str, Any]] = []
    config = copy.deepcopy(baseline)

    for key, raw in overrides.items():
        spec = index.get(key)
        if spec is None:
            errors.append({"key": key, "message": f"Unknown parameter '{key}'."})
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            errors.append({"key": key, "message": f"{spec['label']} must be a number."})
            continue
        if not math.isfinite(value):
            errors.append({"key": key, "message": f"{spec['label']} must be finite."})
            continue
        if enforce_bounds:
            lo, hi = effective_range(spec, baseline[spec["section"]][key])
            if not lo <= value <= hi:
                errors.append({
                    "key": key,
                    "message": f"{spec['label']} = {value:g} is outside {lo:g}-{hi:g} {spec['unit']}".strip() + ".",
                })
                continue
        if spec["integer"]:
            if value != round(value):
                errors.append({"key": key, "message": f"{spec['label']} must be a whole number."})
                continue
            value = int(round(value))
        config[spec["section"]][key] = value

    if errors:
        raise OverrideError(errors)

    if "lift_rotor_count" in overrides:
        prop = config["propulsion"]
        prop["tilt_rotor_count"] = prop["lift_rotor_count"]
        prop["rotor_count"] = prop["lift_rotor_count"] + prop["tilt_rotor_count"]
    return config


def check_constraints(config: dict[str, Any]) -> list[dict[str, str]]:
    """Layout constraints from the LHS study. Returned as warnings, not errors,
    because some reference aircraft (e.g. multicopters) sit outside them."""
    ac, prop = config["aircraft"], config["propulsion"]
    out = []
    if ac["wingspan_m"] > ac["d_value_m"]:
        out.append({"id": "C1", "message": f"Wingspan {ac['wingspan_m']:g} m exceeds D-value {ac['d_value_m']:g} m."})
    if ac["fuselage_l_m"] < ac["fuselage_w_m"]:
        out.append({"id": "C2", "message": "Fuselage is wider than it is long."})
    if ac["fuselage_l_m"] > ac["d_value_m"]:
        out.append({"id": "C3", "message": f"Fuselage length {ac['fuselage_l_m']:g} m exceeds D-value {ac['d_value_m']:g} m."})
    n, d = prop.get("lift_rotor_count", 0), prop.get("rotor_diameter_m", 0)
    if n:
        need = d * n + (n - 2) * 0.1
        if need > ac["wingspan_m"] + 1e-9:
            out.append({"id": "C6", "message": f"{n} rotors of {d:g} m need {need:.2f} m of span; wingspan is {ac['wingspan_m']:g} m."})
    return out


def constraint_interval(config: dict[str, Any], key: str) -> list[dict[str, Any]]:
    """The C1-C6 constraints solved for one parameter with every other input fixed.

    Returns one entry per constraint that involves ``key``, each a one-sided bound
    ``{"id", "lo", "hi", "text"}`` (``None`` for the open side). The allowed
    interval is the intersection of all of them; an empty list means unconstrained.
    """
    ac, prop = config["aircraft"], config["propulsion"]
    span, dv, fl, fw = ac["wingspan_m"], ac["d_value_m"], ac["fuselage_l_m"], ac["fuselage_w_m"]
    n, d = prop.get("lift_rotor_count", 0), prop.get("rotor_diameter_m", 0)
    clearance = (n - 2) * 0.1 if n else 0.0
    out: list[dict[str, Any]] = []

    def bound(cid: str, text: str, lo: float | None = None, hi: float | None = None) -> None:
        out.append({"id": cid, "lo": None if lo is None else round(lo, 6), "hi": None if hi is None else round(hi, 6),
                    "text": text})

    if key == "wingspan_m":
        bound("C1", f"Wingspan must not exceed the D-value {dv:g} m.", hi=dv)
        if n:
            need = d * n + clearance
            bound("C6", f"{n} rotors of {d:g} m need {need:.2f} m of span.", lo=need)
    elif key == "d_value_m":
        bound("C1", f"D-value must be at least the wingspan {span:g} m.", lo=span)
        bound("C3", f"D-value must be at least the fuselage length {fl:g} m.", lo=fl)
    elif key == "fuselage_l_m":
        bound("C2", f"Fuselage length must be at least the width {fw:g} m.", lo=fw)
        bound("C3", f"Fuselage length must not exceed the D-value {dv:g} m.", hi=dv)
    elif key == "fuselage_w_m":
        bound("C2", f"Fuselage width must not exceed the length {fl:g} m.", hi=fl)
    elif key == "rotor_diameter_m" and n:
        hi = (span - clearance) / n
        bound("C6", f"{n} rotors must fit the {span:g} m wingspan: diameter at most {hi:.2f} m.", hi=hi)
    elif key == "lift_rotor_count" and d > 0:
        # d*n + (n-2)*0.1 <= span  <=>  n <= (span + 0.2) / (d + 0.1)
        hi = math.floor((span + 0.2) / (d + 0.1) + 1e-9)
        bound("C6", f"Rotors of {d:g} m must fit the {span:g} m wingspan: at most {hi} lift rotors.", hi=hi)
    return out


STATUS_CLASSES = ("converged", "max_iter", "diverged", "error")


def status_class(status: str | None) -> str:
    """Map evtolpy's raw status (an exception class name or Success/NotConverged)
    onto the shared vocabulary used by every Demo 2 endpoint."""
    if status == "Success":
        return "converged"
    if status == "NotConverged":
        return "max_iter"
    if status == "ValueError":
        return "diverged"
    return "error"


# --------------------------------------------------------------------------- sizing

def _num(value: Any) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _collect_outputs(ac: Aircraft) -> dict[str, Any]:
    structural = {
        "Wing": ac.wing_mass_kg,
        "Horizontal Tail": ac.horiz_tail_mass_kg,
        "Vertical Tail": ac.vert_tail_mass_kg,
        "Fuselage": ac.fuselage_mass_kg,
        "Boom": ac.boom_mass_kg,
        "Landing Gear": ac.landing_gear_mass_kg,
    }
    propulsion = {
        "EPU (all rotors)": ac.epu_mass_kg,
        "Lift Rotor + Hub": ac.lift_rotor_hub_mass_kg,
        "Tilt Rotor": ac.tilt_rotor_mass_kg,
    }
    subsystems = {
        "Actuators": ac.actuator_mass_kg,
        "Furnishings": ac.furnishings_mass_kg,
        "Env. Control": ac.environmental_control_system_mass_kg,
        "Avionics": ac.avionics_mass_kg,
        "Hi-Volt Power": ac.hivolt_power_dist_mass_kg,
        "Lo-Volt Power": ac.lovolt_power_coms_mass_kg,
    }
    primary = {
        "Depart Taxi": ac.depart_taxi_energy_kw_hr,
        "Hover Climb": ac.hover_climb_energy_kw_hr,
        "Transition Climb": ac.trans_climb_energy_kw_hr,
        "Depart Procedures": ac.depart_proc_energy_kw_hr,
        "Accelerate Climb": ac.accel_climb_energy_kw_hr,
        "Cruise": ac.cruise_energy_kw_hr,
        "Decelerate Descend": ac.decel_descend_energy_kw_hr,
        "Arrive Procedures": ac.arrive_proc_energy_kw_hr,
        "Transition Descend": ac.trans_descend_energy_kw_hr,
        "Hover Descend": ac.hover_descend_energy_kw_hr,
        "Arrive Taxi": ac.arrive_taxi_energy_kw_hr,
    }
    reserve = {
        "Rsv Hover Climb": ac.reserve_hover_climb_energy_kw_hr,
        "Rsv Trans. Climb": ac.reserve_trans_climb_energy_kw_hr,
        "Rsv Accel. Climb": ac.reserve_accel_climb_energy_kw_hr,
        "Rsv Cruise": ac.reserve_cruise_energy_kw_hr,
        "Rsv Decel. Descend": ac.reserve_decel_descend_energy_kw_hr,
        "Rsv Trans. Descend": ac.reserve_trans_descend_energy_kw_hr,
        "Rsv Hover Descend": ac.reserve_hover_descend_energy_kw_hr,
    }
    power = {
        "Depart Taxi": ac.depart_taxi_avg_electric_power_kw,
        "Hover Climb": ac.hover_climb_avg_electric_power_kw,
        "Transition Climb": ac.trans_climb_avg_electric_power_kw,
        "Depart Procedures": ac.depart_proc_avg_electric_power_kw,
        "Accelerate Climb": ac.accel_climb_avg_electric_power_kw,
        "Cruise": ac.cruise_avg_electric_power_kw,
        "Decelerate Descend": ac.decel_descend_avg_electric_power_kw,
        "Arrive Procedures": ac.arrive_proc_avg_electric_power_kw,
        "Transition Descend": ac.trans_descend_avg_electric_power_kw,
        "Hover Descend": ac.hover_descend_avg_electric_power_kw,
        "Arrive Taxi": ac.arrive_taxi_avg_electric_power_kw,
    }
    drag = {
        "Wing profile": ac.wing_airfoil_cd_at_cruise_cl,
        "Induced": ac.induced_drag_cdi,
        "Fuselage": ac.fuselage_cd0,
        "Horiz. tail": ac.horiz_tail_cd0,
        "Vert. tail": ac.vert_tail_cd0,
        "Landing gear": ac.landing_gear_cd0,
        "Stopped rotor": ac.stopped_rotor_cd0,
    }

    def clean(d: dict[str, Any]) -> dict[str, float | None]:
        return {k: _num(v) for k, v in d.items()}

    primary_total = sum(v or 0.0 for v in clean(primary).values())
    reserve_total = sum(v or 0.0 for v in clean(reserve).values())
    return {
        "masses_kg": {
            "structural": clean(structural),
            "propulsion": clean(propulsion),
            "subsystems": clean(subsystems),
            "battery": _num(ac.battery_mass_kg),
            "payload": _num(ac.payload_kg),
            "empty": _num(ac.empty_mass_kg),
        },
        "energy_kw_hr": {
            "primary": clean(primary),
            "reserve": clean(reserve),
            "primary_total": primary_total,
            "reserve_total": reserve_total,
            "total": primary_total + reserve_total,
        },
        "power_kw": clean(power),
        "aero": {
            "cruise_cl": _num(ac.cruise_cl),
            "cruise_cd": _num(ac.cruise_cd),
            "cruise_l_p_d": _num(ac.cruise_l_p_d),
            "drag": clean(drag),
        },
        "geometry": {
            "wing_area_m2": _num(ac.wing_area_m2),
            "wing_aspect_ratio": _num(ac.wing_aspect_ratio),
            "disk_loading_kg_p_m2": _num(ac.disk_loading_kg_p_m2),
        },
    }


def _render_images(ac: Aircraft, outputs: dict[str, Any], name: str, image_dir: Path) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import pyplot as plt

    from app.viz.AirCraftSketch import visualize_aircraft_layout
    from app.viz.CruiseDragBuildupVisual import visualize_cruise_drag_buildup
    from app.viz.EnergyProfileVisual import visualize_energy_profile
    from app.viz.MassBreakdownVisual import visualize_mass_breakdown
    from app.viz.PowerProfileVisual import visualize_power_profile

    masses = outputs["masses_kg"]
    image_dir.mkdir(parents=True, exist_ok=True)
    plots = {
        "layout": lambda: visualize_aircraft_layout(ac),
        "mass-breakdown": lambda: visualize_mass_breakdown(
            masses["structural"], masses["propulsion"], masses["subsystems"], ac, name=name
        ),
        "power-profile": lambda: visualize_power_profile(ac, name=name),
        "energy-profile": lambda: visualize_energy_profile(ac, name=name),
        "cruise-drag-buildup": lambda: visualize_cruise_drag_buildup(ac, name=name),
    }
    written = []
    for kind, draw in plots.items():
        fig, _ = draw()
        try:
            kwargs = {"bbox_inches": "tight", "pad_inches": 0.5} if kind == "layout" else {}
            fig.savefig(image_dir / f"{kind}.png", dpi=100, **kwargs)
            written.append(kind)
        finally:
            plt.close(fig)
    return written


def size_design(config: dict[str, Any], name: str = "Aircraft", image_dir: str | None = None,
                max_iter: int = 150) -> dict[str, Any]:
    """Size one configuration. Never raises for model failures: the status field
    says what happened, so batch callers can keep going.

    Runs inside a worker process. Writes the config to a private temp file
    because ``Aircraft()`` only accepts a path. ``max_iter`` caps the MTOW
    iteration (evtolpy's default is 150); a design that has not converged by
    then reports ``NotConverged``. Feasibility scans use a lower cap because
    designs near a boundary creep towards the cap and cost far more than the
    ones that close or diverge early.
    """
    result: dict[str, Any] = {"status": "Success", "message": None}
    with tempfile.TemporaryDirectory(prefix="evtol-") as tmp:
        path = os.path.join(tmp, "config.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(config, fh)
        try:
            ac = FastAircraft(path)
            mtow, history = aircraft_iteration._iterate_mtow(ac, max_iter=max_iter)
        except Exception as exc:  # evtolpy raises ValueError for diverging/non-physical designs
            return {"status": type(exc).__name__, "message": str(exc), "mtow_kg": None, "iterations": None}

        converged = bool(history) and abs(history[-1]["delta_kg"]) < 1e-3
        if not converged:
            result["status"] = "NotConverged"
            result["message"] = (
                f"MTOW did not converge in {len(history)} iterations "
                f"(last change {history[-1]['delta_kg']:.3g} kg)."
            )
        result.update({
            "mtow_kg": _num(mtow),
            "iterations": len(history),
            "converged": converged,
            "convergence": [
                {"iteration": h["iteration"], "mtow_guess_kg": _num(h["mtow_guess_kg"]), "delta_kg": _num(h["delta_kg"])}
                for h in history
            ],
        })
        try:
            result.update(_collect_outputs(ac))
        except Exception as exc:
            return {"status": type(exc).__name__, "message": f"Outputs failed after sizing: {exc}",
                    "mtow_kg": result["mtow_kg"], "iterations": result["iterations"]}

        if image_dir is not None:
            result["images"] = _render_images(ac, result, name, Path(image_dir))
    return result


def summary(result: dict[str, Any]) -> dict[str, Any]:
    """The handful of scalar outputs used by sweeps, sensitivity and ensembles."""
    ok = result.get("status") in ("Success", "NotConverged")
    masses = result.get("masses_kg") or {}
    energy = result.get("energy_kw_hr") or {}
    aero = result.get("aero") or {}
    return {
        "status": result.get("status"),
        "message": result.get("message"),
        "mtow_kg": result.get("mtow_kg") if ok else None,
        "empty_mass_kg": masses.get("empty") if ok else None,
        "battery_mass_kg": masses.get("battery") if ok else None,
        "total_energy_kw_hr": energy.get("total") if ok else None,
        "cruise_l_p_d": aero.get("cruise_l_p_d") if ok else None,
        "iterations": result.get("iterations"),
    }


SUMMARY_OUTPUTS = {
    "mtow_kg": {"label": "MTOW", "unit": "kg"},
    "empty_mass_kg": {"label": "Empty mass", "unit": "kg"},
    "battery_mass_kg": {"label": "Battery mass", "unit": "kg"},
    "total_energy_kw_hr": {"label": "Total energy", "unit": "kWh"},
    "cruise_l_p_d": {"label": "Cruise L/D", "unit": ""},
}


def size_summary(config: dict[str, Any], max_iter: int = 150) -> dict[str, Any]:
    """Worker entry point for batch calls: size without images, return scalars."""
    return summary(size_design(config, max_iter=max_iter))
