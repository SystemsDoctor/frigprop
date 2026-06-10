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
 * Superheat/subcool are specified as ΔT from saturation; pressures are
 * derived internally (dew pressure at T_evap, bubble pressure at T_cond).
 * @param {object} backend  — property backend (tables.js)
 * @param {object} inputs   — { T1_C, T3_C, superheat: bool, dT_sh_K,
 *                              subcool: bool, dT_sc_K }
 * @returns {Promise<object[]>} Array of 4 state objects
 */
export async function computeVCRCStates(backend, inputs) {
  const { T1_C, T3_C, superheat: shInlet, dT_sh_K, subcool: scExit, dT_sc_K } = inputs;

  // State 1 — compressor inlet at evaporator (dew) pressure
  const satVap = await backend.getProps("TQ", T1_C, 1.0);
  const state1 = (shInlet && dT_sh_K > 0)
    ? await backend.getProps("TP", T1_C + dT_sh_K, satVap.P_kPa)
    : satVap;

  // State 3 — condenser exit at condenser (bubble) pressure
  const satLiq = await backend.getProps("TQ", T3_C, 0.0);
  const state3 = (scExit && dT_sc_K > 0)
    ? await backend.getProps("TP", T3_C - dT_sc_K, satLiq.P_kPa)
    : satLiq;

  const P_cond = satLiq.P_kPa;
  const P_evap = satVap.P_kPa;

  // State 2 — isentropic compression to P_cond
  const state2 = await backend.getProps("PS", P_cond, state1.s);

  // State 4 — isenthalpic expansion to P_evap
  const state4 = await backend.getProps("PH", P_evap, state3.h);

  return [state1, state2, state3, state4];
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
  return { W_comp, Q_evap, Q_cond, COP_c, COP_h };
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
