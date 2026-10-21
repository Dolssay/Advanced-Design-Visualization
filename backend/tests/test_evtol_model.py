import json
import os
import tempfile

import pytest
from evtol.aircraft import Aircraft

from app.services.evtol_model import (
    BACKEND_DIR,
    FastAircraft,
    OverrideError,
    apply_overrides,
    check_constraints,
    constraint_interval,
    effective_range,
    load_catalogue,
    size_design,
    status_class,
)
from app.services.feasibility import allowed_range
from tests.conftest import ARCHER_MTOW_KG, DIVERGING_DESIGN

ARCHER = BACKEND_DIR / "data" / "baselines" / "Archer_Midnight.json"


@pytest.fixture(scope="module")
def baseline():
    with open(ARCHER, encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture(scope="module")
def catalogue():
    return load_catalogue()


def test_fast_aircraft_matches_upstream_exactly():
    """The read-only accessors must not change a single number (upstream run takes ~11 s)."""
    slow, fast = Aircraft(str(ARCHER)), FastAircraft(str(ARCHER))
    m_slow, h_slow = slow._iterate_mtow()
    m_fast, h_fast = fast._iterate_mtow()
    assert m_slow == m_fast
    assert h_slow == h_fast
    for name in ("empty_mass_kg", "battery_mass_kg", "wing_mass_kg", "cruise_cd", "cruise_l_p_d",
                 "total_mission_energy_kw_hr", "hover_climb_avg_electric_power_kw", "disk_loading_kg_p_m2"):
        assert getattr(slow, name) == getattr(fast, name), name


def test_archer_baseline_regression(baseline):
    result = size_design(baseline)
    assert result["status"] == "Success"
    assert result["mtow_kg"] == pytest.approx(ARCHER_MTOW_KG, abs=0.1)
    assert result["energy_kw_hr"]["total"] > result["energy_kw_hr"]["primary_total"] > 0


def test_images_are_written(baseline):
    with tempfile.TemporaryDirectory() as tmp:
        result = size_design(baseline, "Archer Midnight", tmp)
        assert len(result["images"]) == 5
        assert sorted(result["images"]) == sorted(f.removesuffix(".png") for f in os.listdir(tmp))


def test_diverging_design_reports_status_instead_of_raising(baseline, catalogue):
    result = size_design(apply_overrides(baseline, DIVERGING_DESIGN, catalogue))
    assert result["status"] == "ValueError"
    assert "diverg" in result["message"]


def test_rotor_coupling(baseline, catalogue):
    config = apply_overrides(baseline, {"lift_rotor_count": 5}, catalogue)
    assert config["propulsion"]["tilt_rotor_count"] == 5
    assert config["propulsion"]["rotor_count"] == 10
    assert baseline["propulsion"]["lift_rotor_count"] == 6  # input untouched


@pytest.mark.parametrize(
    "overrides, key",
    [({"payload_kg": 9000}, "payload_kg"), ({"nope": 1}, "nope"), ({"lift_rotor_count": 5.5}, "lift_rotor_count")],
)
def test_bad_overrides(baseline, catalogue, overrides, key):
    with pytest.raises(OverrideError) as info:
        apply_overrides(baseline, overrides, catalogue)
    assert info.value.errors[0]["key"] == key


def test_bounds_can_be_skipped(baseline, catalogue):
    config = apply_overrides(baseline, {"payload_kg": 600}, catalogue, enforce_bounds=False)
    assert config["aircraft"]["payload_kg"] == 600


def test_constraints(baseline, catalogue):
    assert check_constraints(baseline) == []
    config = apply_overrides(baseline, {"wingspan_m": 16, "d_value_m": 15}, catalogue)
    assert [w["id"] for w in check_constraints(config)] == ["C1"]


def test_study_box_inside_slider_range_and_limit_ends_accepted(baseline, catalogue):
    for spec in catalogue["parameters"]:
        assert spec["limit_min"] <= spec["min"] <= spec["max"] <= spec["limit_max"], spec["key"]
        for end in (spec["limit_min"], spec["limit_max"]):
            config = apply_overrides(baseline, {spec["key"]: end}, catalogue)
            assert config[spec["section"]][spec["key"]] == end
    with pytest.raises(OverrideError):
        apply_overrides(baseline, {"payload_kg": 906}, catalogue)


def test_effective_range_widens_to_the_baselines_value(catalogue):
    with open(BACKEND_DIR / "data" / "baselines" / "NASA_TR.json", encoding="utf-8") as fh:
        nasa_tr = json.load(fh)
    index = {p["key"]: p for p in catalogue["parameters"]}
    assert effective_range(index["reserve_cruise_s"], 1200) == (30, 1200)
    assert effective_range(index["batt_spec_energy_w_h_p_kg"], 650) == (65, 650)
    config = apply_overrides(nasa_tr, {"reserve_cruise_s": 1200, "batt_spec_energy_w_h_p_kg": 650}, catalogue)
    assert config["mission"]["reserve_cruise_s"] == 1200


def test_wingspan_constraint_interval_is_the_c1_c6_closed_form(baseline):
    ac, prop = baseline["aircraft"], baseline["propulsion"]
    n, d = prop["lift_rotor_count"], prop["rotor_diameter_m"]
    bounds = {b["id"]: b for b in constraint_interval(baseline, "wingspan_m")}
    assert bounds["C1"]["hi"] == ac["d_value_m"] and bounds["C1"]["lo"] is None
    assert bounds["C6"]["lo"] == pytest.approx(d * n + (n - 2) * 0.1) and bounds["C6"]["hi"] is None
    assert constraint_interval(baseline, "payload_kg") == []


def test_constraints_can_leave_no_allowed_value(baseline, catalogue):
    config = apply_overrides(baseline, {"lift_rotor_count": 12, "wingspan_m": 3.8}, catalogue)
    spec = next(p for p in catalogue["parameters"] if p["key"] == "rotor_diameter_m")
    limit = effective_range(spec, baseline["propulsion"]["rotor_diameter_m"])
    assert allowed_range(limit, constraint_interval(config, "rotor_diameter_m")) is None


def test_max_iter_caps_the_iteration(baseline):
    result = size_design(baseline, max_iter=5)
    assert result["status"] == "NotConverged" and result["iterations"] == 5
    assert status_class(result["status"]) == "max_iter"
    assert [status_class(s) for s in ("Success", "ValueError", "KeyError", None)] == ["converged", "diverged", "error", "error"]
