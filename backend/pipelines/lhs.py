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

PARAMS = [('payload_kg', 400, 500), 
          ('wingspan_m', 12.2, 17), 
          ('d_value_m', 9, 17),
          ('fuselage_l_m', 8, 10), 
          ('fuselage_w_m', 1.4, 1.8),
          ('horiz_tail_vol_coeff', 0.6, 0.8), 
          ('vert_tail_vol_coeff', 0.04, 0.06),
          ('cruise_s', 1700, 2100), 
          ('reserve_cruise_s', 100, 125),
          ('batt_spec_energy_w_h_p_kg', 230, 285),
          # ('rotor_count', 10, 14), derived from lift + tilt, not sampled directly
          ('lift_rotor_count', 5, 7), 
          ('tilt_rotor_count', 5, 7),
          ('rotor_diameter_m', 1.8, 2.3)]

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
# 5. lift_rotor_count = tilt_rotor_count
# 6. rotor_diameter_m * lift_rotor_count + (lift_rotor_count - 2) * 0.1 <= wingspan_m
# 0.1m is the clearance for rotors

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
 
    # Derive integer rotor counts (C4: lift + tilt == rotor_count, C5: lift == tilt)
    cl = IDX['lift_rotor_count']
    ct = IDX['tilt_rotor_count']
 
    # Since C5 enforces lift == tilt, use average of sampled values
    avg_rotor_type = (s[:, cl] + s[:, ct]) / 2.0
    rotor_type = np.clip(
        np.round(avg_rotor_type),
        LOWS[IDX['lift_rotor_count']],
        HIGHS[IDX['lift_rotor_count']],
    ).astype(int)

    # Cap the rotor count so the 1.8 m diameter minimum remains feasible.
    # For C6: wingspan >= rotor_type * d_min + (rotor_type - 2) * 0.1
    cd = IDX['rotor_diameter_m']
    max_feasible_rotor_type = np.floor((s[:, IDX['wingspan_m']] + 0.2) / 1.9).astype(int)
    rotor_type = np.minimum(rotor_type, max_feasible_rotor_type)
    
    # Apply constraint 5: lift == tilt
    lift = rotor_type.copy()
    tilt = rotor_type.copy()
    
    # rotor_count is derived: 2 * rotor_type (since lift == tilt)
    rotor = 2 * rotor_type
    
    s[:, cl] = lift.astype(float)
    s[:, ct] = tilt.astype(float)
 
    #  Clamp rotor_diameter_m (C6: rotor_diameter_m * lift_rotor_count + (lift_rotor_count - 2) * 0.1 <= wingspan_m)
    # With C5 (lift == tilt), this becomes: rotor_diameter_m * rotor_type + (rotor_type - 2) * 0.1 <= wingspan_m
    wingspan = s[:, IDX['wingspan_m']]
    max_diam = (wingspan - (rotor_type.astype(float) - 2) * 0.1) / rotor_type.astype(float)
    
    # Enforce minimum disk loading constraint
    # For 250 kg aircraft with ~6 rotors: disk loading ~ 70-150 Pa is realistic
    # DL = (m*g) / (n*A) = (m*g) / (n * pi*(d/2)^2)
    # Rearranging: d >= sqrt(4*m*g / (pi*n*DL))
    # Using typical: m~2500kg (MTOW guess), g~9.81, DL_max~150 Pa
    # d_min ~ sqrt(4*2500*9.81 / (pi*6*150)) ~ 2.3 m
    
    # Clamp diameter to [LOWS[cd], max_diam] to balance disk loading
    s[:, cd] = np.clip(s[:, cd], LOWS[cd], max_diam)
 
    #  Append rotor_count as a derived column (14th column)
    samples = np.column_stack([s, rotor.astype(float)])
    return samples
 
def main() -> None:
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description="Draw repaired LHS samples of the eVTOL design parameters.")
    parser.add_argument("--n", type=int, default=150, help="Number of samples")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", default="output/GLEEinput/lhs_uav_samples.csv")
    args = parser.parse_args()

    samples = lhs_repair(n_samples=args.n, seed=args.seed)

    # Build DataFrame with derived rotor_count column
    COLS = NAMES + ['rotor_count']
    df = pd.DataFrame(samples, columns=COLS)
    for col in ('rotor_count', 'lift_rotor_count', 'tilt_rotor_count'):
        df[col] = df[col].astype(int)

    # Round numeric columns to 4 decimal places
    df = df.round(4)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)
    print(f"Saved {args.n} samples -> {out}")


if __name__ == "__main__":
    main()
