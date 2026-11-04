import certSpec from "./certRequirements.json";
import { readColumnFile } from "./columnFile.js";

const SELECT_COLUMNS = [
  "ARHT",
  "TRHT",
  "TCHT",
  "SWPHT (deg)",
  "SHT (sqft)",
  "ETAIE",
  "ETAOE",
  "CRE",
  "Label",
  "OEW (1000 lbm)",
  "Block Fuel (1000 lbm)",
  "Cruise CD (count)",
  // native value of each 14 CFR Part 25 check, for the certification plots
  ...certSpec.requirements.map((requirement) => requirement.column)
];

export async function loadGTB777Data(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }
  const { rows, labels, columns } = readColumnFile(await response.arrayBuffer());
  const missing = SELECT_COLUMNS.filter((column) => !columns[column]);
  if (missing.length) {
    throw new Error(`${url} is missing columns: ${missing.join(", ")}`);
  }

  // shortcut: plots still read row objects; build them until they read the columns directly.
  const filteredData = new Array(rows);
  for (let index = 0; index < rows; index++) {
    const row = { __rowId: index };
    for (const column of SELECT_COLUMNS) {
      const value = columns[column][index];
      // NaN marks an empty CSV cell, which d3.autoType used to turn into null
      row[column] = column === "Label" ? labels[value] : Number.isNaN(value) ? null : value;
    }
    filteredData[index] = row;
  }

  return filteredData.filter((d) =>
    d["OEW (1000 lbm)"] != null && !Number.isNaN(d["OEW (1000 lbm)"]) &&
    d["Block Fuel (1000 lbm)"] != null && !Number.isNaN(d["Block Fuel (1000 lbm)"]) &&
    d["Cruise CD (count)"] != null && !Number.isNaN(d["Cruise CD (count)"])
  );
}
