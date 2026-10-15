"""
htp_config.py

Shared configuration for the horizontal-tail (HTP) design-space exploration
toolkit: column groupings and 14 CFR Part 25 Subpart B constraint
definitions.

IMPORTANT
---------
The numeric limits below are the *commonly cited* Part 25 Subpart B minimums
for a two-engine transport, included so the toolkit is runnable out of the
box. Several of them (elevator/control-surface authority limits, the S181
damping-ratio and time-to-double guideline values, and the S125 touchdown
sink rate) are NOT fixed regulatory numbers in the way the speed ratios and
climb gradients are -- they depend on your specific airplane, engine count,
control-surface sizing, and certification basis (AC 25-7 flight test
guidance, your company's handling-qualities criteria, etc).

Treat every value in CONSTRAINTS as a placeholder to be confirmed by your
cert/loads/flight-dynamics engineers before using this for real design
decisions. The point of this file is to give you ONE place to correct them.
"""

import re

# ---------------------------------------------------------------------------
# Column groups
# ---------------------------------------------------------------------------

# Design variables (the geometry / control-surface sizing knobs of the DOE)
DESIGN_VARS = [
    "DV_ARHT",    # HTP aspect ratio
    "DV_TRHT",    # HTP taper ratio
    "DV_TCHT",    # HTP thickness-to-chord
    "DV_SWPHT",   # HTP sweep (deg)
    "DV_SHT",     # HTP planform area (ft^2)
    "DV_ETAIE",   # Elevator inboard eta (span fraction)
    "DV_ETAOE",   # Elevator outboard eta (span fraction)
    "DV_CRE",     # Elevator chord ratio
]

# Objectives (what you'd actually optimize against). 'minimize' for all here.
OBJECTIVES = {
    "OEW_lbm": "minimize",
    "Mission_BlockFuel_lbm": "minimize",
    "CD": "minimize",
}

# Secondary / mass-breakdown responses, useful context but not primary objectives
MASS_BREAKDOWN = [
    "HtpMassProps_Mass_lb",
    "ElevatorActuatorMass_kg",
    "HydraulicPipeMass_kg",
    "ElevatorPanelMass_kg",
]

OTHER_RESPONSES = [
    "Mission_MaxRange_nmi",
    "SubsystemsFuelPenalty_lbhr",
]

# ---------------------------------------------------------------------------
# Certification constraints
#
# Each entry: column -> dict(
#   op       : one of '>=', '<=', 'abs<='
#   limit    : numeric threshold
#   subpart  : FAR reference
#   desc     : plain-English description
# )
#
# margin convention (see constraints.py): positive margin = feasible,
# negative margin = violates the constraint, margin == 0 = exactly binding.
# ---------------------------------------------------------------------------

MAX_ELEVATOR_DEFLECTION_DEG = 25.0   # placeholder control-surface authority limits
MAX_RUDDER_DEFLECTION_DEG = 30.0
MAX_AILERON_DEFLECTION_DEG = 20.0
MIN_PHUGOID_DAMPING_RATIO = 0.04     # commonly-cited Level-1 guideline, confirm locally
MIN_TIME_TO_DOUBLE_SEC = 55.0        # commonly-cited guideline for lightly-damped modes

CONSTRAINTS = {
    # --- Sec. 25.107 Takeoff speeds ---
    "Cert_S107_V2_VSR_Ratio": dict(op=">=", limit=1.13, subpart="25.107(e)(1)(i)",
        desc="V2 >= 1.13 VSR (2/3-engine airplane)"),
    "Cert_S107_V2_Vmc_Ratio": dict(op=">=", limit=1.10, subpart="25.107(e)(1)(ii)",
        desc="V2 >= 1.10 VMC"),
    "Cert_S107_VR_Vmc_Ratio": dict(op=">=", limit=1.05, subpart="25.107(e)(4)",
        desc="VR >= 1.05 VMC"),
    "Cert_S107_Elevator_Deflection": dict(op="abs<=", limit=MAX_ELEVATOR_DEFLECTION_DEG,
        subpart="25.107", desc="Elevator deflection required for V2 trim within authority"),

    # --- Sec. 25.121 OEI climb gradients (two-engine defaults) ---
    "Cert_S121a_Grad_Climb": dict(op=">=", limit=0.024, subpart="25.121(a)",
        desc="2nd-segment OEI climb gradient >= 2.4% (twin)"),
    "Cert_S121b_Grad_Climb": dict(op=">=", limit=0.012, subpart="25.121(b)",
        desc="Final takeoff-segment OEI climb gradient >= 1.2% (twin)"),
    "Cert_S121b_Elevator_Deflection": dict(op="abs<=", limit=MAX_ELEVATOR_DEFLECTION_DEG,
        subpart="25.121(b)", desc="Elevator deflection within authority"),
    "Cert_S121c_Grad_Climb": dict(op=">=", limit=0.011, subpart="25.121(c)",
        desc="En-route OEI climb gradient >= 1.1% (twin)"),
    "Cert_S121c_Elevator_Deflection": dict(op="abs<=", limit=MAX_ELEVATOR_DEFLECTION_DEG,
        subpart="25.121(c)", desc="Elevator deflection within authority"),
    "Cert_S121d_Grad_Climb": dict(op=">=", limit=0.021, subpart="25.121(d)",
        desc="Approach-climb OEI climb gradient >= 2.1% (twin)"),
    "Cert_S121d_Elevator_Deflection": dict(op="abs<=", limit=MAX_ELEVATOR_DEFLECTION_DEG,
        subpart="25.121(d)", desc="Elevator deflection within authority"),

    # --- Sec. 25.125 Landing ---
    # No universal numeric reg limit for touchdown sink rate; this is usually an
    # internally-set design allowable tied to gear/structure. Set your own limit.
    "Cert_S125_RoD_TD": dict(op="<=", limit=1e9, subpart="25.125",
        desc="Touchdown rate of descent -- SET YOUR OWN DESIGN ALLOWABLE, disabled by default"),
    "Cert_S125_Max_Elevator_Deflection_Difference": dict(op="abs<=", limit=MAX_ELEVATOR_DEFLECTION_DEG,
        subpart="25.125", desc="Elevator deflection difference within authority"),

    # --- Sec. 25.143 Controllability and maneuverability ---
    # CEI = critical engine inoperative, ALL = all engines operating
    # dde = elevator, dr = rudder, da = aileron deflection required (deg)
}

# Programmatically add the many Sec. 25.143 / 25.145 control-surface columns
_143_phases = ["Takeoff", "Cruise", "Landing"]
_143_engine_cases = {"CEI": "critical engine inoperative", "ALL": "all engines operating"}
_143_surfaces = {"dde": ("Elevator", MAX_ELEVATOR_DEFLECTION_DEG),
                  "dr": ("Rudder", MAX_RUDDER_DEFLECTION_DEG),
                  "da": ("Aileron", MAX_AILERON_DEFLECTION_DEG)}

for phase in _143_phases:
    for case, case_desc in _143_engine_cases.items():
        for suffix, (surf_name, limit) in _143_surfaces.items():
            col = f"Cert_S143_{phase}_{case}_{suffix}"
            CONSTRAINTS[col] = dict(
                op="abs<=", limit=limit, subpart="25.143",
                desc=f"{surf_name} deflection required, {phase} {case_desc}, within authority",
            )

CONSTRAINTS["Cert_S145_Max_Elevator_Deflection_Difference"] = dict(
    op="abs<=", limit=MAX_ELEVATOR_DEFLECTION_DEG, subpart="25.145",
    desc="Longitudinal control (elevator) deflection difference within authority")

# --- Sec. 25.181 Dynamic stability ---
_181_phases = ["Cruise", "Takeoff", "Landing"]
_181_mode_pairs = ["1_3", "2_3", "1_4", "2_4"]

for phase in _181_phases:
    for pair in _181_mode_pairs:
        dcol = f"Cert_S181_{phase}_Damping_Ratio_{pair}"
        CONSTRAINTS[dcol] = dict(
            op=">=", limit=MIN_PHUGOID_DAMPING_RATIO, subpart="25.181",
            desc=f"Damping ratio, modes {pair.replace('_','/')}, {phase}")
    for pair in ["2_3", "2_4"]:
        tcol = f"Cert_S181_{phase}_Time_to_Double_{pair}"
        CONSTRAINTS[tcol] = dict(
            op=">=", limit=MIN_TIME_TO_DOUBLE_SEC, subpart="25.181",
            desc=f"Time to double amplitude, modes {pair.replace('_','/')}, {phase}")


def constraint_columns_present(df_columns):
    """Return the subset of CONSTRAINTS keys that actually exist in a dataframe."""
    return [c for c in CONSTRAINTS if c in df_columns]
