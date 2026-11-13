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
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from cert_requirements import load_requirements, margins, native_values, passes  # noqa: E402
from filterGTB777 import compute_label  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
LABELS = ["Infeasible", "Level 2-2", "Level 2-1", "Level 1-1"]
DESIGN_COLUMNS = ["ARHT", "TRHT", "TCHT", "SWPHT (deg)", "SHT (sqft)", "ETAIE", "ETAOE", "CRE"]
OUTPUT_COLUMNS = ["OEW (1000 lbm)", "Block Fuel (1000 lbm)", "Cruise CD (count)"]
FLAG_COLUMNS = ["Range", "RoD TD", "dr", "Takeoff (2,2)", "Takeoff (2,5)"]
# GLEE's Visualization dropdown; each name loads <run>_<name lowercased, no spaces>.png
CHARTS = ["Certification Margins", "HT Sketch", "Input Radar"]
MARGIN_CAP = 50  # picture scale stops at +/-50%; the exact value is printed past it
INK, MUTED, GRID, DANGER = "#141414", "#5f5f5b", "#e9e9e6", "#a3271d"
# Demo 1's label colors (frontend/shared/tokens.css, light theme)
LABEL_COLORS = {"Infeasible": "#b0b0b0", "Level 2-2": "#d62728", "Level 2-1": "#000000", "Level 1-1": "#4a90e2"}
# Boeing 777 horizontal tail and the DOE range per input (Demo 1's tornadoPlot.js)
RADAR_AXES = [  # column, axis label, min, 777 baseline, max
    ("ARHT", "ARHT", 3.70, 4.62, 5.54),
    ("TRHT", "TRHT", 0.26, 0.33, 0.40),
    ("TCHT", "TCHT", 0.071, 0.088, 0.106),
    ("SWPHT (deg)", "SWPHT (deg)", 27.86, 34.82, 41.78),
    ("SHT (sqft)", "SHT (sqft)", 895.4, 1119, 1343),
    ("ETAIE", "ETAEI", 0, 0, 0.20),
    ("ETAOE", "ETAEO", 0.80, 0.93, 1.00),
    ("CRE", "CRE", 0.233, 0.291, 0.350),
]
BASELINE_GREEN = "#7cc47f"


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


def chart_file(run, chart):
    return f"{run}_{chart.lower().replace(' ', '')}.png"


def draw_title(fig, run, label, subtitle):
    """'Run N · <label>', the label in its Demo 1 color, then a muted subtitle."""
    head = fig.text(0.03, 0.93, f"Run {run} · ", fontsize=13, fontweight="bold", color=INK)
    fig.axes[0].annotate(label, xy=(1, 0), xycoords=head, va="bottom", fontsize=13, fontweight="bold",
                         color=LABEL_COLORS.get(label, MUTED), annotation_clip=False)
    fig.text(0.03, 0.87, subtitle, fontsize=8.5, color=MUTED)


def tail_geometry(row):
    """Right-half HT planform and elevator, in ft, as Demo 1's sketchGTB777.js builds them."""
    span = np.sqrt(row["ARHT"] * row["SHT (sqft)"])
    half = span / 2
    root = 2 * row["SHT (sqft)"] / (span * (1 + row["TRHT"]))
    tip = root * row["TRHT"]
    sweep = np.tan(np.radians(row["SWPHT (deg)"]))
    le = lambda eta: half * eta * sweep  # noqa: E731
    chord = lambda eta: root + (tip - root) * eta  # noqa: E731
    planform = [(0, 0), (le(1), -half), (le(1) + tip, -half), (root, 0), (0, 0)]
    clip = lambda v: min(1, max(0, v))  # noqa: E731
    inner, outer = sorted((clip(row["ETAIE"]), clip(row["ETAOE"])))
    hinge = 1 - clip(row["CRE"])
    elevator = [(le(inner) + chord(inner) * hinge, -half * inner), (le(outer) + chord(outer) * hinge, -half * outer),
                (le(outer) + chord(outer), -half * outer), (le(inner) + chord(inner), -half * inner)]
    return planform, elevator + elevator[:1], root


def sketch_domains(df):
    """One fixed frame for every picture, as Demo 1 sizes its sketch to all rows."""
    half = np.sqrt(df["ARHT"] * df["SHT (sqft)"]) / 2
    root = 2 * df["SHT (sqft)"] / (2 * half * (1 + df["TRHT"]))
    tip_le = half * np.tan(np.radians(df["SWPHT (deg)"]))
    max_x = max(40, (tip_le + root * df["TRHT"]).max(), root.max())
    max_span = max(30, half.max())
    return (0, np.ceil((max_x + 4) / 5) * 5), (-np.ceil((max_span + 4) / 5) * 5, 10)


def draw_sketch(path, run, label, row, domains):
    color = LABEL_COLORS.get(label, MUTED)
    fig, ax = plt.subplots(figsize=(6, 4), dpi=100)
    fig.subplots_adjust(left=0.3, right=0.7, top=0.8, bottom=0.14)
    (x0, x1), (y0, y1) = domains
    planform, elevator, root = tail_geometry(row)
    ax.axhline(0, color="#6b7280", linewidth=1)
    ax.plot(*zip(*planform), color=color, linewidth=2, solid_joinstyle="round")
    ax.plot(*zip(*elevator), color=color, linewidth=1.5, linestyle=(0, (2.5, 4)))
    ax.plot([0, root], [0, 0], color=color, linewidth=1, linestyle=(0, (6, 4)), alpha=0.65)
    ax.set_xlim(x0, x1)
    ax.set_ylim(y1, y0)  # tip at the top, as in Demo 1
    ax.set_xticks(np.arange(np.ceil(x0 / 10) * 10, x1 + 1e-9, 10))
    ax.set_yticks(np.arange(np.ceil(y0 / 10) * 10, y1 + 1e-9, 10))
    ax.tick_params(labelsize=8, colors=INK, direction="out", top=True, right=True)
    ax.set_xlabel("Chordwise distance (ft)", fontsize=8.5, color=INK)
    ax.set_ylabel("Spanwise distance (ft)", fontsize=8.5, color=INK)
    ax.text(0.03, 0.97, "Horizontal tail, right half", transform=ax.transAxes, va="top", fontsize=8, color=MUTED)
    draw_title(fig, run, label, f"AR {row['ARHT']:.2f} · taper {row['TRHT']:.2f} · sweep {row['SWPHT (deg)']:.1f}° · "
               f"area {row['SHT (sqft)']:.0f} sqft · elevator η {row['ETAIE']:.2f}–{row['ETAOE']:.2f}, "
               f"c/c {row['CRE']:.2f}")
    fig.savefig(path, facecolor="white")
    plt.close(fig)


def draw_radar(path, run, label, row):
    color = LABEL_COLORS.get(label, MUTED)
    fig = plt.figure(figsize=(6, 4), dpi=100)
    ax = fig.add_axes([0.3, 0.12, 0.4, 0.6], projection="polar")
    angles = np.linspace(0, 2 * np.pi, len(RADAR_AXES), endpoint=False)
    loop = np.append(angles, angles[0])

    def radius(values):  # each axis runs from its DOE min (center) to max (rim)
        r = [min(1, max(0, (v - lo) / (hi - lo))) for v, (_, _, lo, _, hi) in zip(values, RADAR_AXES)]
        return np.append(r, r[0])

    base = radius([b for _, _, _, b, _ in RADAR_AXES])
    ax.fill(loop, base, color=BASELINE_GREEN, alpha=0.35, linewidth=0, zorder=1)
    ax.plot(loop, base, color=BASELINE_GREEN, linewidth=1.2, zorder=2)
    design = radius([row[c] for c, *_ in RADAR_AXES])
    ax.fill(loop, design, color=color, alpha=0.15, linewidth=0, zorder=3)
    ax.plot(loop, design, color=color, linewidth=2, zorder=4)
    ax.scatter(angles, design[:-1], color=color, s=12, zorder=5)
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_ylim(0, 1)
    ax.set_yticks([0.25, 0.5, 0.75, 1], [])
    ax.set_xticks(angles, [f"{name}\n{row[c]:.4g}" for c, name, *_ in RADAR_AXES], fontsize=7.5, color=INK)
    ax.tick_params(axis="x", pad=2)
    ax.grid(color=GRID)
    ax.spines["polar"].set_color(GRID)
    handles = [plt.Line2D([], [], color=BASELINE_GREEN, linewidth=6, alpha=0.6),
               plt.Line2D([], [], color=color, linewidth=2)]
    fig.legend(handles, ["Boeing 777", f"Run {run}"], loc="lower right", frameon=False, fontsize=8)
    draw_title(fig, run, label, "8 HT inputs, each axis from its DOE min (center) to max (rim)")
    fig.savefig(path, facecolor="white")
    plt.close(fig)


def draw_margins(path, run, label, oew, fuel, margin_row, pass_row, requirements):
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
    draw_title(fig, run, label, f"OEW {oew:.1f}k lbm · block fuel {fuel:.1f}k lbm · margin to each Part 25 limit")
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
        for old in folder.glob("*_*.png"):
            old.unlink()
    folder.mkdir(parents=True, exist_ok=True)
    domains = sketch_domains(df)

    rows = []
    for i in sample.index:
        run = i + 1  # MonteCarlo.csv row number; Demo 1's __rowId is i
        label = sample.at[i, "Label"]
        picture = chart_file(run, CHARTS[0])
        draw_margins(folder / picture, run, label, sample.at[i, "OEW (1000 lbm)"],
                     sample.at[i, "Block Fuel (1000 lbm)"], margin.loc[i], ok.loc[i], requirements)
        draw_sketch(folder / chart_file(run, CHARTS[1]), run, label, sample.loc[i], domains)
        draw_radar(folder / chart_file(run, CHARTS[2]), run, label, sample.loc[i])
        row = {"Cell": f"run_{run}"}
        row.update({c: sample.at[i, c] for c in DESIGN_COLUMNS + OUTPUT_COLUMNS})
        row.update({glee_name(r): round(float(margin.at[i, r["column"]]), 4) for r in requirements})
        row["Status"] = "Infeasible" if label == "Infeasible" else "Feasible"
        row["image"] = picture
        row["charts"] = ";".join(CHARTS) if not rows else ""
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
