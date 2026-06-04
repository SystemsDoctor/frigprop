#!/usr/bin/env python3
"""Spot-check generated tables against live CoolProp values."""

import sys
import os
import json
import math
import random

import CoolProp.CoolProp as CP

TABLES_DIR = os.path.join(os.path.dirname(__file__), "..", "tables")
TOLERANCE = 0.001  # 0.1%

FLUIDS = {
    "R134a": "R134a", "R410A": "R410A", "R32": "R32",
    "R1234yf": "R1234yf", "R22": "R22", "R404A": "R404A",
    "R407C": "R407C", "R744": "CO2", "R717": "Ammonia",
}

random.seed(42)
passes = 0
failures = 0
results = []


def pct_err(a, b):
    if b == 0:
        return abs(a - b)
    return abs(a - b) / abs(b)


def check(label, got, expected, tol=TOLERANCE):
    global passes, failures
    if got is None or expected is None:
        results.append(f"  SKIP {label}: got={got} expected={expected}")
        return
    err = pct_err(got, expected)
    if err <= tol:
        passes += 1
        results.append(f"  PASS {label}: got={got:.4f} expected={expected:.4f} err={err*100:.4f}%")
    else:
        failures += 1
        results.append(f"  FAIL {label}: got={got:.4f} expected={expected:.4f} err={err*100:.4f}%")


def validate_fluid(fluid_key, cp_name):
    results.append(f"\n{'='*60}")
    results.append(f"  {fluid_key}")
    results.append(f"{'='*60}")

    sat_path = os.path.join(TABLES_DIR, fluid_key, "sat.json")
    sh_path = os.path.join(TABLES_DIR, fluid_key, "superheat.json")
    sc_path = os.path.join(TABLES_DIR, fluid_key, "subcool.json")

    with open(sat_path) as f:
        sat = json.load(f)
    with open(sh_path) as f:
        sh = json.load(f)
    with open(sc_path) as f:
        sc = json.load(f)

    # --- Saturation checks ---
    results.append("  [Saturation]")
    cols = sat["columns"]
    rows = sat["rows"]
    sample_idxs = random.sample(range(len(rows)), min(5, len(rows)))
    for idx in sorted(sample_idxs):
        row = rows[idx]
        d = dict(zip(cols, row))
        T_C = d["T"]
        T_K = T_C + 273.15
        try:
            hg_live = CP.PropsSI("H", "T", T_K, "Q", 1, cp_name) / 1000.0
            sg_live = CP.PropsSI("S", "T", T_K, "Q", 1, cp_name) / 1000.0
            hf_live = CP.PropsSI("H", "T", T_K, "Q", 0, cp_name) / 1000.0
        except Exception as e:
            results.append(f"  SKIP sat T={T_C}: {e}")
            continue
        check(f"sat T={T_C:.1f}°C hg", d["hg"], hg_live)
        check(f"sat T={T_C:.1f}°C sg", d["sg"], sg_live)
        check(f"sat T={T_C:.1f}°C hf", d["hf"], hf_live)

    # --- Superheat checks ---
    results.append("  [Superheat]")
    T_vals = sh["T_values_C"]
    P_vals = sh["P_values_kPa"]
    h_grid = sh["grid"]["h"]
    s_grid = sh["grid"]["s"]

    valid_cells = [(i, j) for i in range(len(T_vals)) for j in range(len(P_vals))
                   if h_grid[i][j] is not None]
    sample_cells = random.sample(valid_cells, min(5, len(valid_cells)))
    for i, j in sample_cells:
        T_C = T_vals[i]
        P_kPa = P_vals[j]
        T_K = T_C + 273.15
        try:
            h_live = CP.PropsSI("H", "T", T_K, "P", P_kPa * 1000.0, cp_name) / 1000.0
            s_live = CP.PropsSI("S", "T", T_K, "P", P_kPa * 1000.0, cp_name) / 1000.0
        except Exception as e:
            results.append(f"  SKIP sh T={T_C} P={P_kPa}: {e}")
            continue
        check(f"sh T={T_C}°C P={P_kPa}kPa h", h_grid[i][j], h_live)
        check(f"sh T={T_C}°C P={P_kPa}kPa s", s_grid[i][j], s_live)

    # --- Subcool checks ---
    results.append("  [Subcool]")
    T_vals_sc = sc["T_values_C"]
    P_vals_sc = sc["P_values_kPa"]
    h_grid_sc = sc["grid"]["h"]
    s_grid_sc = sc["grid"]["s"]

    valid_sc = [(i, j) for i in range(len(T_vals_sc)) for j in range(len(P_vals_sc))
                if h_grid_sc[i][j] is not None]
    sample_sc = random.sample(valid_sc, min(5, len(valid_sc)))
    for i, j in sample_sc:
        T_C = T_vals_sc[i]
        P_kPa = P_vals_sc[j]
        T_K = T_C + 273.15
        try:
            h_live = CP.PropsSI("H", "T", T_K, "P", P_kPa * 1000.0, cp_name) / 1000.0
            s_live = CP.PropsSI("S", "T", T_K, "P", P_kPa * 1000.0, cp_name) / 1000.0
        except Exception as e:
            results.append(f"  SKIP sc T={T_C} P={P_kPa}: {e}")
            continue
        check(f"sc T={T_C}°C P={P_kPa}kPa h", h_grid_sc[i][j], h_live)
        check(f"sc T={T_C}°C P={P_kPa}kPa s", s_grid_sc[i][j], s_live)


def main():
    for fluid_key, cp_name in FLUIDS.items():
        validate_fluid(fluid_key, cp_name)

    for line in results:
        print(line)

    print(f"\n{'='*60}")
    print(f"  SUMMARY: {passes} passed, {failures} failed")
    print(f"{'='*60}")

    if failures > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
