# Demo 2: Ensemble Data Generation

Python workflow for Archer Midnight eVTOL ensemble data. The scripts read a
baseline configuration, draw a Latin Hypercube sample of design parameters,
size each sample, and write CSV output for the GLEE visualization tool.

Run every command from the repository root. Input JSON lives at
`data/Archer_Midnight.json`; generated files go under `output/`.

## Setup

```
pip install pandas numpy matplotlib scipy --break-system-packages
```

Place the baseline aircraft JSON at `data/Archer_Midnight.json` (same
schema as the Archer Midnight configuration used by `evtol.aircraft`).

## 0. Before you run anything: confirm the baseline config

**Open `data/Archer_Midnight.json` first.** EnsembleDataScript copies this
file for every sample and overwrites payload, geometry, rotor counts,
battery specific energy, and cruise times. If the baseline is wrong, every
run in the ensemble will be wrong.

## 1. Generate the LHS ensemble and size each sample

```
python "src/Demo 2/EnsembleDataScript.py"
```

Draws 200 repaired Latin Hypercube samples, writes
`output/lhs_uav_samples.csv`, sizes each configuration with the `evtol`
package, and saves the ensemble table to
`output/GLEEinput/ensemble_data/GLEEdata.csv`.

## 2. Draw LHS samples only

```
python "src/Demo 2/LHSeVTOL.py"
```

Writes `output/GLEEinput/lhs_uav_samples.csv` without running aircraft
sizing. Use this to inspect the sampled parameter space before a full
ensemble run.

## 3. Export failed configurations

```
python "src/Demo 2/saveJSON.py"
```

Reads `output/GLEEinput/ensemble_data/GLEEdata.csv` and
`output/GLEEinput/lhs_uav_samples.csv`, then writes a JSON config under
`output/GLEEinput/errorConfigurations/` for each row whose status is
`ValueError`.

## 4. Supporting visualization helpers

`AirCraftSketch.py`, `MassBreakdownVisual.py`, `PowerProfileVisual.py`,
`EnergyProfileVisual.py`, and `CruiseDragBuildupVisual.py` are imported by
the ensemble script to plot layout, mass, power, energy, and cruise-drag
buildup for each sized aircraft. They are not standalone entry points.

The `evtol/` package holds the aircraft, mission, environment, power, and
propulsion models, including V&V sizing cases under `evtol/V&V/`.

## Notes on the sample data

A single baseline JSON is enough to prove the pipeline runs, but the
ensemble is only as meaningful as the LHS bounds and constraints in
`LHSeVTOL.py`. Edit those ranges before treating the CSV as a design-space
result. The pipeline does not need structural changes to scale the sample
count, only a different `n_samples` value.
