#!/usr/bin/env python3
"""Generate CoolProp ground-truth cases for the JS pipeline harness.

Writes tests/truth.json (committed) so tests/e2e.mjs can run without Python.
Covers ideal-VCRC cycles (sat / superheated-inlet / subcooled-exit) for all
fluids plus standalone getProps states, including the historical failure
modes: near-saturation PS (R404A/R290), near-critical (R134a Tc=95),
R744 subcritical band, and 1-10 K subcooling.
"""

import json
import os

import CoolProp.CoolProp as CP

from generate_tables import FLUIDS, resolve_crit

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "tests", "truth.json")

# (superheat_K, subcool_K) variants per fluid at the baseline condition
CYCLE_VARIANTS = [(0, 0), (0, 5), (10, 5)]
# (fluid, Tevap_C, Tcond_C) stress cases
STRESS_CYCLES = [
    ("R134a", -10, 95), ("R744", -10, 22), ("R744", -10, 28),
    ("R134a", -50, 40), ("R410A", -40, 55),
]


def K(T_C):
    return T_C + 273.15


def solve_T_from(cp_name, P_Pa, output, target):
    """Bisection on T for mixtures where CoolProp's H/S+P flash fails."""
    T_lo = CP.PropsSI("T", "P", P_Pa, "Q", 1, cp_name) + 0.02
    T_hi = T_lo + 200
    for _ in range(80):
        T_m = (T_lo + T_hi) / 2
        if CP.PropsSI(output, "T", T_m, "P", P_Pa, cp_name) < target:
            T_lo = T_m
        else:
            T_hi = T_m
    return (T_lo + T_hi) / 2


def isentropic_to(cp_name, P_Pa, s1):
    """(h2, T2) after isentropic compression to P_Pa; handles wet compression
    (dry fluids) and mixture flash failures."""
    sg = CP.PropsSI("S", "P", P_Pa, "Q", 1, cp_name)
    if s1 < sg:  # ends inside the dome
        sf = CP.PropsSI("S", "P", P_Pa, "Q", 0, cp_name)
        x = (s1 - sf) / (sg - sf)
        hf = CP.PropsSI("H", "P", P_Pa, "Q", 0, cp_name)
        hg = CP.PropsSI("H", "P", P_Pa, "Q", 1, cp_name)
        Tb = CP.PropsSI("T", "P", P_Pa, "Q", 0, cp_name)
        Td = CP.PropsSI("T", "P", P_Pa, "Q", 1, cp_name)
        return hf + x * (hg - hf), Tb + x * (Td - Tb)
    try:
        return (CP.PropsSI("H", "P", P_Pa, "S", s1, cp_name),
                CP.PropsSI("T", "P", P_Pa, "S", s1, cp_name))
    except ValueError:  # custom blends: phase envelope not built
        T2 = solve_T_from(cp_name, P_Pa, "S", s1)
        return CP.PropsSI("H", "T", T2, "P", P_Pa, cp_name), T2


def cycle_truth(cp_name, Te_C, Tc_C, sh_K, sc_K):
    """Ideal VCRC: state 1 at Pdew(Te) (+sh), state 3 at Pbub(Tc) (−sc)."""
    P1 = CP.PropsSI("P", "T", K(Te_C), "Q", 1, cp_name)
    if sh_K > 0:
        h1 = CP.PropsSI("H", "T", K(Te_C) + sh_K, "P", P1, cp_name)
        s1 = CP.PropsSI("S", "T", K(Te_C) + sh_K, "P", P1, cp_name)
    else:
        h1 = CP.PropsSI("H", "T", K(Te_C), "Q", 1, cp_name)
        s1 = CP.PropsSI("S", "T", K(Te_C), "Q", 1, cp_name)
    P2 = CP.PropsSI("P", "T", K(Tc_C), "Q", 0, cp_name)
    h2, T2 = isentropic_to(cp_name, P2, s1)
    if sc_K > 0:
        h3 = CP.PropsSI("H", "T", K(Tc_C) - sc_K, "P", P2, cp_name)
    else:
        h3 = CP.PropsSI("H", "T", K(Tc_C), "Q", 0, cp_name)
    W = (h2 - h1) / 1000.0
    Qe = (h1 - h3) / 1000.0
    return {
        "h1": h1 / 1000.0, "s1": s1 / 1000.0, "h2": h2 / 1000.0,
        "T2": T2 - 273.15, "h3": h3 / 1000.0,
        "P1_kPa": P1 / 1000.0, "P2_kPa": P2 / 1000.0,
        "W": W, "Qe": Qe, "COP": Qe / W,
    }


def state(cp_name, **inputs):
    """Full state from two CoolProp inputs, in table units."""
    args = []
    for k, v in inputs.items():
        args += [k, v]
    out = {}
    for key, sym, scale in (("T_C", "T", 1), ("P_kPa", "P", 1e-3),
                            ("h", "H", 1e-3), ("s", "S", 1e-3),
                            ("u", "U", 1e-3), ("rho", "D", 1)):
        v = CP.PropsSI(sym, args[0], args[1], args[2], args[3], cp_name)
        out[key] = v * scale if key != "T_C" else v - 273.15
    return out


def props_cases(fluid_key, cp_name):
    """Standalone getProps checks around a mid-range pressure."""
    P = CP.PropsSI("P", "T", K(0), "Q", 1, cp_name)  # Pdew at 0 °C
    P_kPa = P / 1000.0
    T_dew = CP.PropsSI("T", "P", P, "Q", 1, cp_name)
    T_bub = CP.PropsSI("T", "P", P, "Q", 0, cp_name)
    cases = []

    sh = state(cp_name, T=T_dew + 7, P=P)
    cases.append({"pair": "TP", "v1": sh["T_C"], "v2": P_kPa, "want": sh})
    sc = state(cp_name, T=T_bub - 3, P=P)
    cases.append({"pair": "TP", "v1": sc["T_C"], "v2": P_kPa, "want": sc})

    mix = {}
    for key, sym, scale in (("h", "H", 1e-3), ("s", "S", 1e-3), ("u", "U", 1e-3)):
        f = CP.PropsSI(sym, "P", P, "Q", 0, cp_name)
        g = CP.PropsSI(sym, "P", P, "Q", 1, cp_name)
        mix[key] = (f + g) / 2 * scale
    mix["T_C"] = (T_bub + T_dew) / 2 - 273.15
    mix["P_kPa"] = P_kPa
    cases.append({"pair": "PQ", "v1": P_kPa, "v2": 0.5, "want": mix})

    cases.append({"pair": "PH", "v1": P_kPa, "v2": sh["h"], "want": sh})
    cases.append({"pair": "PS", "v1": P_kPa, "v2": sh["s"], "want": sh})
    return [{"fluid": fluid_key, **c} for c in cases]


def main():
    cycles = []
    props = []
    for key, cfg in FLUIDS.items():
        cp_name = cfg["cp_name"]
        T_crit_C, _ = resolve_crit(cfg)
        Te, Tc = -10, min(40, int(T_crit_C - 8))
        for sh, sc in CYCLE_VARIANTS:
            cycles.append({"fluid": key, "Te": Te, "Tc": Tc, "sh": sh, "sc": sc,
                           "want": cycle_truth(cp_name, Te, Tc, sh, sc)})
        props.extend(props_cases(key, cp_name))
    for key, Te, Tc in STRESS_CYCLES:
        cycles.append({"fluid": key, "Te": Te, "Tc": Tc, "sh": 0, "sc": 0,
                       "want": cycle_truth(FLUIDS[key]["cp_name"], Te, Tc, 0, 0)})

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump({"coolprop_version": CP.get_global_param_string("version"),
                   "cycles": cycles, "props": props}, f, indent=1)
    print(f"{len(cycles)} cycle + {len(props)} props cases → {OUT_PATH}")


if __name__ == "__main__":
    main()
