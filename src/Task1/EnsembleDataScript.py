import sys
import os
import json
import pandas as pd
import matplotlib.pyplot as plt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from evtol.aircraft import Aircraft
from LHSeVTOL import lhs_repair
from AirCraftSketch import visualize_aircraft_layout
from MassBreakdownVisual import visualize_mass_breakdown
from PowerProfileVisual import visualize_power_profile
from EnergyProfileVisual import visualize_energy_profile
from CruiseDragBuildupVisual import visualize_cruise_drag_buildup


# create directory if it doesn't exist
output_dir = "./output/GLEEinput/ensemble_data"
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

# Generate LHS samples
samples = lhs_repair(n_samples=200, seed=0)

# Build DataFrame and save to CSV
df = pd.DataFrame(samples, columns=list(input_columns.keys()))
for col in ('Rotor Count', 'Lift Rotor Count', 'Tilt Rotor Count'):
    df[col] = df[col].astype(int)
df = df.round(4)
df.to_csv("./output/lhs_uav_samples.csv", index=False)

# Load baseline config
with open('./data/Archer_Midnight.json', 'r') as f:
    baseline_config = json.load(f)

results = []

# Loop through each sample (a run)
for idx, row in df.iterrows():
    idx = idx + 1 # Run index starts at 1

    # Build result dict for this run
    result = {'cell': f'run_{idx}'}
    # Input information
    result.update({col: row[col] for col in input_columns.keys()})
    
    config = json.loads(json.dumps(baseline_config))
    
    config['aircraft']['payload_kg'] = float(row['Payload (kg)'])
    config['aircraft']['wingspan_m'] = float(row['Wingspan (m)'])
    config['aircraft']['d_value_m'] = float(row['D-Value (m)'])
    config['aircraft']['fuselage_l_m'] = float(row['Fuselage Length (m)'])
    config['aircraft']['fuselage_w_m'] = float(row['Fuselage Width (m)'])
    config['aircraft']['horiz_tail_vol_coeff'] = float(row['Horizontal Tail Volume Coefficient'])
    config['aircraft']['vert_tail_vol_coeff'] = float(row['Vertical Tail Volume Coefficient'])
    config['propulsion']['lift_rotor_count'] = int(row['Lift Rotor Count'])
    config['propulsion']['tilt_rotor_count'] = int(row['Tilt Rotor Count'])
    config['propulsion']['rotor_count'] = int(row['Rotor Count'])
    config['propulsion']['rotor_diameter_m'] = float(row['Rotor Diameter (m)'])
    config['power']['batt_spec_energy_w_h_p_kg'] = float(row['Battery Specific Energy (W-h/kg)'])
    config['mission']['cruise_s'] = float(row['Cruise Speed (m/s)'])
    config['mission']['reserve_cruise_s'] = float(row['Reserve Cruise Speed (m/s)'])
    
    temp_config_path = './data/Archer_Midnight_temp.json'
    with open(temp_config_path, 'w') as f:
        json.dump(config, f, indent=2)
    
    try:
        aircraft = Aircraft(temp_config_path)

        # Structural Mass output
        structural = {
            'Wing':               aircraft.wing_mass_kg,
            'Horizontal Tail':    aircraft.horiz_tail_mass_kg,
            'Vertical Tail':      aircraft.vert_tail_mass_kg,
            'Fuselage':           aircraft.fuselage_mass_kg,
            'Boom':               aircraft.boom_mass_kg,
            'Landing Gear':       aircraft.landing_gear_mass_kg,
        }
        for comp, mass in structural.items():
            result[comp] = mass

        # Propulsion Mass output
        propulsion = {
            'EPU (all rotors)':   aircraft.epu_mass_kg,
            'Lift Rotor + Hub':   aircraft.lift_rotor_hub_mass_kg,
            'Tilt Rotor':         aircraft.tilt_rotor_mass_kg,
        }
        for comp, mass in propulsion.items():
            result[comp] = mass

        # Subsystem Mass output
        subsystems = {
            'Actuators':          aircraft.actuator_mass_kg,
            'Furnishings':        aircraft.furnishings_mass_kg,
            'Env. Control':       aircraft.environmental_control_system_mass_kg,
            'Avionics':           aircraft.avionics_mass_kg,
            'Hi-Volt Power':      aircraft.hivolt_power_dist_mass_kg,
            'Lo-Volt Power':      aircraft.lovolt_power_coms_mass_kg,
        }
        for comp, mass in subsystems.items():
            result[comp] = mass

        # Primary Energy output
        primary_segments = [
            ('Depart Taxi',         aircraft.depart_taxi_energy_kw_hr),
            ('Hover Climb',         aircraft.hover_climb_energy_kw_hr),
            ('Transition Climb',    aircraft.trans_climb_energy_kw_hr),
            ('Depart Procedures',   aircraft.depart_proc_energy_kw_hr),
            ('Accelerate Climb',    aircraft.accel_climb_energy_kw_hr),
            ('Cruise',              aircraft.cruise_energy_kw_hr),
            ('Decelerate Descend',  aircraft.decel_descend_energy_kw_hr),
            ('Arrive Procedures',   aircraft.arrive_proc_energy_kw_hr),
            ('Transition Descend',  aircraft.trans_descend_energy_kw_hr),
            ('Hover Descend',       aircraft.hover_descend_energy_kw_hr),
            ('Arrive Taxi',         aircraft.arrive_taxi_energy_kw_hr),
        ]

        # Reserve Energy output
        reserve_segments = [
            ('Rsv Hover Climb',     aircraft.reserve_hover_climb_energy_kw_hr),
            ('Rsv Trans. Climb',    aircraft.reserve_trans_climb_energy_kw_hr),
            ('Rsv Accel. Climb',    aircraft.reserve_accel_climb_energy_kw_hr),
            ('Rsv Cruise',          aircraft.reserve_cruise_energy_kw_hr),
            ('Rsv Decel. Descend',  aircraft.reserve_decel_descend_energy_kw_hr),
            ('Rsv Trans. Descend',  aircraft.reserve_trans_descend_energy_kw_hr),
            ('Rsv Hover Descend',   aircraft.reserve_hover_descend_energy_kw_hr),
        ]
        primary_total = sum(e for _, e in primary_segments)
        reserve_total = sum(e for _, e in reserve_segments)
        for seg, energy in primary_segments:
            result[f'{seg} (kW-hr)'] = energy
        result['Primary Total (kW-hr)'] = primary_total
        result['Reserve Total (kW-hr)'] = reserve_total
        result['Total Energy (kW-hr)'] = primary_total + reserve_total

        # Final MTOW output
        final_mtow, history = aircraft._iterate_mtow()
        result['MTOW (kg)'] = final_mtow
        result['Iterations'] = len(history)
        result['Status'] = 'Success'

    # If MTOW does not converge
    except Exception as e:
        print(f"⚠ Sample {idx}: {type(e).__name__} - {e}")
        result['MTOW (kg)'] = None
        result['Status'] = type(e).__name__
        result['Iterations'] = None
    finally:
        if os.path.exists(temp_config_path):
            os.remove(temp_config_path)

    # Aircraft layout visualization
    fig, ax = visualize_aircraft_layout(aircraft)
    fig.savefig(f"{output_dir}/{idx}_aircraft_layout.png", bbox_inches='tight', pad_inches=0.5)
    plt.close(fig)
    # Mass breakdown visualization
    fig, axes = visualize_mass_breakdown(structural, propulsion, subsystems, aircraft)
    fig.savefig(f"{output_dir}/{idx}_massbreakdown.png")
    plt.close(fig)
    # Power profile visualization
    fig, ax = visualize_power_profile(aircraft)
    fig.savefig(f"{output_dir}/{idx}_powerprofile.png")
    plt.close(fig)
    # Energy profile visualization
    fig, ax = visualize_energy_profile(aircraft)
    fig.savefig(f"{output_dir}/{idx}_energyprofile.png")
    plt.close(fig)
    # Cruise drag buildup visualization
    fig, ax = visualize_cruise_drag_buildup(aircraft)
    fig.savefig(f"{output_dir}/{idx}_cruisedragbuildup.png")
    plt.close(fig)

    result['image'] = f"{idx}.png"

    # image types apply at 1st run
    if idx == 1:
        result['charts'] = 'Aircraft Layout;Mass Breakdown;Power Profile;Energy Profile;Cruise Drag Buildup'

    results.append(result)

# Save results
pd.DataFrame(results).to_csv("./output/GLEEinput/ensemble_data/GLEEdata.csv", index=False)