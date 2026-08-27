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
  "Cruise CD (count)"
];

export async function loadGTB777Data(csvUrl) {
  const data = await d3.csv(csvUrl, d3.autoType);
  const filteredData = data.map((d, index) => {
    const row = { __rowId: index };

    for (const column of SELECT_COLUMNS) {
      row[column] = column === "Label" ? d[column] ?? "" : d[column];
    }

    return row;
  });

  return filteredData.filter((d) =>
    d["OEW (1000 lbm)"] != null && !Number.isNaN(d["OEW (1000 lbm)"]) &&
    d["Block Fuel (1000 lbm)"] != null && !Number.isNaN(d["Block Fuel (1000 lbm)"]) &&
    d["Cruise CD (count)"] != null && !Number.isNaN(d["Cruise CD (count)"])
  );
}
