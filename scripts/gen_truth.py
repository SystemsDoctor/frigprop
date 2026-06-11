#!/usr/bin/env python3
"""Generate CoolProp ground-truth cases for the JS pipeline harness.

Writes tests/truth.json (committed) so tests/e2e.mjs can run without Python.
Covers ideal and real (eta < 1) VCRC cycles over a per-fluid condition matrix
(sat / superheated-inlet / subcooled-exit, specified by dT or by pressure)
plus standalone getProps states: shallow/deep superheat and subcool, two-phase
qualities, PH/PS inversion (incl. wet PS), near-critical interpolation, and
the historical failure modes (near-saturation PS for R404A/R290, near-critical
R134a Tc=95, the R744 subcritical band, 1-10 K subcooling).

Two-phase truth uses the tool's documented linear-in-quality convention
between the CoolProp-exact saturation endpoints (exact for pure fluids,
mid-glide approximation for zeotropic blends).
"""

import json
import os

import CoolProp.CoolProp as CP

from generate_tables import FLUIDS, resolve_crit

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "tests", "truth.json")

# (superheat_K, subcool_K) variants applied at every condition
CYCLE_VARIANTS = [(0, 0), (0, 5), (10, 5)]
# extra variants applied at the baseline condition only
BASELINE_VARIANTS = [(5, 2), (20, 10)]
# (eta, sh, sc) compressor-efficiency variants at the baseline condition
ETA_VARIANTS = [(0.80, 10, 5), (0.65, 0, 0)]
# (fluid, Tevap_C, Tcond_C) stress cases
STRESS_CYCLES = [
    ("R134a", -10, 95), ("R744", -10, 22), ("R744", -10, 28),
    ("R134a", -50, 40), ("R410A", -40, 55),
    ("R600a", -10, 100), ("R717", -30, 60), ("R290", -30, 85),
]

# superheat ΔT-grid reach (generate_tables.SH_DT_VALUES_K max); discharge
# states beyond it are out of table coverage by design — don't emit them
MAX_DISCHARGE_SH_K = 280


def K(T_C):
    return T_C + 273.15


def solve_T_from(cp_name, P_Pa, output, target):
    """Bisection on T for mixtures where CoolProp's H/S+P flash fails."""
    T_lo = CP.PropsSI("T", "P", P_Pa, "Q", 1, cp_name) + 0.02
    T_hi = T_lo + 400
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


def T_from_PH(cp_name, P_Pa, h):
    """T after a P,h flash; handles wet states and mixture flash failures."""
    hg = CP.PropsSI("H", "P", P_Pa, "Q", 1, cp_name)
    if h < hg:  # inside the dome — linear-in-quality T across the glide
        hf = CP.PropsSI("H", "P", P_Pa, "Q", 0, cp_name)
        x = (h - hf) / (hg - hf)
        Tb = CP.PropsSI("T", "P", P_Pa, "Q", 0, cp_name)
        Td = CP.PropsSI("T", "P", P_Pa, "Q", 1, cp_name)
        return Tb + x * (Td - Tb)
    try:
        return CP.PropsSI("T", "P", P_Pa, "H", h, cp_name)
    except ValueError:
        return solve_T_from(cp_name, P_Pa, "H", h)


def cycle_truth(cp_name, Te_C, Tc_C, sh_K, sc_K, eta=1.0):
    """VCRC: state 1 at Pdew(Te) (+sh), state 3 at Pbub(Tc) (−sc),
    compression isentropic then corrected to isentropic efficiency eta."""
    P1 = CP.PropsSI("P", "T", K(Te_C), "Q", 1, cp_name)
    if sh_K > 0:
        h1 = CP.PropsSI("H", "T", K(Te_C) + sh_K, "P", P1, cp_name)
        s1 = CP.PropsSI("S", "T", K(Te_C) + sh_K, "P", P1, cp_name)
    else:
        h1 = CP.PropsSI("H", "T", K(Te_C), "Q", 1, cp_name)
        s1 = CP.PropsSI("S", "T", K(Te_C), "Q", 1, cp_name)
    P2 = CP.PropsSI("P", "T", K(Tc_C), "Q", 0, cp_name)
    h2, T2 = isentropic_to(cp_name, P2, s1)
    if eta < 1:
        h2 = h1 + (h2 - h1) / eta
        T2 = T_from_PH(cp_name, P2, h2)
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


def cycle_conditions(cfg, cp_name, T_crit_C, P_crit_kPa):
    """Per-fluid (Te, Tc) matrix spanning low/mid/high within table range.
    Tc is capped at 70 °C — steeper lifts push state 2 beyond the superheat
    grid for steep-isentrope fluids; near-critical lives in STRESS_CYCLES.
    Tc must also keep the condenser inside the table's pressure columns."""
    T_lo = cfg["T_min_C"]
    P_lim = min(cfg["P_max_kPa"], 0.99 * P_crit_kPa)
    try:
        T_at_P_lim = CP.PropsSI("T", "P", P_lim * 1000.0, "Q", 0, cp_name) - 273.15 - 1
    except ValueError:  # custom blends: flash unstable that close to critical
        T_at_P_lim = T_crit_C
    Tc_hi = min(cfg["T_max_C"], T_crit_C - 8, 70, T_at_P_lim)
    pairs = set()
    for Te in (T_lo + 5, -10, 5):
        Te = max(Te, T_lo + 2)
        for Tc in (30, 45, Tc_hi):
            Tc = min(Tc, Tc_hi)
            if Tc >= Te + 12:
                pairs.add((round(Te, 1), round(Tc, 1)))
    return sorted(pairs)


def baseline_condition(pairs):
    """The condition closest to the canonical −10 °C / 45 °C case."""
    return min(pairs, key=lambda p: abs(p[0] + 10) + abs(p[1] - 45))


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


def sat_side(cp_name, key, val, Q):
    """Saturation endpoint (SI Pa/J/K units) keyed by T or P."""
    return {sym: CP.PropsSI(sym, key, val, "Q", Q, cp_name)
            for sym in ("T", "P", "H", "S", "U", "D")}


def mix_want(f, g, x):
    """Two-phase state by linear-in-quality mixing of saturation endpoints
    (the tool's convention; exact for pure fluids, mid-glide for blends)."""
    lerp = lambda a, b: a + x * (b - a)
    return {
        "T_C":   lerp(f["T"], g["T"]) - 273.15,
        "P_kPa": lerp(f["P"], g["P"]) / 1000.0,
        "h":     lerp(f["H"], g["H"]) / 1000.0,
        "s":     lerp(f["S"], g["S"]) / 1000.0,
        "u":     lerp(f["U"], g["U"]) / 1000.0,
        "rho":   1.0 / (x / g["D"] + (1 - x) / f["D"]),
    }


def props_cases(fluid_key, cfg, cp_name, T_crit_C, P_crit_kPa):
    """Standalone getProps checks at a low and a high reference pressure."""
    cases = []
    lo = max(0, cfg["T_min_C"] + 10)
    hi = min(40, T_crit_C - 15, cfg["T_max_C"] - 5)
    refs = sorted({lo, hi}) if hi > lo + 2 else [lo]

    for Tref_C in refs:
        P = CP.PropsSI("P", "T", K(Tref_C), "Q", 1, cp_name)  # Pdew at Tref
        P_kPa = P / 1000.0
        T_dew = CP.PropsSI("T", "P", P, "Q", 1, cp_name)
        T_bub = CP.PropsSI("T", "P", P, "Q", 0, cp_name)

        # superheated vapor — shallow to deep (between dT-grid rows)
        for dT in (3, 7, 22, 37):
            sh = state(cp_name, T=T_dew + dT, P=P)
            cases.append({"pair": "TP", "v1": sh["T_C"], "v2": P_kPa, "want": sh})
            if dT == 7:
                cases.append({"pair": "PH", "v1": P_kPa, "v2": sh["h"], "want": sh})
                cases.append({"pair": "PS", "v1": P_kPa, "v2": sh["s"], "want": sh})

        # subcooled liquid — shallow to deep (EOS limits skip gracefully)
        for dT in (1, 3, 13):
            try:
                sc = state(cp_name, T=T_bub - dT, P=P)
            except ValueError:
                continue
            cases.append({"pair": "TP", "v1": sc["T_C"], "v2": P_kPa, "want": sc})
            if dT == 3:
                cases.append({"pair": "PH", "v1": P_kPa, "v2": sc["h"], "want": sc})

        # two-phase: TQ at the reference temperature, PQ / wet-PS at Pdew
        fT = sat_side(cp_name, "T", K(Tref_C), 0)
        gT = sat_side(cp_name, "T", K(Tref_C), 1)
        for x in (0.25, 0.9):
            w = mix_want(fT, gT, x)
            w["T_C"] = Tref_C  # T is the independent variable
            cases.append({"pair": "TQ", "v1": Tref_C, "v2": x, "want": w})
        fP = sat_side(cp_name, "P", P, 0)
        gP = sat_side(cp_name, "P", P, 1)
        cases.append({"pair": "PQ", "v1": P_kPa, "v2": 0.5, "want": mix_want(fP, gP, 0.5)})
        wet = mix_want(fP, gP, 0.85)
        cases.append({"pair": "PS", "v1": P_kPa, "v2": wet["s"], "want": wet})

    # near-critical interpolation (between the 0.80/0.90·P_crit anchors) —
    # only where the table's pressure columns reach it; custom-composition
    # blends ("&" names) are excluded (their stored dew line near critical
    # comes from all_critical_points overrides, not plain PropsSI flashes)
    if 0.85 * P_crit_kPa <= cfg["P_max_kPa"] and "&" not in cp_name:
        try:
            Pnc = 0.85 * P_crit_kPa * 1000.0
            T_dew = CP.PropsSI("T", "P", Pnc, "Q", 1, cp_name)
            nc = state(cp_name, T=T_dew + 12, P=Pnc)
            cases.append({"pair": "TP", "v1": nc["T_C"], "v2": Pnc / 1000.0, "want": nc})
        except ValueError:
            pass

    return [{"fluid": fluid_key, **c} for c in cases]


def main():
    cycles = []
    props = []
    for key, cfg in FLUIDS.items():
        cp_name = cfg["cp_name"]
        T_crit_C, P_crit_kPa = resolve_crit(cfg)
        pairs = cycle_conditions(cfg, cp_name, T_crit_C, P_crit_kPa)
        base = baseline_condition(pairs)
        for Te, Tc in pairs:
            variants = CYCLE_VARIANTS + (BASELINE_VARIANTS if (Te, Tc) == base else [])
            for sh, sc in variants:
                w = cycle_truth(cp_name, Te, Tc, sh, sc)
                if w["T2"] - Tc > MAX_DISCHARGE_SH_K:
                    continue  # discharge superheat beyond the ΔT grid
                cycles.append({"fluid": key, "Te": Te, "Tc": Tc, "sh": sh, "sc": sc,
                               "want": w})
        Te, Tc = base
        # non-isentropic compression
        for eta, sh, sc in ETA_VARIANTS:
            cycles.append({"fluid": key, "Te": Te, "Tc": Tc, "sh": sh, "sc": sc, "eta": eta,
                           "want": cycle_truth(cp_name, Te, Tc, sh, sc, eta)})
        # pressure-specified superheat/subcool (same physical cycle as dT)
        w = cycle_truth(cp_name, Te, Tc, 10, 5)
        cycles.append({"fluid": key, "Te": Te, "Tc": Tc, "sh": 10, "sc": 5,
                       "sh_by": "P", "want": w})
        cycles.append({"fluid": key, "Te": Te, "Tc": Tc, "sh": 10, "sc": 5,
                       "sc_by": "P", "want": w})
        props.extend(props_cases(key, cfg, cp_name, T_crit_C, P_crit_kPa))
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
