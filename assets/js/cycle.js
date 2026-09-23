/**
 * cycle.js — Stateless VCRC analysis. No DOM access.
 *
 * VCRC state conventions:
 *   State 1 — compressor inlet (sat. vapor or superheated)
 *   State 2 — compressor exit (isentropic: P_cond, s=s1)
 *   State 3 — condenser exit (sat. liquid or subcooled)
 *   State 4 — expansion exit (isenthalpic: P_evap, h=h3)
 */

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
 * Glide-aware coil temperature profiles. The evaporator boils from the
 * two-phase inlet (state 4) up to the dew point at P_evap; the condenser
 * condenses from the dew point down to the bubble point at P_cond. For pure
 * fluids and azeotropes the glides are ~0 and the mean equals T_sat.
 * When the cycle was specified by temperature (not pressure) the evaporator
 * dew and condenser bubble points are the inputs themselves, exactly.
 * @param {object}   backend — property backend (tables.js), on this fluid
 * @param {object[]} states  — [state1, state2, state3, state4]
 * @param {object}   [inputs] — the computeVCRCStates inputs
 * @returns {Promise<{evap: {P_kPa, T_in_C, T_dew_C, T_mean_C, glide_K},
 *                    cond: {P_kPa, T_dew_C, T_bub_C, T_mean_C, glide_K}}>}
 */
export async function coilProfiles(backend, states, inputs = {}) {
  const [s1, s2, , s4] = states;
  const e = await backend.getSatProps("P", s1.P_kPa);
  const c = await backend.getSatProps("P", s2.P_kPa);
  const shByP = inputs.superheat && inputs.sh_by === "P";
  const scByP = inputs.subcool && inputs.sc_by === "P";
  const eDew = !shByP && Number.isFinite(inputs.T1_C) ? inputs.T1_C : e.T_dew_C;
  const cBub = !scByP && Number.isFinite(inputs.T3_C) ? inputs.T3_C : c.T_bubble_C;
  return {
    evap: {
      P_kPa: s1.P_kPa, T_in_C: s4.T_C, T_dew_C: eDew,
      T_mean_C: (s4.T_C + eDew) / 2, glide_K: eDew - s4.T_C,
    },
    cond: {
      P_kPa: s2.P_kPa, T_dew_C: c.T_dew_C, T_bub_C: cBub,
      T_mean_C: (c.T_dew_C + cBub) / 2, glide_K: c.T_dew_C - cBub,
    },
  };
}

/**
 * Advanced Tools metrics derived from a computed cycle (they never alter it).
 * - Volumetric: cooling per m³ of suction gas q_vol = ρ1·q_evap, and the
 *   swept volume per kW of cooling 3600/q_vol (100 % volumetric efficiency).
 * - Carnot: reversible COPs between the refrigerant's mean evaporating and
 *   condensing temperatures (coil means — for glide blends the arithmetic
 *   mean across each coil); second-law efficiency η_II = COP / COP_Carnot.
 * - Capacity (optional, kW of cooling): mass flow Q/q_evap, compressor power,
 *   condenser heat rejection and required displacement.
 * @param {object[]} states  — [state1, state2, state3, state4]
 * @param {object}   metrics — analyzeVCRC() result
 * @param {object}   coils   — coilProfiles() result
 * @param {number|null} [capacity_kW]
 */
export function advancedMetrics(states, metrics, coils, capacity_kW = null) {
  const rho1 = states[0].rho;
  const q_vol = rho1 * metrics.Q_evap;
  const T_L = coils.evap.T_mean_C + 273.15;
  const T_H = coils.cond.T_mean_C + 273.15;
  const COP_carnot_c = T_L / (T_H - T_L);
  const COP_carnot_h = T_H / (T_H - T_L);
  let capacity = null;
  if (capacity_kW > 0) {
    const m_dot = capacity_kW / metrics.Q_evap;
    capacity = {
      Q_evap_kW: capacity_kW, m_dot_kg_s: m_dot,
      W_kW: m_dot * metrics.W_comp, Q_cond_kW: m_dot * metrics.Q_cond,
      V_disp_m3_h: m_dot / rho1 * 3600,
    };
  }
  return {
    q_vol_kJ_m3: q_vol, disp_spec_m3_h_kW: 3600 / q_vol,
    T_L_C: T_L - 273.15, T_H_C: T_H - 273.15,
    COP_carnot_c, COP_carnot_h,
    eta_II_c: metrics.COP_c / COP_carnot_c, eta_II_h: metrics.COP_h / COP_carnot_h,
    capacity,
  };
}

// ---------------------------------------------------------------------------
// Diagram support — iso-lines and diagram-point inversion
// ---------------------------------------------------------------------------

/** n+1 points from a to b, log-spaced (both > 0). */
function _logSpace(a, b, n) {
  return Array.from({ length: n + 1 }, (_, i) => a * Math.pow(b / a, i / n));
}

/** Resolve a list of lookups, dropping those the tables cannot answer. */
async function _tryAll(calls) {
  const out = [];
  for (const call of calls) {
    try {
      const st = await call();
      out.push({ T_C: st.T_C, P_kPa: st.P_kPa, h: st.h, s: st.s });
    } catch (_) { /* outside table coverage — the line just ends there */ }
  }
  return out;
}

/**
 * Sample background iso-lines for the diagrams through the backend.
 * Isobars (T-s): compressed liquid → two-phase shelf → superheated vapor.
 * Isotherms (P-h): compressed liquid (high P) → two-phase → vapor (low P);
 * above the saturation range an isotherm is vapor only.
 * @param {object}   backend      — property backend, on the fluid to draw
 * @param {number[]} pressures_kPa — isobar values
 * @param {number[]} temps_C       — isotherm values
 * @param {{T_lo_C: number, T_hi_C: number, P_lo_kPa: number, P_hi_kPa: number}} range
 * @returns {Promise<{isobars: {value: number, pts: object[]}[], isotherms: {value: number, pts: object[]}[]}>}
 */
export async function isoLines(backend, pressures_kPa, temps_C, range) {
  const Q = [0, 0.25, 0.5, 0.75, 1];
  const isobars = [];
  for (const P of pressures_kPa) {
    let sat;
    try { sat = await backend.getSatProps("P", P); } catch (_) { continue; }
    const T0 = Math.max(range.T_lo_C, sat.T_bubble_C - 40);  // subcool grid reach
    const Tliq = Array.from({ length: 5 }, (_, i) => T0 + i / 5 * (sat.T_bubble_C - T0));
    const Tvap = Array.from({ length: 12 }, (_, i) =>
      sat.T_dew_C + (i + 1) / 12 * Math.max(0, range.T_hi_C - sat.T_dew_C));
    const pts = await _tryAll([
      ...Tliq.map(T => () => backend.getProps("TP", T, P)),
      ...Q.map(x => () => backend.getProps("PQ", P, x)),
      ...Tvap.map(T => () => backend.getProps("TP", T, P)),
    ]);
    if (pts.length > 1) isobars.push({ value: P, pts });
  }

  const isotherms = [];
  for (const T of temps_C) {
    let sat = null;
    try { sat = await backend.getSatProps("T", T); } catch (_) { /* above the dome */ }
    const calls = [];
    if (sat) {
      if (range.P_hi_kPa > sat.P_bub_kPa) {
        calls.push(..._logSpace(range.P_hi_kPa, sat.P_bub_kPa, 6).slice(0, -1)
          .map(P => () => backend.getProps("TP", T, P)));
      }
      calls.push(...Q.map(x => () => backend.getProps("TQ", T, x)));
      if (sat.P_dew_kPa > range.P_lo_kPa) {
        calls.push(..._logSpace(sat.P_dew_kPa, range.P_lo_kPa, 12).slice(1)
          .map(P => () => backend.getProps("TP", T, P)));
      }
    } else {
      calls.push(..._logSpace(range.P_hi_kPa, range.P_lo_kPa, 16)
        .map(P => () => backend.getProps("TP", T, P)));
    }
    const pts = await _tryAll(calls);
    if (pts.length > 1) isotherms.push({ value: T, pts });
  }
  return { isobars, isotherms };
}

/**
 * Lookup inputs for a point picked on the T-s diagram: T & quality inside
 * the dome, otherwise T & P with P solved (log-bisection) so s(T, P) = s.
 * @param {object} backend
 * @param {number} T_C
 * @param {number} s — kJ/kg·K
 * @param {{P_lo_kPa: number, P_hi_kPa: number}} range — tabulated P extent
 * @returns {Promise<{pair: "TQ"|"TP", v1: number, v2: number}>}
 */
export async function lookupFromTS(backend, T_C, s, range) {
  let sat = null;
  try { sat = await backend.getSatProps("T", T_C); } catch (_) { /* above the dome */ }
  if (sat && s >= sat.sf && s <= sat.sg) {
    return { pair: "TQ", v1: T_C, v2: (s - sat.sf) / (sat.sg - sat.sf) };
  }
  // superheated vapor lies at P below the dew pressure, compressed liquid
  // above the bubble pressure. "near" is the saturation side, "far" the
  // table edge, pulled in until the tables resolve it.
  const vapor = !sat || s > sat.sg;
  let near = vapor ? (sat ? sat.P_dew_kPa : range.P_hi_kPa) : sat.P_bub_kPa;
  let far = vapor ? range.P_lo_kPa : range.P_hi_kPa;
  const sAt = async P => (await backend.getProps("TP", T_C, P)).s;
  let sFar = NaN;
  for (let i = 0; i < 20 && Number.isNaN(sFar); i++) {
    try { sFar = await sAt(far); } catch (_) { far = Math.sqrt(far * near); }
  }
  // s falls with P along an isotherm
  if (!(vapor ? s <= sFar : s >= sFar)) {
    throw new Error(`No tabulated state at T = ${T_C.toFixed(1)} °C, s = ${s.toFixed(3)} kJ/kg·K — ` +
                    `outside the table coverage (${range.P_lo_kPa.toFixed(0)}–${range.P_hi_kPa.toFixed(0)} kPa, ` +
                    `≤ 40 K subcooling)`);
  }
  for (let i = 0; i < 40; i++) {
    const mid = Math.sqrt(near * far);
    let sMid;
    // the grid's saturation line can sit a hair off the sat table's —
    // an unresolvable point next to it is on the saturation side
    try { sMid = await sAt(mid); } catch (_) { near = mid; continue; }
    if ((sMid > s) === vapor) far = mid; else near = mid;
  }
  return { pair: "TP", v1: T_C, v2: Math.sqrt(near * far) };
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
