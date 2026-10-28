import argparse
from pathlib import Path

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
        default="data/GTB777.csv",
        help="Path to save the filtered GTB777.csv file.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    df = pd.read_csv(input_path, low_memory=False)
    missing = [col for col in SELECT_COLUMNS if col not in df.columns]
    if missing:
        raise KeyError(f"Missing expected columns in input CSV: {missing}")

    working = df[SELECT_COLUMNS].copy()
    working["Label"] = working.apply(compute_label, axis=1)

    # Certification values in their own units, for the Demo 1 certification plots
    requirements = load_requirements()
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
    working.to_csv(output_path, index=False)
    print(f"Saved filtered GTB777 data to: {output_path}")


if __name__ == "__main__":
    main()
