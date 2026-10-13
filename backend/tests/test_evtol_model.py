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
    load_catalogue,
    size_design,
)
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
