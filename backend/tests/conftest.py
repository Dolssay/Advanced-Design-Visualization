import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

ARCHER_MTOW_KG = 3255.6  # regression value for the vendored evtolpy; update when the pin moves

DIVERGING_DESIGN = {
    "payload_kg": 550,
    "batt_spec_energy_w_h_p_kg": 240,
    "cruise_s": 2100,
    "wingspan_m": 13,
    "lift_rotor_count": 7,
    "rotor_diameter_m": 2.3,
}


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    settings = Settings(runs_dir=tmp_path_factory.mktemp("runs"), sizing_workers=2, allowed_origins=[])
    with TestClient(create_app(settings)) as test_client:
        yield test_client
