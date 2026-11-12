"""Zip a GLEE ensemble_data folder (GLEEdata.csv + pictures) for Image GLEE's
"Upload Data Zip".

    python make_glee_zip.py --status-pass Feasible                 # <aircraft>_feasible.zip
    python make_glee_zip.py --status-pass Feasible --keep-failed   # <aircraft>_all_runs.zip

GLEE uses every column between Cell and image as a numeric attribute, so the text
Status column can't go in as is. Without --keep-failed only passing runs are kept and
Status is dropped (it would be constant). With --keep-failed every run is kept and
Status becomes 1 (pass) / 0 (fail). The zip holds one folder, as GLEE expects, and is
written next to the ensemble_data folder.
"""

import argparse
import zipfile
from pathlib import Path

import pandas as pd


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--folder", default=str(Path(__file__).resolve().parent),
                        help="ensemble_data folder (default: this script's folder)")
    parser.add_argument("--status-pass", required=True, help="Status value that counts as passing")
    parser.add_argument("--keep-failed", action="store_true", help="keep failing runs, Status as 1/0")
    parser.add_argument("--aircraft", help="zip name prefix (default: from <name>_runs)")
    args = parser.parse_args()

    folder = Path(args.folder)
    table = pd.read_csv(folder / "GLEEdata.csv")
    charts = table["charts"].dropna().iloc[0] if "charts" in table else None
    passed = table["Status"] == args.status_pass
    if args.keep_failed:
        table["Status"] = passed.astype(int)
    else:
        table = table[passed].drop(columns="Status").reset_index(drop=True)
    if charts is not None:  # GLEE reads the chart names from the first row only
        table["charts"] = ""
        table.loc[0, "charts"] = charts
    if len(table) <= 2:
        raise SystemExit(f"Only {len(table)} runs left; GLEE needs at least 3.")

    aircraft = args.aircraft or folder.resolve().parent.name.split("_")[0]
    name = f"{aircraft}_{'all_runs' if args.keep_failed else 'feasible'}"
    out = folder.parent / f"{name}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{name}/GLEEdata.csv", table.to_csv(index=False))
        # every chart picture of the run (<id>_<chart>.png), not only the default one in "image"
        for cell in table["Cell"]:
            for picture in sorted(folder.glob(f"{cell.split('_')[1]}_*.png")):
                z.write(picture, f"{name}/{picture.name}")
    print(f"Wrote {out} ({len(table)} runs)")


if __name__ == "__main__":
    main()
