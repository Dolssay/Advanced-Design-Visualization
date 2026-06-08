import sys
import os
import csv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from evtol.aircraft import Aircraft

aircraft = Aircraft('./Archer_Midnight.json')
mission = aircraft.mission
power = aircraft.power
propulsion = aircraft.propulsion

# Create output folder if it doesn't exist
output_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output')
os.makedirs(output_folder, exist_ok=True)

# Write to CSV file
csv_file = os.path.join(output_folder, 'GLEEinput.csv')
with open(csv_file, 'w', newline='') as file:
    writer = csv.writer(file)
    writer.writerow(['payload_kg', 'wingspan_m', 'd_value_m', 
                     'fuselage_l_m', 'fuselage_w_m', 
                     'horiz_tail_vol_coeff', 'vert_tail_vol_coeff',
                     'cruise_s', 'reserve_cruise_s',
                     'batt_spec_energy_w_h_p_kg',
                     'rotor_count', 'lift_rotor_count', 'tilt_rotor_count',
                     'rotor_diameter_m'])
    writer.writerow([aircraft.payload_kg, aircraft.wingspan_m, aircraft.d_value_m, 
                     aircraft.fuselage_l_m, aircraft.fuselage_w_m, 
                     aircraft.horiz_tail_vol_coeff, aircraft.vert_tail_vol_coeff,
                     mission.cruise_s, mission.reserve_cruise_s,
                     power.batt_spec_energy_w_h_p_kg,
                     propulsion.rotor_count, propulsion.lift_rotor_count, propulsion.tilt_rotor_count,
                     propulsion.rotor_diameter_m])

print(f"CSV file created: {csv_file}")