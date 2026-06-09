"""
Latin Hypercube Sampling (LHS) with 14 parameters and conditional constraints.
 
Uses scipy.stats.qmc.LatinHypercube to generate samples, then applies
repair strategies to enforce inequality constraints (e.g., a <= b).
"""

import pandas as pd
import numpy as np
from scipy.stats import qmc

# 1.  Define the 14 parameters
#     Each entry: (name, low, high)

PARAMS = [('payload_kg', 200, 300), 
          ('wingspan_m', 8, 16), 
          ('d_value_m', 9, 16),
          ('fuselage_l_m', 6, 9), 
          ('fuselage_w_m', 0.7, 1.5),
          ('horiz_tail_vol_coeff', 0.3, 0.6), 
          ('vert_tail_vol_coeff', 0.01, 0.04),
          ('cruise_s', 400, 1200), 
          ('reserve_cruise_s', 50, 250),
          ('batt_spec_energy_w_h_p_kg', 200, 280),
          # ('rotor_count', 2, 6), derived from lift + tilt, not sampled directly
          ('lift_rotor_count', 2, 4), 
          ('tilt_rotor_count', 1, 2),
          ('rotor_diameter_m', 2.5, 4.0)]

N_PARAMS = len(PARAMS)
NAMES    = [p[0] for p in PARAMS]
LOWS     = np.array([p[1] for p in PARAMS])
HIGHS    = np.array([p[2] for p in PARAMS])
IDX   = {name: i for i, name in enumerate(NAMES)}


# Constraints:
# 1. wingspan_m <= d_value_m
# 2. fuselage_l_m >= fuselage_w_m
# 3. fuselage_l_m <= d_value_m
# 4. lift_rotor_count + tilt_rotor_count = rotor_count
# 5. rotor_count * rotor_diameter_m <= wingspan_m

# generate LHS samples
def lhs_repair(n_samples: int, seed: int = 0) -> np.ndarray:
    """
    Generate `n_samples` satisfying all constraints via repair.
 
    Returns
    -------
    samples : ndarray shape (n_samples, 13), columns in PARAMS order.
              rotor_count is derived and appended as column 13.
    """
    # Sample all 13 parameters via LHS
    sampler = qmc.LatinHypercube(d=len(PARAMS), seed=seed)
    s = qmc.scale(sampler.random(n=n_samples), LOWS, HIGHS)
 
    #  Swap-repair inequalities
    swap_pairs = [
        (IDX['wingspan_m'],   IDX['d_value_m']),     # C1
        (IDX['fuselage_w_m'], IDX['fuselage_l_m']),  # C2
        (IDX['fuselage_l_m'], IDX['d_value_m']),     # C3
    ]
    for ci, cj in swap_pairs:
        bad = s[:, ci] > s[:, cj]
        s[bad, ci], s[bad, cj] = s[bad, cj].copy(), s[bad, ci].copy()
 
    # Derive integer rotor counts (C4: lift + tilt == rotor_count)
    cl = IDX['lift_rotor_count']
    ct = IDX['tilt_rotor_count']
 
    lift = np.clip(np.round(s[:, cl]), LOWS[IDX['lift_rotor_count']], HIGHS[IDX['lift_rotor_count']]).astype(int)
    tilt = np.clip(np.round(s[:, ct]), LOWS[IDX['tilt_rotor_count']], HIGHS[IDX['tilt_rotor_count']]).astype(int)
 
    # rotor_count is derived: sum of lift and tilt, clamped to [4, 10]
    rotor = np.clip(lift + tilt, 4, 10)
 
    # Adjust tilt so lift + tilt == rotor exactly
    tilt = rotor - lift
    tilt = np.clip(tilt, int(LOWS[IDX['tilt_rotor_count']]), int(HIGHS[IDX['tilt_rotor_count']]))
    
    # Recalculate lift to match rotor exactly
    lift = rotor - tilt
    lift = np.clip(lift, int(LOWS[IDX['lift_rotor_count']]), int(HIGHS[IDX['lift_rotor_count']]))
    rotor = lift + tilt
 
    s[:, cl] = lift.astype(float)
    s[:, ct] = tilt.astype(float)
 
    #  Clamp rotor_diameter_m (C5: rotor_count * diam <= wingspan_m) 
    wingspan = s[:, IDX['wingspan_m']]
    max_diam = wingspan / rotor.astype(float)
    cd = IDX['rotor_diameter_m']
    
    # Enforce minimum disk loading constraint
    # For 250 kg aircraft with ~6 rotors: disk loading ~ 70-150 Pa is realistic
    # DL = (m*g) / (n*A) = (m*g) / (n * pi*(d/2)^2)
    # Rearranging: d >= sqrt(4*m*g / (pi*n*DL))
    # Using typical: m~2500kg (MTOW guess), g~9.81, DL_max~150 Pa
    # d_min ~ sqrt(4*2500*9.81 / (pi*6*150)) ~ 2.3 m
    min_diam = 1.8  # Conservative minimum: 1.8m diameter
    
    # Clamp diameter to [min_diam, max_diam] to balance disk loading
    s[:, cd] = np.clip(s[:, cd], min_diam, max_diam)
 
    #  Append rotor_count as a derived column (14th column)
    samples = np.column_stack([s, rotor.astype(float)])
    return samples
 
if __name__ == "__main__":
    N = 200
 
    samples = lhs_repair(n_samples=N, seed=42)
 
    # Build DataFrame with derived rotor_count column
    COLS = NAMES + ['rotor_count']
    df = pd.DataFrame(samples, columns=COLS)
    for col in ('rotor_count', 'lift_rotor_count', 'tilt_rotor_count'):
        df[col] = df[col].astype(int)
    
    # Round numeric columns to 4 decimal places
    df = df.round(4)

    out = "../output/lhs_uav_samples.csv"
    df.to_csv(out, index=False)
    print(f"Saved {N} samples → {out}")
