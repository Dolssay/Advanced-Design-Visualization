import json
import pytest
from pathlib import Path
from app.services.ensemble import ensemble_id
from app.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient


@pytest.fixture
def test_prebuilt_dir(tmp_path):
    prebuilt = tmp_path / "prebuilt"
    ensembles_dir = prebuilt / "ensembles"
    ensembles_dir.mkdir(parents=True)

    dummy_id = "test_prebuilt_001"
    collection = {
        "ensemble_id": dummy_id,
        "baseline": "Archer_Midnight",
        "seed": 0,
        "bounds": None,
        "n_samples": 5,
        "created": "2026-10-19T12:00:00Z",
        "elapsed_s": 1.2,
        "status_counts": {"Success": 4, "ValueError": 1},
        "inputs": [{"key": "payload_kg", "label": "Payload", "unit": "kg", "min": 350, "max": 550, "limit_min": 115, "limit_max": 905}],
        "outputs": {"mtow_kg": {"label": "MTOW", "unit": "kg"}},
        "rows": [
            {"run": 1, "payload_kg": 400.0, "mtow_kg": 3200.0, "status": "Success"},
            {"run": 2, "payload_kg": 420.0, "mtow_kg": 3250.0, "status": "Success"},
            {"run": 3, "payload_kg": 450.0, "mtow_kg": 3300.0, "status": "Success"},
            {"run": 4, "payload_kg": 480.0, "mtow_kg": None, "status": "ValueError"},
            {"run": 5, "payload_kg": 500.0, "mtow_kg": 3400.0, "status": "Success"},
        ],
    }

    (ensembles_dir / f"{dummy_id}.json").write_text(json.dumps(collection), encoding="utf-8")
    index = [{
        "ensemble_id": dummy_id,
        "baseline": "Archer_Midnight",
        "seed": 0,
        "bounds": None,
        "status_counts": {"Success": 4, "ValueError": 1},
        "n_samples": 5,
        "created": "2026-10-19T12:00:00Z",
        "elapsed_s": 1.2,
    }]
    (ensembles_dir / "index.json").write_text(json.dumps(index), encoding="utf-8")
    return prebuilt


@pytest.fixture
def custom_client(test_prebuilt_dir, tmp_path):
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir(parents=True)
    settings = Settings(
        prebuilt_dir=test_prebuilt_dir,
        runs_dir=runs_dir,
        max_ensemble_samples=100,
    )
    app = create_app(settings)
    with TestClient(app) as cl:
        yield cl, settings, test_prebuilt_dir, runs_dir


def test_prebuilt_listing_and_retrieval(custom_client):
    client, settings, prebuilt_dir, runs_dir = custom_client
    # GET /ensembles lists prebuilt
    res = client.get("/api/v1/evtol/ensembles")
    assert res.status_code == 200
    listing = res.json()
    assert len(listing) == 1
    assert listing[0]["ensemble_id"] == "test_prebuilt_001"

    # GET /ensembles/{id} returns collection with normalized status
    res = client.get("/api/v1/evtol/ensembles/test_prebuilt_001")
    assert res.status_code == 200
    coll = res.json()
    assert coll["ensemble_id"] == "test_prebuilt_001"
    assert len(coll["rows"]) == 5
    # Notice status_class normalized "Success" -> "converged" and "ValueError" -> "diverged"
    assert coll["rows"][0]["status"] == "converged"
    assert coll["rows"][3]["status"] == "diverged"
    assert coll["status_counts"]["converged"] == 4
    assert coll["status_counts"]["diverged"] == 1


def test_bounds_validation(custom_client):
    client, _, _, _ = custom_client
    # Payload limits are 115 to 905. 1000 is outside slider limits -> 422
    bad_bounds = client.post("/api/v1/evtol/ensemble", json={
        "baseline": "Archer_Midnight",
        "n_samples": 5,
        "bounds": {"payload_kg": [300, 1000]},
    })
    assert bad_bounds.status_code == 422
    assert bad_bounds.json()["detail"]["code"] == "bounds_out_of_range"

    # Unknown parameter in bounds -> 422
    bad_param = client.post("/api/v1/evtol/ensemble", json={
        "baseline": "Archer_Midnight",
        "n_samples": 5,
        "bounds": {"nonexistent_param": [10, 20]},
    })
    assert bad_param.status_code == 422
    assert bad_param.json()["detail"]["code"] == "invalid_bounds"


def test_identical_post_ensemble_caching(custom_client):
    client, _, _, runs_dir = custom_client
    req = {
        "baseline": "Archer_Midnight",
        "n_samples": 3,
        "seed": 42,
        "bounds": {"payload_kg": [400, 450]},
    }
    res1 = client.post("/api/v1/evtol/ensemble", json=req)
    assert res1.status_code == 200
    data1 = res1.json()
    eid = data1["ensemble_id"]

    # File should exist in RUNS_DIR
    saved_file = runs_dir / "ensembles" / f"{eid}.json"
    assert saved_file.exists()

    # Modify the saved file slightly to verify second call serves from file without recomputing
    content = json.loads(saved_file.read_text())
    content["cached_marker"] = True
    saved_file.write_text(json.dumps(content))

    res2 = client.post("/api/v1/evtol/ensemble", json=req)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2.get("cached_marker") is True


def test_append_to_adds_rows_leaves_prebuilt_untouched(custom_client):
    client, _, prebuilt_dir, runs_dir = custom_client
    prebuilt_file = prebuilt_dir / "ensembles" / "test_prebuilt_001.json"
    orig_prebuilt_mtime = prebuilt_file.stat().st_mtime
    orig_prebuilt_content = prebuilt_file.read_text()

    # Append 3 rows inside bounds
    bounds = {"payload_kg": [420, 460]}
    res = client.post("/api/v1/evtol/ensemble", json={
        "append_to": "test_prebuilt_001",
        "n_samples": 3,
        "bounds": bounds,
    })
    assert res.status_code == 200
    append_data = res.json()
    assert append_data["ensemble_id"] == "test_prebuilt_001"
    assert append_data["n_total"] == 8
    assert len(append_data["rows"]) == 3
    assert append_data["batch"] == 1
    # Verify new rows have continuous run numbers: 6, 7, 8
    runs = [r["run"] for r in append_data["rows"]]
    assert runs == [6, 7, 8]
    for r in append_data["rows"]:
        assert r["batch"] == 1
        assert 420 <= r["payload_kg"] <= 460

    # Verify prebuilt file was untouched (copy-on-write)
    assert prebuilt_file.stat().st_mtime == orig_prebuilt_mtime
    assert prebuilt_file.read_text() == orig_prebuilt_content

    # Verify RUNS_DIR copy now exists and has 8 rows
    runs_file = runs_dir / "ensembles" / "test_prebuilt_001.json"
    assert runs_file.exists()
    merged_data = json.loads(runs_file.read_text())
    assert len(merged_data["rows"]) == 8

    # GET /ensembles/{id} now returns the merged 8-row collection from RUNS_DIR
    res_get = client.get("/api/v1/evtol/ensembles/test_prebuilt_001")
    assert res_get.status_code == 200
    assert len(res_get.json()["rows"]) == 8
