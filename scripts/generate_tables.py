import CoolProp.CoolProp as CP
import numpy as np
import orjson
import pathlib

FLUIDS = {
    "R134a":   {"name": "R134a",   "T_min_C": -50,  "T_max_C": 100, "P_max_kPa": 5000},
    "R410A":   {"name": "R410A",   "T_min_C": -60,  "T_max_C": 60,  "P_max_kPa": 5000},
    "R32":     {"name": "R32",     "T_min_C": -60,  "T_max_C": 90,  "P_max_kPa": 6000},
    "R1234yf": {"name": "R1234yf", "T_min_C": -50,  "T_max_C": 90,  "P_max_kPa": 4000},
    "R22":     {"name": "R22",     "T_min_C": -60,  "T_max_C": 90,  "P_max_kPa": 5000},
    "R744":    {"name": "R744",    "T_min_C": -50,  "T_max_C": 30,  "P_max_kPa": 12000},
    "R717":    {"name": "R717",    "T_min_C": -60,  "T_max_C": 100, "P_max_kPa": 3000},
}

def generate_saturation_table(fluid_config):
    # Steps from T_min to T_max at 0.5°C resolution
    # Skips any T within 1°C of T_crit to avoid CoolProp instability
    ...

def generate_superheat_grid(fluid_config):
    # Only includes (T, P) nodes where T > T_sat(P) + 0.5°C
    # Marks invalid nodes as null in the grid rather than erroring
    ...

def generate_subcool_grid(fluid_config):
    # Only includes (T, P) nodes where T < T_sat(P) - 0.5°C
    ...

if __name__ == "__main__":
    for fluid_key, config in FLUIDS.items():
        out_dir = pathlib.Path(f"../tables/{fluid_key}")
        out_dir.mkdir(parents=True, exist_ok=True)
        generate_saturation_table(config, out_dir)
        generate_superheat_grid(config, out_dir)
        generate_subcool_grid(config, out_dir)
        print(f"✓ {fluid_key}")