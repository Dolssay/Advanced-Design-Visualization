import json

import pytest

from tests.conftest import ARCHER_MTOW_KG, DIVERGING_DESIGN


def _ndjson(response):
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def test_probes(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").json() == {"status": "ready"}


def test_info_lists_routes(client):
    body = client.get("/api/v1/info").json()
    assert body["ready"] is True
    assert "Archer_Midnight" in body["baselines"]
    assert {"method": "POST", "path": "/api/v1/evtol/size"} in body["routes"]


def test_baselines(client):
    listing = client.get("/api/v1/evtol/baselines").json()["baselines"]
    names = [b["name"] for b in listing]
    assert {"Archer_Midnight", "Joby_s4", "NASA_LC", "NASA_TR", "Wisk", "ehang"} <= set(names)
    archer = next(b for b in listing if b["name"] == "Archer_Midnight")
    assert archer["design"]["payload_kg"] == 453.0
    assert archer["rotors"] == {"lift_rotor_count": 6, "tilt_rotor_count": 6, "rotor_count": 12}
    assert client.get("/api/v1/evtol/baselines/Joby_s4").json()["aircraft"]
    assert client.get("/api/v1/evtol/baselines/nope").status_code == 404


def test_parameters(client):
    body = client.get("/api/v1/evtol/parameters").json()
    keys = [p["key"] for p in body["parameters"]]
    assert "batt_spec_energy_w_h_p_kg" in keys
    assert "mtow_kg" in body["outputs"]
    assert "layout" in body["images"]


def test_size_then_cache_then_images(client):
    first = client.post("/api/v1/evtol/size", json={"baseline": "Archer_Midnight", "overrides": {}})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["cached"] is False
    assert body["result"]["mtow_kg"] == pytest.approx(ARCHER_MTOW_KG, abs=0.1)
    assert len(body["images"]) == 5

    again = client.post("/api/v1/evtol/size", json={"baseline": "Archer_Midnight"}).json()
    assert again["cached"] is True and again["run_id"] == body["run_id"]

    assert client.get(f"/api/v1/evtol/runs/{body['run_id']}").json()["run_id"] == body["run_id"]
    image = client.get(body["images"][0]["url"])
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_size_errors(client):
    bad = client.post("/api/v1/evtol/size", json={"overrides": {"payload_kg": 9000}})
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "invalid_overrides"

    failed = client.post("/api/v1/evtol/size", json={"overrides": DIVERGING_DESIGN})
    assert failed.status_code == 422
    assert failed.json()["detail"]["code"] == "sizing_failed"

    assert client.post("/api/v1/evtol/size", json={"baseline": "nope"}).status_code == 404
    assert client.get("/api/v1/evtol/runs/0123456789abcdef").status_code == 404
    assert client.get("/api/v1/evtol/runs/../../etc/images/layout.png").status_code == 404


def test_size_accepts_slider_range(client):
    """Values outside the study box but inside limit_min/limit_max are no longer 422 invalid_overrides."""
    wide = client.post("/api/v1/evtol/size", json={"overrides": {"payload_kg": 905}})
    assert wide.status_code in (200, 422)
    if wide.status_code == 422:
        assert wide.json()["detail"]["code"] == "sizing_failed"


def test_sweep(client):
    body = client.post("/api/v1/evtol/sweep", json={
        "parameter": "batt_spec_energy_w_h_p_kg", "start": 240, "stop": 300, "step": 5,
    }).json()
    values = [p["value"] for p in body["points"]]
    assert values == list(range(240, 301, 5))
    mtows = [p["mtow_kg"] for p in body["points"]]
    assert all(m is not None for m in mtows)
    assert mtows == sorted(mtows, reverse=True)  # better batteries -> lighter aircraft


def test_sweep_limits(client):
    too_many = client.post("/api/v1/evtol/sweep", json={"parameter": "payload_kg", "step": 0.5})
    assert too_many.status_code == 422
    assert too_many.json()["detail"]["code"] == "too_many_points"
    assert client.post("/api/v1/evtol/sweep", json={"parameter": "nope"}).status_code == 422


def test_sensitivity(client):
    body = client.post("/api/v1/evtol/sensitivity", json={"delta_pct": 5}).json()
    assert body["base"]["mtow_kg"] == pytest.approx(ARCHER_MTOW_KG, abs=0.1)
    payload = next(r for r in body["rows"] if r["key"] == "payload_kg")
    assert payload["low"]["mtow_kg"] < body["base"]["mtow_kg"] < payload["high"]["mtow_kg"]
    rotors = next(r for r in body["rows"] if r["key"] == "lift_rotor_count")
    assert (rotors["low_value"], rotors["high_value"]) == (5, 7)


def test_ensemble(client):
    body = client.post("/api/v1/evtol/ensemble", json={"n_samples": 6, "seed": 1}).json()
    assert len(body["rows"]) == 6
    assert sum(body["status_counts"].values()) == 6
    assert client.post("/api/v1/evtol/ensemble", json={"n_samples": 100000}).status_code == 422


def test_feasibility_streams_one_line_per_parameter(client):
    lines = _ndjson(client.post("/api/v1/evtol/feasibility", json={
        "priority": ["batt_spec_energy_w_h_p_kg"], "resolution": 7, "refine": 2,
    }))
    done = lines.pop()
    assert done["done"] is True and done["n_runs"] > 0 and done["cached"] == 0
    assert len(lines) == 12
    assert lines[0]["param"] == "batt_spec_energy_w_h_p_kg"
    for line in lines:
        assert line["limit"][0] <= line["current"] <= line["limit"][1]
        assert any(lo <= line["current"] <= hi for lo, hi in line["feasible"]), line["param"]
        assert line["segments"][0]["lo"] == line["limit"][0] and line["segments"][-1]["hi"] == line["limit"][1]
        for a, b in zip(line["segments"], line["segments"][1:]):
            assert a["hi"] == b["lo"]
    battery = lines[0]
    assert battery["constraint"] == []
    assert {s["status"] for s in battery["segments"]} >= {"converged"}
    assert battery["feasible"][-1][1] == 510
    wingspan = next(l for l in lines if l["param"] == "wingspan_m")
    assert [b["id"] for b in wingspan["constraint"]] == ["C1", "C6"]
    assert wingspan["segments"][0]["status"] == "constraint" and wingspan["segments"][-1]["status"] == "constraint"


def test_feasibility_second_identical_request_is_fully_cached(client):
    body = {"priority": ["batt_spec_energy_w_h_p_kg"], "resolution": 7, "refine": 2}
    first = _ndjson(client.post("/api/v1/evtol/feasibility", json=body))
    again = _ndjson(client.post("/api/v1/evtol/feasibility", json=body))
    assert again[-1]["cached"] == 12 and again[-1]["n_runs"] == 0 and again[-1]["elapsed_s"] < 0.2
    assert {l["param"]: l["segments"] for l in again[:-1]} == {l["param"]: l["segments"] for l in first[:-1]}

    # Dragging the battery slider leaves the battery slice valid and only the other 11 go stale.
    moved = _ndjson(client.post("/api/v1/evtol/feasibility", json={
        **body, "overrides": {"batt_spec_energy_w_h_p_kg": 300}, "parameters": ["batt_spec_energy_w_h_p_kg", "payload_kg"],
    }))
    assert moved[-1]["cached"] == 1
    assert moved[0]["param"] == "batt_spec_energy_w_h_p_kg" and moved[0]["current"] == 300


def test_feasibility_empty_constraint_intersection_sizes_nothing(client):
    lines = _ndjson(client.post("/api/v1/evtol/feasibility", json={
        "overrides": {"lift_rotor_count": 12, "wingspan_m": 3.8}, "parameters": ["rotor_diameter_m"],
    }))
    done = lines.pop()
    assert done["n_runs"] == 0
    (line,) = lines
    assert line["feasible"] == [] and line["points"] == []
    assert [s["status"] for s in line["segments"]] == ["constraint"]
    assert line["segments"][0]["reason"].startswith("C6:")
    assert [line["segments"][0]["lo"], line["segments"][0]["hi"]] == line["limit"]


def test_feasibility_errors_before_streaming(client):
    assert client.post("/api/v1/evtol/feasibility", json={"parameters": ["nope"]}).status_code == 422
    bad = client.post("/api/v1/evtol/feasibility", json={"overrides": {"payload_kg": 9000}})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_overrides"
    assert client.post("/api/v1/evtol/feasibility", json={"baseline": "nope"}).status_code == 404
    assert client.post("/api/v1/evtol/feasibility", json={"resolution": 1}).status_code == 422
