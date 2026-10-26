from app.services.screening import run_screening


def _catalogue():
    names = ["x1", "x2", "x3", "x4", "x5"]
    return {
        "parameters": [
            {
                "key": name,
                "label": name,
                "unit": "",
                "group": "Test",
                "min": 0,
                "max": 1,
                "integer": False,
            }
            for name in names
        ]
    }


def test_morris_effects_capture_importance_nonlinearity_and_interaction():
    def analytic(point):
        x1, x2, x3, x4, x5 = (point[f"x{i}"] for i in range(1, 6))
        return {"status": "Success", "y": 10 * x1 + x2**2 + x3 * x4}

    result = run_screening(_catalogue(), analytic, r=20, seed=0, outputs=["y"])
    stats = {item["param"]: item for item in result["results"]["y"]}

    assert stats["x5"]["mu_star"] == 0
    assert stats["x1"]["sigma"] < 1e-10
    assert stats["x3"]["sigma"] > 0
    assert stats["x4"]["sigma"] > 0
    assert all(item["mu_star_conf"] is not None for item in stats.values())
    assert result["stability"]["y"]["agreement"] >= 0


def test_failed_solver_points_drop_only_adjacent_effects():
    def fake_solver(point):
        if point["x1"] > 0.9:
            return {"status": "Failed", "y": None}
        return {"status": "Success", "y": sum(point.values())}

    result = run_screening(_catalogue(), fake_solver, r=20, seed=2, outputs=["y"])
    stats = {item["param"]: item for item in result["results"]["y"]}

    assert result["n_failed"] > 0
    assert all(item["n_effects"] > 0 for item in stats.values())
    assert any(item["n_failed"] > 0 for item in stats.values())
    assert sum(item["n_effects"] for item in stats.values()) < 20 * 5
    assert sum(item["n_effects"] + item["n_failed"] for item in stats.values()) == 20 * 5
