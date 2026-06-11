/**
 * cycle.js — Stateless VCRC analysis. No DOM access.
 *
 * VCRC state conventions:
 *   State 1 — compressor inlet (sat. vapor or superheated)
 *   State 2 — compressor exit (isentropic: P_cond, s=s1)
 *   State 3 — condenser exit (sat. liquid or subcooled)
 *   State 4 — expansion exit (isenthalpic: P_evap, h=h3)
 */

export async function solveState(backend, inputPair, val1, val2) {
  return backend.getProps(inputPair, val1, val2);
}

/**
 * Compute the four VCRC states from user inputs.
 * Superheat/subcool are specified either as ΔT from saturation (pressures
 * derived internally: dew pressure at T_evap, bubble pressure at T_cond) or
 * as an explicit pressure (T1/T3 then are the actual state temperatures).
 * @param {object} backend  — property backend (tables.js)
 * @param {object} inputs   — { T1_C, T3_C,
 *                              superheat: bool, sh_by: "dT"|"P", dT_sh_K, P_evap_kPa,
 *                              subcool: bool,  sc_by: "dT"|"P", dT_sc_K, P_cond_kPa,
 *                              eta_isen: 0–1 (default 1, isentropic) }
 * @returns {Promise<object[]>} Array of 4 state objects
 */
export async function computeVCRCStates(backend, inputs) {
  const { T1_C, T3_C, superheat: shInlet, dT_sh_K, subcool: scExit, dT_sc_K } = inputs;
  const eta = inputs.eta_isen > 0 && inputs.eta_isen < 1 ? inputs.eta_isen : 1;

  // State 1 — compressor inlet (sat. vapor unless superheated)
  let state1, P_evap;
  if (shInlet && inputs.sh_by === "P") {
    P_evap = inputs.P_evap_kPa;
    const sat = await backend.getSatProps("P", P_evap);
    if (T1_C < sat.T_dew_C - 0.01) {
      throw new Error(`Inlet T=${T1_C.toFixed(1)}°C is below saturation at P=${P_evap.toFixed(0)} kPa ` +
                      `(T_dew=${sat.T_dew_C.toFixed(1)}°C) — a superheated inlet must be at or above it`);
    }
    state1 = T1_C > sat.T_dew_C + 0.01
      ? await backend.getProps("TP", T1_C, P_evap)
      : await backend.getProps("PQ", P_evap, 1.0);
  } else {
    const satVap = await backend.getProps("TQ", T1_C, 1.0);
    P_evap = satVap.P_kPa;
    state1 = (shInlet && dT_sh_K > 0)
      ? await backend.getProps("TP", T1_C + dT_sh_K, P_evap)
      : satVap;
  }

  // State 3 — condenser exit (sat. liquid unless subcooled)
  let state3, P_cond;
  if (scExit && inputs.sc_by === "P") {
    P_cond = inputs.P_cond_kPa;
    const sat = await backend.getSatProps("P", P_cond);
    if (T3_C > sat.T_bubble_C + 0.01) {
      throw new Error(`Exit T=${T3_C.toFixed(1)}°C is above saturation at P=${P_cond.toFixed(0)} kPa ` +
                      `(T_bubble=${sat.T_bubble_C.toFixed(1)}°C) — a subcooled exit must be at or below it`);
    }
    state3 = T3_C < sat.T_bubble_C - 0.01
      ? await backend.getProps("TP", T3_C, P_cond)
      : await backend.getProps("PQ", P_cond, 0.0);
  } else {
    const satLiq = await backend.getProps("TQ", T3_C, 0.0);
    P_cond = satLiq.P_kPa;
    state3 = (scExit && dT_sc_K > 0)
      ? await backend.getProps("TP", T3_C - dT_sc_K, P_cond)
      : satLiq;
  }

  // State 2 — compression to P_cond: isentropic, then η-corrected via h
  let state2 = await backend.getProps("PS", P_cond, state1.s);
  if (eta < 1) {
    const h2 = state1.h + (state2.h - state1.h) / eta;
    state2 = await backend.getProps("PH", P_cond, h2);
  }

  // State 4 — isenthalpic expansion to P_evap
  const state4 = await backend.getProps("PH", P_evap, state3.h);

  return [state1, state2, state3, state4];
}

/**
 * Sample the true constant-h expansion path 3→4 for diagram overlays.
 * Points are log-spaced in P between the two states; points the tables
 * cannot resolve are skipped (the endpoints always anchor the curve).
 * @returns {Promise<{T_C: number, P_kPa: number, h: number, s: number}[]>}
 */
export async function expansionPath(backend, state3, state4, nPoints = 15) {
  const pts = [{ T_C: state3.T_C, P_kPa: state3.P_kPa, h: state3.h, s: state3.s }];
  const ratio = state4.P_kPa / state3.P_kPa;
  for (let i = 1; i < nPoints; i++) {
    const P = state3.P_kPa * Math.pow(ratio, i / nPoints);
    try {
      const st = await backend.getProps("PH", P, state3.h);
      pts.push({ T_C: st.T_C, P_kPa: P, h: st.h, s: st.s });
    } catch (_) { /* outside table coverage — straight segment bridges the gap */ }
  }
  pts.push({ T_C: state4.T_C, P_kPa: state4.P_kPa, h: state4.h, s: state4.s });
  return pts;
}

/**
 * Compute cycle performance from 4 state objects.
 * @param {object[]} states  — [state1, state2, state3, state4]
 */
export function analyzeVCRC(states) {
  const [s1, s2, s3, s4] = states;
  const W_comp = s2.h - s1.h;
  const Q_evap = s1.h - s4.h;
  const Q_cond = s2.h - s3.h;
  const COP_c = Q_evap / W_comp;
  const COP_h = Q_cond / W_comp;
  const P_ratio = s2.P_kPa / s1.P_kPa;
  const T_discharge_C = s2.T_C;
  return { W_comp, Q_evap, Q_cond, COP_c, COP_h, P_ratio, T_discharge_C };
}

/**
 * Sanity-check a set of 4 computed states.
 * @param {object[]} states
 * @returns {{ valid: boolean, warnings: string[], notes: string[] }}
 */
export function validateCycle(states) {
  const [s1, s2, s3, s4] = states;
  const warnings = [];
  const notes = [];

  if (s2.h <= s1.h) warnings.push("Compressor work is zero or negative (h2 ≤ h1).");
  if (s3.h >= s2.h) warnings.push("Condenser shows no heat rejection (h3 ≥ h2).");
  if (Math.abs(s4.h - s3.h) > 0.1) warnings.push(`Expansion process is not isenthalpic (|h4−h3| = ${Math.abs(s4.h - s3.h).toFixed(3)} kJ/kg).`);
  if (s2.P_kPa <= s1.P_kPa) warnings.push("Condensing pressure is not higher than evaporating pressure.");
  if (s4.x !== null && (s4.x < 0 || s4.x > 1)) warnings.push(`Post-expansion quality out of range: x4 = ${s4.x !== null ? s4.x.toFixed(3) : 'N/A'}.`);

  // Dry fluids (R600a, R1234yf, …): isentropic compression from saturated
  // vapor genuinely ends inside the dome — informational, not an error.
  if (s2.x !== null && s2.x < 1) {
    notes.push(`Isentropic compression ends two-phase for this fluid (x2 = ${s2.x.toFixed(3)}). ` +
               `Real systems avoid wet compression with suction superheat.`);
  }

  const P_evap = s1.P_kPa;
  const P_cond = s2.P_kPa;
  if (P_cond / P_evap > 10) warnings.push(`Very high pressure ratio: ${(P_cond / P_evap).toFixed(1)}. Consider two-stage compression.`);

  return { valid: warnings.length === 0, warnings, notes };
}
