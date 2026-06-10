#!/usr/bin/env python3
"""Generate precomputed thermodynamic property tables for FrigProp."""

import sys
import os
import math
from datetime import datetime, timezone

import CoolProp.CoolProp as CP
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

    # Additional naturals / hydrocarbons / other-purpose fluids
    "R170":    {"cp_name": "Ethane",        "T_min_C": -80, "T_max_C":  30, "P_max_kPa": 5000},
    "R1270":   {"cp_name": "Propylene",     "T_min_C": -60, "T_max_C":  85, "P_max_kPa": 4500},
    "R600":    {"cp_name": "n-Butane",      "T_min_C": -40, "T_max_C": 140, "P_max_kPa": 3500},
    "R718":    {"cp_name": "Water",         "T_min_C":   5, "T_max_C": 200, "P_max_kPa": 1600},
    "RE170":   {"cp_name": "DimethylEther", "T_min_C": -60, "T_max_C": 120, "P_max_kPa": 5000},

    # New low-GWP fluids
    "R1233zd": {"cp_name": "R1233zd(E)",   "T_min_C": -30, "T_max_C": 150, "P_max_kPa": 3000},
    # R513A is a custom-composition azeotropic blend (mole fractions);
    # critical point from CoolProp all_critical_points().
    "R513A":   {
        "cp_name":    "R1234yf[0.5325]&R134a[0.4675]",
        "T_min_C": -50, "T_max_C": 85, "P_max_kPa": 3500,
        "T_crit_C": 95.18, "P_crit_kPa": 3650.4,
    },

    # Additional legacy HFCs / HCFCs / CFCs (historical reference)
    "R152a":   {"cp_name": "R152A",        "T_min_C": -60, "T_max_C": 100, "P_max_kPa": 4500},
    "R507A":   {"cp_name": "R507A",        "T_min_C": -60, "T_max_C":  60, "P_max_kPa": 4000},
    "R23":     {"cp_name": "R23",          "T_min_C": -80, "T_max_C":  25, "P_max_kPa": 5000},
    "R123":    {"cp_name": "R123",         "T_min_C": -30, "T_max_C": 150, "P_max_kPa": 3000},
    "R12":     {"cp_name": "R12",          "T_min_C": -60, "T_max_C": 100, "P_max_kPa": 3500},
    "R11":     {"cp_name": "R11",          "T_min_C": -40, "T_max_C": 120, "P_max_kPa": 2500},
}

SCHEMA_VERSION = 2

# Single-phase grids are indexed by distance from saturation (ΔT) so every
# cell is valid — see PLAN.md Phase 1.
# extends to 300 K for steep-isentrope fluids (R718 steam, R717); cells beyond
# an EOS temperature limit are null (unreachable, skipped by lookups)
SH_DT_VALUES_K = [0, 2, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100, 120, 140,
                  160, 180, 200, 250, 300]
SC_DT_VALUES_K = [0, 1, 2, 5, 10, 15, 20, 30, 40]
SH_P_VALUES_KPA = [50, 75, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000,
                   2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 8000, 10000, 12000]
# Sub-50 kPa columns for low-pressure fluids (R11, R123, R718, R1233zd, …)
LOW_P_VALUES_KPA = [1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 40]
P_CRIT_ANCHOR_FRACS = [0.80, 0.90, 0.95, 0.99]

SAT_T_STEP = 0.5
R744_CRIT_T_C = 30.978
R744_CRIT_FINE_RANGE = 5.0


def build_P_values(P_max_kPa, P_crit_kPa, P_triple_kPa=None, Psat_Tmin_kPa=None):
    """Standard pressures within [floor, limit], plus near-critical anchors.
    The floor covers down to Psat(T_min) (so every saturated state in the
    sat table has grid coverage) but never below the triple point (CO2)."""
    limit = min(P_max_kPa, P_crit_kPa * 0.99) if P_crit_kPa else P_max_kPa
    P_floor = P_triple_kPa if P_triple_kPa else 0.0
    if Psat_Tmin_kPa:
        P_floor = max(P_floor, min(50.0, Psat_Tmin_kPa * 0.9))
    vals = [float(p) for p in LOW_P_VALUES_KPA + SH_P_VALUES_KPA if P_floor <= p <= limit]
    # guarantee a column at/below Psat(T_min)
    if Psat_Tmin_kPa and (not vals or vals[0] > Psat_Tmin_kPa):
        anchor = max(P_floor, Psat_Tmin_kPa * 0.95)
        vals.insert(0, round(anchor, 3))
    if P_crit_kPa:
        for f in P_CRIT_ANCHOR_FRACS:
            p = round(P_crit_kPa * f, 1)
            if p > limit + 1e-9:
                continue
            # skip anchors within 2 % of an existing point
            if all(abs(p - v) / v > 0.02 for v in vals):
                vals.append(p)
    return sorted(vals)


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
        uf   = safe_props(cp_name, "U", "T", T_K, "Q", 0)
        ug   = safe_props(cp_name, "U", "T", T_K, "Q", 1)
        # bubble/dew pressures: equal for pure fluids, differ for zeotropes
        P_bub = safe_props(cp_name, "P", "T", T_K, "Q", 0)
        P_dew = safe_props(cp_name, "P", "T", T_K, "Q", 1)

        # new columns appended last so pre-existing column indices stay stable
        row = [
            round(T_C, 2),
            round(P_kPa, 4),
            round(hf  / 1000.0, 4)  if hf   is not None else None,
            round(hg  / 1000.0, 4)  if hg   is not None else None,
            round(sf  / 1000.0, 6)  if sf   is not None else None,
            round(sg  / 1000.0, 6)  if sg   is not None else None,
            round(rhof, 4)           if rhof is not None else None,
            round(rhog, 6)           if rhog is not None else None,
            round(uf  / 1000.0, 4)  if uf   is not None else None,
            round(ug  / 1000.0, 4)  if ug   is not None else None,
            round(P_bub / 1000.0, 4) if P_bub is not None else None,
            round(P_dew / 1000.0, 4) if P_dew is not None else None,
        ]
        rows.append(row)

    T_actual_max = temps[-1] if temps else T_min_C
    return {
        "fluid": fluid_key,
        "type": "saturation",
        "schema_version": SCHEMA_VERSION,
        "T_min_C": float(T_min_C),
        "T_max_C": float(T_actual_max),
        "T_step_C": SAT_T_STEP,
        "units": {"T": "C", "P": "kPa", "h": "kJ/kg", "s": "kJ/kgK", "rho": "kg/m3", "u": "kJ/kg"},
        "columns": ["T", "P_sat", "hf", "hg", "sf", "sg", "rhof", "rhog", "uf", "ug", "P_bub", "P_dew"],
        "rows": rows,
    }


def _props_at(cp_name, T_K, P_Pa, dT, Q_at_sat):
    """Properties at one grid node. ΔT=0 rows use the saturation curve (Q)
    directly so the anchor row is exact and always converges."""
    out = {}
    for key, sym in (("h", "H"), ("s", "S"), ("rho", "D"), ("cp", "C"), ("u", "U")):
        if dT == 0:
            v = safe_props(cp_name, sym, "P", P_Pa, "Q", Q_at_sat)
        else:
            v = safe_props(cp_name, sym, "T", T_K, "P", P_Pa)
        out[key] = v
    return out


def _round_node(v, key):
    if v is None:
        return None
    if key == "rho":
        return round(v, 4)
    if key == "s":
        return round(v / 1000.0, 6)
    return round(v / 1000.0, 4)  # h, u, cp


def generate_dt_table(fluid_key, cp_name, table_type, dT_values, P_vals):
    """Single-phase grid indexed by (ΔT from saturation, P).
    superheat: T = T_dew(P) + ΔT;  subcool: T = T_bubble(P) − ΔT."""
    sign, Q_sat = (1, 1) if table_type == "superheat" else (-1, 0)

    Tsat_C = []
    for P_kPa in P_vals:
        T_K = safe_props(cp_name, "T", "P", P_kPa * 1000.0, "Q", Q_sat)
        Tsat_C.append(round(T_K - 273.15, 4) if T_K is not None else None)

    grids = {k: [] for k in ("h", "s", "rho", "cp", "u")}
    valid_count = 0
    for dT in dT_values:
        rows = {k: [] for k in grids}
        for j, P_kPa in enumerate(P_vals):
            if Tsat_C[j] is None:
                for k in grids:
                    rows[k].append(None)
                continue
            T_K = Tsat_C[j] + 273.15 + sign * dT
            node = _props_at(cp_name, T_K, P_kPa * 1000.0, dT, Q_sat)
            for k in grids:
                rows[k].append(_round_node(node[k], k))
            if node["h"] is not None:
                valid_count += 1
        for k in grids:
            grids[k].append(rows[k])

    return {
        "fluid": fluid_key,
        "type": table_type,
        "schema_version": SCHEMA_VERSION,
        "dT_values_K": dT_values,
        "P_values_kPa": P_vals,
        "Tsat_C": Tsat_C,
        "units": {"h": "kJ/kg", "s": "kJ/kgK", "rho": "kg/m3", "cp": "kJ/kgK", "u": "kJ/kg"},
        "properties": ["h", "s", "rho", "cp", "u"],
        "grid": grids,
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

    try:
        P_triple_kPa = CP.PropsSI("ptriple", cfg["cp_name"]) / 1000.0
    except Exception:
        P_triple_kPa = None
    Psat_Tmin = safe_props(cp_name, "P", "T", cfg["T_min_C"] + 273.15, "Q", 1)
    Psat_Tmin_kPa = Psat_Tmin / 1000.0 if Psat_Tmin is not None else None
    P_vals = build_P_values(cfg["P_max_kPa"], P_crit_kPa, P_triple_kPa, Psat_Tmin_kPa)
    sh, sh_count = generate_dt_table(fluid_key, cp_name, "superheat", SH_DT_VALUES_K, P_vals)
    write_json(os.path.join(out_dir, "superheat.json"), sh)

    sc, sc_count = generate_dt_table(fluid_key, cp_name, "subcool", SC_DT_VALUES_K, P_vals)
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
        "schema_version":   SCHEMA_VERSION,
        "generated_utc":    datetime.now(timezone.utc).isoformat(),
        "coolprop_version": CP.get_global_param_string("version"),
        "fluids":           ordered,
    }
    write_json(manifest_path, manifest)
    print(f"\nManifest written to {manifest_path}")


if __name__ == "__main__":
    main()
