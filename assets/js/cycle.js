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
 * @param {object} backend  — tables.js (or coolprop.js) instance
 * @param {object} inputs   — { T1_C, T3_C, superheat: bool, T1sh_C, P1sh_kPa,
 *                              subcool: bool, T3sc_C, P3sc_kPa }
 * @returns {Promise<object[]>} Array of 4 state objects
 */
export async function computeVCRCStates(backend, inputs) {
  const { T1_C, T3_C, superheat: shInlet, T1sh_C, P1sh_kPa,
          subcool: scExit, T3sc_C, P3sc_kPa } = inputs;

  // State 1 — compressor inlet
  let state1;
  if (shInlet) {
    state1 = await backend.getProps("TP", T1sh_C, P1sh_kPa);
  } else {
    state1 = await backend.getProps("TQ", T1_C, 1.0);
  }

  // State 3 — condenser exit
  let state3;
  if (scExit) {
    state3 = await backend.getProps("TP", T3sc_C, P3sc_kPa);
  } else {
    state3 = await backend.getProps("TQ", T3_C, 0.0);
  }

  const P_cond = state3.P_kPa;
  const P_evap = state1.P_kPa;

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
  const energy_balance_residual = Q_evap + W_comp - Q_cond;
  return { W_comp, Q_evap, Q_cond, COP_c, COP_h, energy_balance_residual };
}

/**
 * Sanity-check a set of 4 computed states.
 * @param {object[]} states
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateCycle(states) {
  const [s1, s2, s3, s4] = states;
  const warnings = [];

  if (s2.s < s1.s - 0.001) warnings.push("State 2 entropy < State 1 entropy (non-physical compression).");
  if (s2.h <= s1.h) warnings.push("Compressor work is zero or negative (h2 ≤ h1).");
  if (s3.h >= s2.h) warnings.push("Condenser shows no heat rejection (h3 ≥ h2).");
  if (Math.abs(s4.h - s3.h) > 0.1) warnings.push(`Expansion process is not isenthalpic (|h4−h3| = ${Math.abs(s4.h - s3.h).toFixed(3)} kJ/kg).`);
  if (s2.P_kPa <= s1.P_kPa) warnings.push("Condensing pressure is not higher than evaporating pressure.");
  if (s4.x !== null && (s4.x < 0 || s4.x > 1)) warnings.push(`Post-expansion quality out of range: x4 = ${s4.x !== null ? s4.x.toFixed(3) : 'N/A'}.`);

  const P_evap = s1.P_kPa;
  const P_cond = s2.P_kPa;
  if (P_cond / P_evap > 10) warnings.push(`Very high pressure ratio: ${(P_cond / P_evap).toFixed(1)}. Consider two-stage compression.`);

  return { valid: warnings.length === 0, warnings };
}
