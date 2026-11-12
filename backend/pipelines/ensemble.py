"""Generate an LHS ensemble of eVTOL designs for the GLEE viewer (batch mode).

Run from backend/:
    python -m pipelines.ensemble --n 200 --seed 0

Writes, under --out (default output/GLEEinput):
    lhs_uav_samples.csv            the sampled inputs
    ensemble_data/GLEEdata.csv     one row per run, inputs + masses + energies + MTOW + status
    ensemble_data/<run>_<plot>.png five plots per successful run (skip with --no-images)

Uses the same sizing code as the API (app.services.evtol_model), which fixes three
problems in the old EnsembleDataScript.py:
  * masses and energies are read after the MTOW iteration, not at the initial guess;
  * a failed run no longer draws the previous run's plots;
  * each run gets a private temp config file instead of a shared one.
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pandas as pd

from app.services.evtol_model import apply_overrides, load_catalogue, size_design
from pipelines.lhs import NAMES, lhs_repair

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Plot file suffixes GLEE expects (<run>_<suffix>.png), keyed by the API's image kinds.
GLEE_IMAGE_NAMES = {
    "layout": "aircraftlayout",  # GLEE looks up "Aircraft Layout" as <run>_aircraftlayout.png
    "mass-breakdown": "massbreakdown",
    "power-profile": "powerprofile",
    "energy-profile": "energyprofile",
    "cruise-drag-buildup": "cruisedragbuildup",
}

# CSV column -> JSON key, same headers as the old script so GLEE keeps working.
INPUT_COLUMNS = {
    "Payload (kg)": "payload_kg",
    "Wingspan (m)": "wingspan_m",
    "D-Value (m)": "d_value_m",
    "Fuselage Length (m)": "fuselage_l_m",
    "Fuselage Width (m)": "fuselage_w_m",
    "Horizontal Tail Volume Coefficient": "horiz_tail_vol_coeff",
    "Vertical Tail Volume Coefficient": "vert_tail_vol_coeff",
    "Cruise Speed (m/s)": "cruise_s",  # historical header: the value is cruise TIME in s
    "Reserve Cruise Speed (m/s)": "reserve_cruise_s",  # historical header: reserve cruise TIME in s
    "Battery Specific Energy (W-h/kg)": "batt_spec_energy_w_h_p_kg",
    "Lift Rotor Count": "lift_rotor_count",
    "Tilt Rotor Count": "tilt_rotor_count",
    "Rotor Diameter (m)": "rotor_diameter_m",
    "Rotor Count": "rotor_count",
}


def _size_one(args: tuple[int, dict, str, str | None]) -> dict:
    idx, config, name, image_root = args
    image_dir = None if image_root is None else tempfile.mkdtemp(prefix=f"run{idx}-", dir=image_root)
    result = size_design(config, name=name, image_dir=image_dir)
    result["_image_dir"] = image_dir
    return result


def _row(idx: int, sample: dict, result: dict) -> dict:
    row = {"cell": f"run_{idx}", **sample}
    if result["status"] in ("Success", "NotConverged"):
        masses = result["masses_kg"]
        for group in ("structural", "propulsion", "subsystems"):
            row.update(masses[group])
        energy = result["energy_kw_hr"]
        row.update({f"{k} (kW-hr)": v for k, v in energy["primary"].items()})
        row["Primary Total (kW-hr)"] = energy["primary_total"]
        row["Reserve Total (kW-hr)"] = energy["reserve_total"]
        row["Total Energy (kW-hr)"] = energy["total"]
    row["MTOW (kg)"] = result.get("mtow_kg")
    row["Iterations"] = result.get("iterations")
    row["Status"] = "Success" if result["status"] == "Success" else result["status"]
    row["image"] = f"{idx}_{GLEE_IMAGE_NAMES['layout']}.png"  # default picture before a chart is picked
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=200, help="Number of LHS samples")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--baseline", default=str(BACKEND_DIR / "data" / "baselines" / "Archer_Midnight.json"))
    parser.add_argument("--out", default="output/GLEEinput")
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--no-images", action="store_true")
    args = parser.parse_args()

    out = Path(args.out)
    ensemble_dir = out / "ensemble_data"
    ensemble_dir.mkdir(parents=True, exist_ok=True)

    with open(args.baseline, encoding="utf-8") as fh:
        baseline = json.load(fh)
    name = Path(args.baseline).stem.replace("_", " ")
    catalogue = load_catalogue()
    catalogue_keys = {p["key"] for p in catalogue["parameters"]}

    raw = lhs_repair(n_samples=args.n, seed=args.seed)
    samples_df = pd.DataFrame(raw, columns=NAMES + ["rotor_count"])
    for col in ("rotor_count", "lift_rotor_count", "tilt_rotor_count"):
        samples_df[col] = samples_df[col].astype(int)
    samples_df = samples_df.round(4)
    by_header = samples_df.rename(columns={v: k for k, v in INPUT_COLUMNS.items()})[list(INPUT_COLUMNS)]
    by_header.to_csv(out / "lhs_uav_samples.csv", index=False)

    jobs = []
    for i, rec in enumerate(samples_df.to_dict(orient="records"), start=1):
        overrides = {k: v for k, v in rec.items() if k in catalogue_keys}
        config = apply_overrides(baseline, overrides, catalogue, enforce_bounds=False)
        jobs.append((i, config, name, None if args.no_images else str(ensemble_dir)))

    rows = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for (i, _, _, _), result, sample in zip(jobs, pool.map(_size_one, jobs), by_header.to_dict(orient="records")):
            if result["status"] not in ("Success", "NotConverged"):
                print(f"Sample {i}: {result['status']} - {result['message']}")
            image_dir = result.pop("_image_dir")
            if image_dir:
                for png in Path(image_dir).glob("*.png"):
                    shutil.move(str(png), ensemble_dir / f"{i}_{GLEE_IMAGE_NAMES[png.stem]}.png")
                shutil.rmtree(image_dir, ignore_errors=True)
            rows.append(_row(i, sample, result))

    if rows:
        rows[0]["charts"] = "Aircraft Layout;Mass Breakdown;Power Profile;Energy Profile;Cruise Drag Buildup"
    pd.DataFrame(rows).to_csv(ensemble_dir / "GLEEdata.csv", index=False)
    ok = sum(r["Status"] == "Success" for r in rows)
    print(f"Sized {len(rows)} designs ({ok} converged) -> {ensemble_dir / 'GLEEdata.csv'}")


if __name__ == "__main__":
    main()
