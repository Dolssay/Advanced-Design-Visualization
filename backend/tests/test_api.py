import pytest

from tests.conftest import ARCHER_MTOW_KG, DIVERGING_DESIGN


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


def test_sweep(client):
    body = client.post("/api/v1/evtol/sweep", json={
        "parameter": "batt_spec_energy_w_h_p_kg", "start": 230, "stop": 285, "step": 5,
    }).json()
    values = [p["value"] for p in body["points"]]
    assert values == list(range(230, 286, 5))
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
