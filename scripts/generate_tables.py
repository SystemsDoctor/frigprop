#!/usr/bin/env python3
"""Generate precomputed thermodynamic property tables for FrigProp."""

import sys
import os
import math
from datetime import datetime, timezone

import CoolProp.CoolProp as CP
import numpy as np
import orjson

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "tables")

# T_crit_C / P_crit_kPa overrides are used when CoolProp's AbstractState
# cannot resolve the critical point (e.g. multi-component blends).
FLUIDS = {
    # Modern single-component
    "R32":     {"cp_name": "R32",          "T_min_C": -60, "T_max_C":  90, "P_max_kPa": 6000},
    "R1234yf": {"cp_name": "R1234yf",      "T_min_C": -50, "T_max_C":  90, "P_max_kPa": 4000},
    "R1234ze": {"cp_name": "R1234ze(E)",   "T_min_C": -40, "T_max_C": 100, "P_max_kPa": 3500},

    # Modern blends (R-32 dominated, replacing R-410A)
    # CoolProp mixture model tables are reliable up to ~3000 kPa for these blends;
    # T_crit_C / P_crit_kPa come from published manufacturer data.
    "R454B":   {
        "cp_name":    "R32[0.8293]&R1234yf[0.1707]",
        "T_min_C": -60, "T_max_C": 50, "P_max_kPa": 3000,
        "T_crit_C": 75.6, "P_crit_kPa": 4637.0,
    },
    "R452B":   {
        "cp_name":    "R32[0.8181]&R125[0.0370]&R1234yf[0.1448]",
        "T_min_C": -60, "T_max_C": 50, "P_max_kPa": 3000,
        "T_crit_C": 71.8, "P_crit_kPa": 4671.0,
    },

    # Legacy HFCs / HCFC
    "R134a":   {"cp_name": "R134a",        "T_min_C": -50, "T_max_C": 100, "P_max_kPa": 5000},
    "R410A":   {"cp_name": "R410A",        "T_min_C": -60, "T_max_C":  60, "P_max_kPa": 5000},
    "R407C":   {"cp_name": "R407C",        "T_min_C": -60, "T_max_C":  80, "P_max_kPa": 5000},
    "R404A":   {"cp_name": "R404A",        "T_min_C": -60, "T_max_C":  60, "P_max_kPa": 5000},
    "R22":     {"cp_name": "R22",          "T_min_C": -60, "T_max_C":  90, "P_max_kPa": 5000},

    # Natural refrigerants
    "R290":    {"cp_name": "Propane",      "T_min_C": -60, "T_max_C":  90, "P_max_kPa": 4000},
    "R600a":   {"cp_name": "IsoButane",    "T_min_C": -40, "T_max_C": 120, "P_max_kPa": 3500},
    "R744":    {"cp_name": "CO2",          "T_min_C": -50, "T_max_C":  30, "P_max_kPa": 12000},
    "R717":    {"cp_name": "Ammonia",      "T_min_C": -60, "T_max_C": 100, "P_max_kPa": 3000},
}

SH_T_VALUES_C  = [-20, -10, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140]
SH_P_VALUES_KPA = [50, 75, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000,
                   2500, 3000, 4000, 5000, 6000, 8000, 10000, 12000]

SAT_T_STEP = 0.5
R744_CRIT_T_C = 30.978
R744_CRIT_FINE_RANGE = 5.0


def safe_props(fluid, output, input1, val1, input2, val2):
    try:
        result = CP.PropsSI(output, input1, val1, input2, val2, fluid)
        if not math.isfinite(result):
            return None
        return result
    except Exception:
        return None


def get_T_crit(cp_name):
    """Query CoolProp for T_critical. Returns None for blends or on failure."""
    try:
        AS = CP.AbstractState("HEOS", cp_name)
        return AS.T_critical() - 273.15
    except Exception:
        return None


def get_P_crit(cp_name):
    """Query CoolProp for P_critical. Returns None for blends or on failure."""
    try:
        AS = CP.AbstractState("HEOS", cp_name)
        return AS.p_critical() / 1000.0
    except Exception:
        return None


def resolve_crit(cfg):
    """Return (T_crit_C, P_crit_kPa) using config overrides when present."""
    T_crit = cfg.get("T_crit_C")
    P_crit = cfg.get("P_crit_kPa")
    if T_crit is None:
        T_crit = get_T_crit(cfg["cp_name"])
    if P_crit is None:
        P_crit = get_P_crit(cfg["cp_name"])
    return T_crit, P_crit


def generate_sat_temperatures(fluid_key, T_min_C, T_max_C, T_crit_C):
    T_end = min(T_max_C, T_crit_C - 0.5) if T_crit_C is not None else T_max_C

    if fluid_key == "R744":
        temps = []
        T = T_min_C
        while T <= T_end + 1e-9:
            temps.append(round(T, 2))
            dist = abs(T - R744_CRIT_T_C)
            if dist <= R744_CRIT_FINE_RANGE:
                T += 0.1
            else:
                T += SAT_T_STEP
        return temps
    else:
        n = round((T_end - T_min_C) / SAT_T_STEP) + 1
        return [round(T_min_C + i * SAT_T_STEP, 2) for i in range(n)]


def generate_sat_table(fluid_key, cp_name, T_min_C, T_max_C, T_crit_C):
    temps = generate_sat_temperatures(fluid_key, T_min_C, T_max_C, T_crit_C)
    rows = []
    for T_C in temps:
        T_K = T_C + 273.15
        P_sat = safe_props(cp_name, "P", "T", T_K, "Q", 0.5)
        if P_sat is None:
            P_sat = safe_props(cp_name, "P", "T", T_K, "Q", 0)
        if P_sat is None:
            continue
        P_kPa = P_sat / 1000.0

        hf   = safe_props(cp_name, "H", "T", T_K, "Q", 0)
        hg   = safe_props(cp_name, "H", "T", T_K, "Q", 1)
        sf   = safe_props(cp_name, "S", "T", T_K, "Q", 0)
        sg   = safe_props(cp_name, "S", "T", T_K, "Q", 1)
        rhof = safe_props(cp_name, "D", "T", T_K, "Q", 0)
        rhog = safe_props(cp_name, "D", "T", T_K, "Q", 1)

        row = [
            round(T_C, 2),
            round(P_kPa, 4),
            round(hf  / 1000.0, 4)  if hf   is not None else None,
            round(hg  / 1000.0, 4)  if hg   is not None else None,
            round(sf  / 1000.0, 6)  if sf   is not None else None,
            round(sg  / 1000.0, 6)  if sg   is not None else None,
            round(rhof, 4)           if rhof is not None else None,
            round(rhog, 6)           if rhog is not None else None,
        ]
        rows.append(row)

    T_actual_max = temps[-1] if temps else T_min_C
    return {
        "fluid": fluid_key,
        "type": "saturation",
        "T_min_C": float(T_min_C),
        "T_max_C": float(T_actual_max),
        "T_step_C": SAT_T_STEP,
        "units": {"T": "C", "P": "kPa", "h": "kJ/kg", "s": "kJ/kgK", "rho": "kg/m3"},
        "columns": ["T", "P_sat", "hf", "hg", "sf", "sg", "rhof", "rhog"],
        "rows": rows,
    }


def get_T_sat_from_P(cp_name, P_kPa):
    try:
        T_K = CP.PropsSI("T", "P", P_kPa * 1000.0, "Q", 0.5, cp_name)
        if math.isfinite(T_K):
            return T_K - 273.15
    except Exception:
        pass
    return None


def generate_superheat_table(fluid_key, cp_name, P_max_kPa, P_crit_kPa):
    P_limit = min(P_max_kPa, P_crit_kPa * 0.99) if P_crit_kPa else P_max_kPa
    P_vals  = [p for p in SH_P_VALUES_KPA if p <= P_limit]

    T_vals = SH_T_VALUES_C.copy()
    h_grid, s_grid, rho_grid, cp_grid = [], [], [], []
    valid_count = 0

    for T_C in T_vals:
        T_K = T_C + 273.15
        h_row, s_row, rho_row, cp_row = [], [], [], []
        for P_kPa in P_vals:
            T_sat_C = get_T_sat_from_P(cp_name, P_kPa)
            if T_sat_C is None or T_C <= T_sat_C + 0.5:
                h_row.append(None); s_row.append(None)
                rho_row.append(None); cp_row.append(None)
                continue
            h     = safe_props(cp_name, "H", "T", T_K, "P", P_kPa * 1000.0)
            s     = safe_props(cp_name, "S", "T", T_K, "P", P_kPa * 1000.0)
            rho   = safe_props(cp_name, "D", "T", T_K, "P", P_kPa * 1000.0)
            cp_val= safe_props(cp_name, "C", "T", T_K, "P", P_kPa * 1000.0)
            h_row.append(  round(h      / 1000.0, 4) if h      is not None else None)
            s_row.append(  round(s      / 1000.0, 6) if s      is not None else None)
            rho_row.append(round(rho,    4)            if rho    is not None else None)
            cp_row.append( round(cp_val / 1000.0, 4)  if cp_val is not None else None)
            if h is not None:
                valid_count += 1
        h_grid.append(h_row); s_grid.append(s_row)
        rho_grid.append(rho_row); cp_grid.append(cp_row)

    return {
        "fluid": fluid_key,
        "type": "superheat",
        "T_values_C": T_vals,
        "P_values_kPa": P_vals,
        "units": {"h": "kJ/kg", "s": "kJ/kgK", "rho": "kg/m3", "cp": "kJ/kgK"},
        "properties": ["h", "s", "rho", "cp"],
        "grid": {"h": h_grid, "s": s_grid, "rho": rho_grid, "cp": cp_grid},
    }, valid_count


def generate_subcool_table(fluid_key, cp_name, P_max_kPa, P_crit_kPa):
    P_limit = min(P_max_kPa, P_crit_kPa * 0.99) if P_crit_kPa else P_max_kPa
    P_vals  = [p for p in SH_P_VALUES_KPA if p <= P_limit]

    T_vals = [-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60, 70, 80]
    h_grid, s_grid, rho_grid, cp_grid = [], [], [], []
    valid_count = 0

    for T_C in T_vals:
        T_K = T_C + 273.15
        h_row, s_row, rho_row, cp_row = [], [], [], []
        for P_kPa in P_vals:
            T_sat_C = get_T_sat_from_P(cp_name, P_kPa)
            if T_sat_C is None or T_C >= T_sat_C - 0.5:
                h_row.append(None); s_row.append(None)
                rho_row.append(None); cp_row.append(None)
                continue
            h     = safe_props(cp_name, "H", "T", T_K, "P", P_kPa * 1000.0)
            s     = safe_props(cp_name, "S", "T", T_K, "P", P_kPa * 1000.0)
            rho   = safe_props(cp_name, "D", "T", T_K, "P", P_kPa * 1000.0)
            cp_val= safe_props(cp_name, "C", "T", T_K, "P", P_kPa * 1000.0)
            h_row.append(  round(h      / 1000.0, 4) if h      is not None else None)
            s_row.append(  round(s      / 1000.0, 6) if s      is not None else None)
            rho_row.append(round(rho,    4)            if rho    is not None else None)
            cp_row.append( round(cp_val / 1000.0, 4)  if cp_val is not None else None)
            if h is not None:
                valid_count += 1
        h_grid.append(h_row); s_grid.append(s_row)
        rho_grid.append(rho_row); cp_grid.append(cp_row)

    return {
        "fluid": fluid_key,
        "type": "subcool",
        "T_values_C": T_vals,
        "P_values_kPa": P_vals,
        "units": {"h": "kJ/kg", "s": "kJ/kgK", "rho": "kg/m3", "cp": "kJ/kgK"},
        "properties": ["h", "s", "rho", "cp"],
        "grid": {"h": h_grid, "s": s_grid, "rho": rho_grid, "cp": cp_grid},
    }, valid_count


def write_json(path, data):
    with open(path, "wb") as f:
        f.write(orjson.dumps(data, option=orjson.OPT_NON_STR_KEYS))


def generate_fluid(fluid_key, run_only=None):
    if run_only and fluid_key not in run_only:
        return None
    cfg     = FLUIDS[fluid_key]
    cp_name = cfg["cp_name"]
    out_dir = os.path.join(OUTPUT_DIR, fluid_key)
    os.makedirs(out_dir, exist_ok=True)

    T_crit_C, P_crit_kPa = resolve_crit(cfg)

    sat = generate_sat_table(fluid_key, cp_name, cfg["T_min_C"], cfg["T_max_C"], T_crit_C)
    write_json(os.path.join(out_dir, "sat.json"), sat)

    sh, sh_count = generate_superheat_table(fluid_key, cp_name, cfg["P_max_kPa"], P_crit_kPa)
    write_json(os.path.join(out_dir, "superheat.json"), sh)

    sc, sc_count = generate_subcool_table(fluid_key, cp_name, cfg["P_max_kPa"], P_crit_kPa)
    write_json(os.path.join(out_dir, "subcool.json"), sc)

    print(f"✓ {fluid_key:8s}  sat:{len(sat['rows'])} rows  "
          f"superheat:{sh_count} nodes  subcool:{sc_count} nodes  "
          f"T_crit={T_crit_C:.2f}°C  P_crit={P_crit_kPa:.1f} kPa")

    return {
        "files": ["sat.json", "superheat.json", "subcool.json"],
        "T_crit_C":    round(T_crit_C,    2) if T_crit_C    is not None else None,
        "P_crit_kPa":  round(P_crit_kPa,  1) if P_crit_kPa  is not None else None,
        "T_min_C":  cfg["T_min_C"],
        "T_max_C":  cfg["T_max_C"],
        "P_max_kPa": cfg["P_max_kPa"],
    }


def main():
    run_only = None
    if len(sys.argv) > 1:
        run_only = sys.argv[1:]
        print(f"Generating only: {run_only}")

    print(f"CoolProp version: {CP.get_global_param_string('version')}")
    print(f"Output directory: {os.path.abspath(OUTPUT_DIR)}\n")

    manifest_path = os.path.join(OUTPUT_DIR, "manifest.json")

    # For partial runs, seed from existing manifest so we don't lose other fluids
    existing_fluids = {}
    if run_only and os.path.exists(manifest_path):
        with open(manifest_path, "rb") as f:
            existing_fluids = orjson.loads(f.read()).get("fluids", {})

    manifest_fluids = dict(existing_fluids)

    for fluid_key in FLUIDS:
        result = generate_fluid(fluid_key, run_only)
        if result:
            manifest_fluids[fluid_key] = result

    # Preserve FLUIDS dict ordering in the manifest
    ordered = {k: manifest_fluids[k] for k in FLUIDS if k in manifest_fluids}
    manifest = {
        "generated_utc":    datetime.now(timezone.utc).isoformat(),
        "coolprop_version": CP.get_global_param_string("version"),
        "fluids":           ordered,
    }
    write_json(manifest_path, manifest)
    print(f"\nManifest written to {manifest_path}")


if __name__ == "__main__":
    main()
