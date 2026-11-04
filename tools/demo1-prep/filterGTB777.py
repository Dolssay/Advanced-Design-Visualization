import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from cert_requirements import load_requirements, native_values, passes


SELECT_COLUMNS = [
    "ARHT",
    "TRHT",
    "TCHT",
    "SWPHT (deg)",
    "SHT (sqft)",
    "ETAIE",
    "ETAOE",
    "CRE",
    "OEW (1000 lbm)",
    "Block Fuel (1000 lbm)",
    "Cruise CD (count)",
    "Range",
    "RoD TD",
    "dr",
    "Takeoff (2,2)",
    "Takeoff (2,5)",
]

# The 0/1 flags above and the certification limits they stand for (certRequirements.json).
FLAG_FOR_COLUMN = {
    "Cert max range (nmi)": "Range",
    "Cert 25.125 touchdown rate": "RoD TD",
    "Cert 25.143 rudder takeoff OEI (deg)": "dr",
    "Cert 25.181 takeoff damping (2,2)": "Takeoff (2,2)",
    "Cert 25.181 takeoff damping (2,5)": "Takeoff (2,5)",
}


# Columns the web page reads (frontend/demo1/scripts/filteredGTB777.js), before Label.
# Kept as Float64: the page prints values as is and tests certification values against limits.
WEB_COLUMNS = SELECT_COLUMNS[:11]


def write_columns(path, frame, cert_columns):
    """One file the browser maps straight onto typed arrays, no parsing:
    uint32 header length, JSON header, then each column as little-endian bytes.
    Offsets in the header count from the first 8-byte boundary after the header."""
    labels = list(dict.fromkeys(frame["Label"]))  # first-seen order, as the CSV gave the page
    arrays = {name: frame[name].to_numpy("<f8") for name in WEB_COLUMNS}
    arrays["Label"] = pd.Categorical(frame["Label"], categories=labels).codes.astype("<u1")
    arrays.update({name: frame[name].to_numpy("<f8") for name in cert_columns})

    columns, offset = [], 0
    for name, array in arrays.items():
        columns.append({"name": name, "dtype": array.dtype.str[1:], "offset": offset})
        offset += -(-array.nbytes // 8) * 8
    header = json.dumps({"rows": len(frame), "labels": labels, "columns": columns}).encode()
    start = 4 + len(header)

    with open(path, "wb") as f:
        f.write(np.uint32(len(header)).astype("<u4").tobytes())
        f.write(header)
        f.write(bytes(-start % 8))
        for array in arrays.values():
            f.write(array.tobytes())
            f.write(bytes(-array.nbytes % 8))


LABEL_MAP = {
    1: "Level 2-2",
    2: "Level 2-1",
    3: "Level 1-1",
}


def compute_label(row):
    t1 = row["Range"] * row["RoD TD"] * row["dr"]
    if not bool(t1):
        return "Infeasible"

    try:
        index = int(row["Takeoff (2,2)"] + row["Takeoff (2,5)"] + 1)
    except Exception:
        return "Else"

    return LABEL_MAP.get(index, "Else")


def main():
    parser = argparse.ArgumentParser(description="Filter GTB777 data and add JMP-style Label values.")
    parser.add_argument(
        "--input",
        default="data/MonteCarlo.csv",
        help="Path to the MonteCarlo.csv file.",
    )
    parser.add_argument(
        "--output",
        default="data/GTB777.bin",
        help="Path to save the column file the web page loads.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    requirements = load_requirements()
    wanted = set(SELECT_COLUMNS) | {r["source"] for r in requirements}
    df = pd.read_csv(input_path, low_memory=False, usecols=lambda c: c in wanted)
    missing = [col for col in SELECT_COLUMNS if col not in df.columns]
    if missing:
        raise KeyError(f"Missing expected columns in input CSV: {missing}")

    working = df[SELECT_COLUMNS].copy()
    working["Label"] = working.apply(compute_label, axis=1)

    # Certification values in their own units, for the Demo 1 certification plots
    cert = native_values(df, requirements)
    ok = passes(cert, requirements)
    for column, flag in FLAG_FOR_COLUMN.items():
        disagree = int((ok[column].astype(int) != df[flag]).sum())
        if disagree:
            raise ValueError(f"{column}: the limit in certRequirements.json disagrees with the "
                             f"'{flag}' flag on {disagree} rows")
    # Full precision: rounding would move designs that sit at a limit to the other side
    working = pd.concat([working, cert], axis=1)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_columns(output_path, working, list(cert.columns))
    print(f"Saved {len(working)} GTB777 designs to: {output_path}")


if __name__ == "__main__":
    main()
