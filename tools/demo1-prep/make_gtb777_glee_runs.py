"""Build GLEE Image-page input for GTB777: a sample of designs, their attributes and
one certification-margin picture per design.

    python tools/demo1-prep/make_gtb777_glee_runs.py

writes output/GLEEinputs/GTB777_runs/ensemble_data/ (GLEEdata.csv, the pictures and a
copy of make_glee_zip.py), mirroring evtol_runs/. Then, from that folder:

    python make_glee_zip.py --status-pass Feasible                 # GTB777_feasible.zip
    python make_glee_zip.py --status-pass Feasible --keep-failed   # GTB777_all_runs.zip

(--zip runs both for you.) The sample is stratified: the same number of designs from
each feasibility label (fewer where a label has fewer), with a fixed seed, so the two
zips share their feasible designs. Run ids are the MonteCarlo.csv row number, as in
Demo 1.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from cert_requirements import load_requirements, margins, native_values, passes  # noqa: E402
from filterGTB777 import compute_label  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
LABELS = ["Infeasible", "Level 2-2", "Level 2-1", "Level 1-1"]
DESIGN_COLUMNS = ["ARHT", "TRHT", "TCHT", "SWPHT (deg)", "SHT (sqft)", "ETAIE", "ETAOE", "CRE"]
OUTPUT_COLUMNS = ["OEW (1000 lbm)", "Block Fuel (1000 lbm)", "Cruise CD (count)"]
FLAG_COLUMNS = ["Range", "RoD TD", "dr", "Takeoff (2,2)", "Takeoff (2,5)"]
CHART = "Certification Margins"  # GLEE's Visualization name; file <run>_certificationmargins.png
MARGIN_CAP = 50  # picture scale stops at +/-50%; the exact value is printed past it
INK, MUTED, GRID, DANGER = "#141414", "#5f5f5b", "#e9e9e6", "#a3271d"


def glee_name(requirement):
    """Attribute name GLEE can carry: ASCII and no commas (GLEE splits its header and
    writes saved states on commas), e.g. "Margin 25.181 zeta 2-2"."""
    short = requirement["short"].replace("§", "").replace("ζ", "zeta")
    short = short.replace("(", " ").replace(")", " ").replace(",", "-")
    return "Margin " + " ".join(short.split())


def stratified_sample(df, n, seed):
    """Equal share per label; a label with fewer designs gives its spare share to the rest."""
    groups = {label: df.index[df["Label"] == label] for label in LABELS}
    take = {label: 0 for label in LABELS}
    left = n
    open_labels = [label for label in LABELS if len(groups[label])]
    while left > 0 and open_labels:
        share = max(1, left // len(open_labels))
        for label in list(open_labels):
            add = min(share, len(groups[label]) - take[label], left)
            take[label] += add
            left -= add
            if take[label] == len(groups[label]):
                open_labels.remove(label)
            if left == 0:
                break
    picked = [df.loc[groups[label]].sample(take[label], random_state=seed).index for label in LABELS]
    return df.loc[sorted(set().union(*picked))], take


def draw_picture(path, run, label, oew, fuel, margin_row, pass_row, requirements):
    fig, ax = plt.subplots(figsize=(6, 4), dpi=100)
    fig.subplots_adjust(left=0.27, right=0.86, top=0.82, bottom=0.1)
    names = [r["short"] for r in requirements]
    values = [margin_row[r["column"]] for r in requirements]
    y = list(range(len(names)))[::-1]
    for t in (-50, -25, 25, 50):
        ax.axvline(t, color=GRID, linewidth=1, zorder=0)
    ax.axvline(0, color=INK, linewidth=1.5, zorder=3)
    for yi, v, r in zip(y, values, requirements):
        fail = not pass_row[r["column"]]
        shown = max(-MARGIN_CAP, min(MARGIN_CAP, v))
        ax.barh(yi, shown, height=0.55, color=DANGER if fail else INK, zorder=2)
        unit = " pts" if r["limit"] == 0 else "%"
        text = ("+" if v > 0 else "−" if v < 0 else "") + f"{abs(v):.1f}{unit}"
        ax.text(shown + (1.5 if v >= 0 else -1.5), yi, text, va="center", ha="left" if v >= 0 else "right",
                fontsize=8, color=DANGER if fail else MUTED, fontweight="bold" if fail else "normal")
    ax.set_yticks(y, names, fontsize=8.5, color=INK)
    ax.set_xlim(-MARGIN_CAP, MARGIN_CAP)
    ax.set_xticks([-50, -25, 0, 25, 50], ["−50%", "−25%", "0", "+25%", "+50%"], fontsize=8, color=MUTED)
    ax.tick_params(length=0)
    for side in ax.spines.values():
        side.set_visible(False)
    fig.text(0.03, 0.93, f"Run {run} · {label}", fontsize=13, fontweight="bold", color=INK)
    fig.text(0.03, 0.87, f"OEW {oew:.1f}k lbm · block fuel {fuel:.1f}k lbm · margin to each Part 25 limit",
             fontsize=8.5, color=MUTED)
    fig.savefig(path, facecolor="white")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--input", default=str(REPO / "data" / "MonteCarlo.csv"))
    parser.add_argument("--out", default=str(REPO / "output" / "GLEEinputs" / "GTB777_runs"))
    parser.add_argument("--n", type=int, default=300, help="designs in the sample (default 300)")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--zip", action="store_true", help="also build GTB777_feasible.zip and GTB777_all_runs.zip")
    args = parser.parse_args()

    df = pd.read_csv(args.input, low_memory=False)
    df["Label"] = df[FLAG_COLUMNS].apply(compute_label, axis=1)
    requirements = load_requirements()
    values = native_values(df, requirements)
    margin = margins(values, requirements)
    ok = passes(values, requirements)

    sample, counts = stratified_sample(df, args.n, args.seed)
    folder = Path(args.out) / "ensemble_data"
    if folder.exists():
        for old in folder.glob("*_certificationmargins.png"):
            old.unlink()
    folder.mkdir(parents=True, exist_ok=True)

    rows = []
    for i in sample.index:
        run = i + 1  # MonteCarlo.csv row number; Demo 1's __rowId is i
        label = sample.at[i, "Label"]
        picture = f"{run}_certificationmargins.png"
        draw_picture(folder / picture, run, label, sample.at[i, "OEW (1000 lbm)"],
                     sample.at[i, "Block Fuel (1000 lbm)"], margin.loc[i], ok.loc[i], requirements)
        row = {"Cell": f"run_{run}"}
        row.update({c: sample.at[i, c] for c in DESIGN_COLUMNS + OUTPUT_COLUMNS})
        row.update({glee_name(r): round(float(margin.at[i, r["column"]]), 4) for r in requirements})
        row["Status"] = "Infeasible" if label == "Infeasible" else "Feasible"
        row["image"] = picture
        row["charts"] = CHART if not rows else ""
        rows.append(row)

    table = pd.DataFrame(rows)
    assert all(name.isascii() and "," not in name for name in table.columns)
    assert len(table) == sum(counts.values()) == min(args.n, len(df))
    assert table["Cell"].is_unique
    table.to_csv(folder / "GLEEdata.csv", index=False)

    zip_script = REPO / "output" / "GLEEinputs" / "evtol_runs" / "ensemble_data" / "make_glee_zip.py"
    if zip_script.exists():
        shutil.copy2(zip_script, folder / "make_glee_zip.py")
    print(f"Wrote {len(table)} designs to {folder}: " + ", ".join(f"{k} {v}" for k, v in counts.items()))

    if args.zip:
        for extra in ([], ["--keep-failed"]):
            subprocess.run([sys.executable, str(folder / "make_glee_zip.py"), "--folder", str(folder),
                            "--status-pass", "Feasible", "--aircraft", "GTB777", *extra], check=True)


if __name__ == "__main__":
    main()
