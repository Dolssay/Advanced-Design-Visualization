"""Write a JSON config for every failed run in GLEEdata.csv.

Run from backend/ after pipelines.ensemble:
    python -m pipelines.export_failed_configs
"""
import os
import json
from pathlib import Path

import pandas as pd

BASELINE = Path(__file__).resolve().parents[1] / "data" / "baselines" / "Archer_Midnight.json"

# create directory if it doesn't exist
output_dir = "./output/GLEEinput/errorConfigurations"
if not os.path.exists(output_dir):
    os.makedirs(output_dir)


input_columns = {
    'Payload (kg)': 'payload_kg',
    'Wingspan (m)': 'wingspan_m',
    'D-Value (m)': 'd_value_m',
    'Fuselage Length (m)': 'fuselage_l_m',
    'Fuselage Width (m)': 'fuselage_w_m',
    'Horizontal Tail Volume Coefficient': 'horiz_tail_vol_coeff',
    'Vertical Tail Volume Coefficient': 'vert_tail_vol_coeff',
    'Cruise Speed (m/s)': 'cruise_s',
    'Reserve Cruise Speed (m/s)': 'reserve_cruise_s',
    'Battery Specific Energy (W-h/kg)': 'batt_spec_energy_w_h_p_kg',
    'Lift Rotor Count': 'lift_rotor_count',
    'Tilt Rotor Count': 'tilt_rotor_count',
    'Rotor Diameter (m)': 'rotor_diameter_m',
    'Rotor Count': 'rotor_count'
}

# Load baseline config
with open(BASELINE, 'r') as f:
    baseline_config = json.load(f)

results = []

# Read both CSVs
glee_df = pd.read_csv("./output/GLEEinput/ensemble_data/GLEEdata.csv")
lhs_df = pd.read_csv("./output/GLEEinput/lhs_uav_samples.csv")

# Loop through GLEEdata and process ValueError entries
for idx, row in glee_df.iterrows():
    # Check if status is ValueError
    if pd.notna(row['Status']) and row['Status'] == 'ValueError':
        # Extract run number from cell ("run_1" -> 1). Runs are numbered from 1.
        run_num = int(row['cell'].split('_')[1])

        # Get corresponding row from lhs_uav_samples (0-based)
        lhs_row = lhs_df.iloc[run_num - 1]
        
        config = json.loads(json.dumps(baseline_config))
    
        config['aircraft']['payload_kg'] = float(lhs_row['Payload (kg)'])
        config['aircraft']['wingspan_m'] = float(lhs_row['Wingspan (m)'])
        config['aircraft']['d_value_m'] = float(lhs_row['D-Value (m)'])
        config['aircraft']['fuselage_l_m'] = float(lhs_row['Fuselage Length (m)'])
        config['aircraft']['fuselage_w_m'] = float(lhs_row['Fuselage Width (m)'])
        config['aircraft']['horiz_tail_vol_coeff'] = float(lhs_row['Horizontal Tail Volume Coefficient'])
        config['aircraft']['vert_tail_vol_coeff'] = float(lhs_row['Vertical Tail Volume Coefficient'])
        config['propulsion']['lift_rotor_count'] = int(lhs_row['Lift Rotor Count'])
        config['propulsion']['tilt_rotor_count'] = int(lhs_row['Tilt Rotor Count'])
        config['propulsion']['rotor_count'] = int(lhs_row['Rotor Count'])
        config['propulsion']['rotor_diameter_m'] = float(lhs_row['Rotor Diameter (m)'])
        config['power']['batt_spec_energy_w_h_p_kg'] = float(lhs_row['Battery Specific Energy (W-h/kg)'])
        config['mission']['cruise_s'] = float(lhs_row['Cruise Speed (m/s)'])
        config['mission']['reserve_cruise_s'] = float(lhs_row['Reserve Cruise Speed (m/s)'])
        
        temp_config_path = f'{output_dir}/Archer_Midnight_temp_{idx}.json'
        with open(temp_config_path, 'w') as f:
            json.dump(config, f, indent=2)