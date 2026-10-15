import argparse
from pathlib import Path

import pandas as pd


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

    df = pd.read_csv(input_path)
    missing = [col for col in SELECT_COLUMNS if col not in df.columns]
    if missing:
        raise KeyError(f"Missing expected columns in input CSV: {missing}")

    working = df[SELECT_COLUMNS].copy()
    working["Label"] = working.apply(compute_label, axis=1)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    working.to_csv(output_path, index=False)
    print(f"Saved filtered GTB777 data to: {output_path}")


if __name__ == "__main__":
    main()
