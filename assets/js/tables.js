/**
 * tables.js — Property table backend for FrigProp (Plan B: precomputed tables).
 * Exports a single default object with the same interface as coolprop.js so
 * the two backends can be swapped without touching any other module.
 */

const TABLES_BASE = "./tables";

const _cache = new Map();  // fluidKey → { sat, superheat, subcool }
let _manifest = null;
let _currentFluid = null;
let _ready = false;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export default {
  async init(fluidKey) {
    if (!_manifest) {
      const res = await fetch(`${TABLES_BASE}/manifest.json`);
      if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
      _manifest = await res.json();
    }
    if (!_manifest.fluids[fluidKey]) {
      throw new Error(`Unknown fluid: ${fluidKey}`);
    }
    await _loadFluid(fluidKey);
    _currentFluid = fluidKey;
    _ready = true;
  },

  async getProps(inputPair, val1, val2) {
    _assertReady();
    return _getProps(_currentFluid, inputPair, val1, val2);
  },

  async getSatProps(inputType, value) {
    _assertReady();
    return _getSatProps(_currentFluid, inputType, value);
  },

  isReady() {
    return _ready;
  },

  getManifest() {
    return _manifest;
  },

  getFluidMeta(fluidKey) {
    return _manifest && _manifest.fluids[fluidKey];
  },

  getSatRows(fluidKey) {
    const key = fluidKey || _currentFluid;
    if (!key || !_cache.has(key)) return null;
    return _cache.get(key).sat.rows;
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _assertReady() {
  if (!_ready) throw new Error("Backend not initialized. Call init(fluidKey) first.");
}

async function _loadFluid(fluidKey) {
  if (_cache.has(fluidKey)) return;
  const base = `${TABLES_BASE}/${fluidKey}`;
  const [satRes, shRes, scRes] = await Promise.all([
    fetch(`${base}/sat.json`),
    fetch(`${base}/superheat.json`),
    fetch(`${base}/subcool.json`),
  ]);
  if (!satRes.ok || !shRes.ok || !scRes.ok) {
    throw new Error(`Failed to load tables for ${fluidKey}`);
  }
  const [sat, superheat, subcool] = await Promise.all([
    satRes.json(), shRes.json(), scRes.json(),
  ]);
  _cache.set(fluidKey, { sat, superheat, subcool });
}

// ---------------------------------------------------------------------------
// Saturation lookups
// ---------------------------------------------------------------------------

function _getSatProps(fluidKey, inputType, value) {
  const { sat } = _cache.get(fluidKey);
  const cols = sat.columns;
  const rows = sat.rows;

  let row;
  if (inputType === "T") {
    row = _interpSatByT(rows, value);
  } else if (inputType === "P") {
    row = _interpSatByP(rows, value);
  } else {
    throw new Error(`Unknown saturation input type: ${inputType}`);
  }

  return _satRowToState(cols, row);
}

function _satRowToState(cols, row) {
  const d = {};
  cols.forEach((c, i) => { d[c] = row[i]; });
  return {
    sat_T_C: d.T,
    sat_P_kPa: d.P_sat,
    hf: d.hf, hg: d.hg,
    sf: d.sf, sg: d.sg,
    rhof: d.rhof, rhog: d.rhog,
  };
}

function _interpSatByT(rows, T_C) {
  const n = rows.length;
  const T_min = rows[0][0];
  const T_max = rows[n - 1][0];
  if (T_C < T_min || T_C > T_max) {
    throw new Error(`Temperature ${T_C}°C out of saturation range [${T_min}, ${T_max}]`);
  }
  // Binary search for bracket
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= T_C) lo = mid; else hi = mid;
  }
  if (Math.abs(rows[lo][0] - T_C) < 1e-9) return rows[lo];
  if (Math.abs(rows[hi][0] - T_C) < 1e-9) return rows[hi];
  return _lerpRow(rows[lo], rows[hi], rows[lo][0], rows[hi][0], T_C);
}

function _interpSatByP(rows, P_kPa) {
  // P_sat is column index 1; monotonically increasing with T
  const n = rows.length;
  const P_min = rows[0][1];
  const P_max = rows[n - 1][1];
  if (P_kPa < P_min || P_kPa > P_max) {
    throw new Error(`Pressure ${P_kPa} kPa out of saturation range [${P_min.toFixed(2)}, ${P_max.toFixed(2)}]`);
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][1] <= P_kPa) lo = mid; else hi = mid;
  }
  if (Math.abs(rows[lo][1] - P_kPa) < 1e-9) return rows[lo];
  if (Math.abs(rows[hi][1] - P_kPa) < 1e-9) return rows[hi];
  return _lerpRow(rows[lo], rows[hi], rows[lo][1], rows[hi][1], P_kPa);
}

function _lerpRow(rowA, rowB, xA, xB, x) {
  const t = (x - xA) / (xB - xA);
  return rowA.map((a, i) => {
    const b = rowB[i];
    if (a === null || b === null) return null;
    return a + t * (b - a);
  });
}

// ---------------------------------------------------------------------------
// getProps — dispatch by input pair
// ---------------------------------------------------------------------------

function _getProps(fluidKey, inputPair, val1, val2) {
  switch (inputPair) {
    case "TQ": return _propsFromTQ(fluidKey, val1, val2);
    case "PQ": return _propsFromPQ(fluidKey, val1, val2);
    case "TP": return _propsFromTP(fluidKey, val1, val2);
    case "PH": return _propsFromPH(fluidKey, val1, val2);
    case "PS": return _propsFromPS(fluidKey, val1, val2);
    default: throw new Error(`Unsupported input pair: ${inputPair}`);
  }
}

// TQ — two-phase or saturated state
function _propsFromTQ(fluidKey, T_C, x) {
  const sat = _getSatProps(fluidKey, "T", T_C);
  const h = sat.hf + x * (sat.hg - sat.hf);
  const s = sat.sf + x * (sat.sg - sat.sf);
  const rho = 1 / (x / sat.rhog + (1 - x) / sat.rhof);
  return { T_C: sat.sat_T_C, P_kPa: sat.sat_P_kPa, h, s, rho, x };
}

// PQ — two-phase or saturated state from pressure
function _propsFromPQ(fluidKey, P_kPa, x) {
  const sat = _getSatProps(fluidKey, "P", P_kPa);
  const h = sat.hf + x * (sat.hg - sat.hf);
  const s = sat.sf + x * (sat.sg - sat.sf);
  const rho = 1 / (x / sat.rhog + (1 - x) / sat.rhof);
  return { T_C: sat.sat_T_C, P_kPa: sat.sat_P_kPa, h, s, rho, x };
}

// TP — superheated or subcooled single-phase
function _propsFromTP(fluidKey, T_C, P_kPa) {
  const { superheat, subcool } = _cache.get(fluidKey);

  // Determine phase relative to saturation
  let T_sat_C = null;
  try {
    const sat = _getSatProps(fluidKey, "P", P_kPa);
    T_sat_C = sat.sat_T_C;
  } catch (_) {
    // Pressure above critical — treat as supercritical
  }

  if (T_sat_C === null || T_C > T_sat_C + 0.1) {
    // Superheated (or supercritical)
    const result = _bilinear(superheat, T_C, P_kPa, "TP");
    if (result !== null) return { T_C, P_kPa, ...result, x: null };
    // Bilinear failed near sat boundary — use bridge
    let satData = null;
    try { satData = _getSatProps(fluidKey, "P", P_kPa); } catch (_) {}
    if (satData) {
      const bridged = _bridgeNearSat(superheat, satData, T_C, P_kPa);
      if (bridged) return bridged;
    }
    throw new Error(`T=${T_C}°C, P=${P_kPa} kPa is not in superheated region`);
  } else {
    // Subcooled
    const result = _bilinear(subcool, T_C, P_kPa, "TP");
    if (result === null) throw new Error(`T=${T_C}°C, P=${P_kPa} kPa is not in subcooled region`);
    return { T_C, P_kPa, ...result, x: null };
  }
}

// PH — find T by binary searching entropy is not needed; we search h in superheat
function _propsFromPH(fluidKey, P_kPa, h_target) {
  const { superheat, subcool } = _cache.get(fluidKey);

  // Check if in two-phase region
  let satRow = null;
  try {
    satRow = _getSatProps(fluidKey, "P", P_kPa);
  } catch (_) {}

  if (satRow) {
    if (h_target <= satRow.hf) {
      // Subcooled — search subcooled table along P column for h
      return _singlePhaseFromPH(subcool, P_kPa, h_target, fluidKey);
    } else if (h_target >= satRow.hg) {
      // Superheated
      return _singlePhaseFromPH(superheat, P_kPa, h_target, fluidKey);
    } else {
      // Two-phase
      const x = (h_target - satRow.hf) / (satRow.hg - satRow.hf);
      const s = satRow.sf + x * (satRow.sg - satRow.sf);
      const rho = 1 / (x / satRow.rhog + (1 - x) / satRow.rhof);
      return { T_C: satRow.sat_T_C, P_kPa, h: h_target, s, rho, x };
    }
  }

  // Above critical — supercritical, use superheat table
  return _singlePhaseFromPH(superheat, P_kPa, h_target, fluidKey);
}

function _singlePhaseFromPH(table, P_kPa, h_target, fluidKey) {
  // Find P column index (closest bracket)
  const P_vals = table.P_values_kPa;
  const jIdx = _findBracket(P_vals, P_kPa);
  if (jIdx === null) throw new Error(`P=${P_kPa} kPa out of table range`);

  // Search h column at both P brackets for T bracket, then bilinear
  const T_C = _findTFromH(table, P_kPa, h_target);
  if (T_C === null) throw new Error(`h=${h_target} kJ/kg out of range at P=${P_kPa} kPa`);

  const result = _bilinear(table, T_C, P_kPa, "TP");
  if (result !== null) return { T_C, P_kPa, ...result, x: null };
  // Bilinear failed — try near-sat bridge if this is the superheat table
  if (fluidKey && table.type === "superheat") {
    let satData = null;
    try { satData = _getSatProps(fluidKey, "P", P_kPa); } catch (_) {}
    if (satData) {
      const bridged = _bridgeNearSat(table, satData, T_C, P_kPa);
      if (bridged) return bridged;
    }
  }
  throw new Error(`State not found: T=${T_C}°C P=${P_kPa} kPa`);
}

function _findTFromH(table, P_kPa, h_target) {
  const T_vals = table.T_values_C;
  const P_vals = table.P_values_kPa;
  const h_grid = table.grid.h;

  const jPair = _findBracket(P_vals, P_kPa);
  if (jPair === null) return null;
  const [j0, j1] = jPair;
  const tP = j0 === j1 ? 0 : (P_kPa - P_vals[j0]) / (P_vals[j1] - P_vals[j0]);

  // Interpolate h at each T row at this P (single-column fallback near sat)
  const hAtP = T_vals.map((_, i) => {
    const h0 = h_grid[i][j0];
    const h1 = h_grid[i][j1];
    if (h0 === null && h1 === null) return null;
    if (h0 === null) return h1;
    if (h1 === null) return h0;
    return h0 + tP * (h1 - h0);
  });

  // Find T bracket where h crosses h_target
  for (let i = 0; i < T_vals.length - 1; i++) {
    const ha = hAtP[i];
    const hb = hAtP[i + 1];
    if (ha === null || hb === null) continue;
    if ((ha <= h_target && h_target <= hb) || (hb <= h_target && h_target <= ha)) {
      const t = (h_target - ha) / (hb - ha);
      return T_vals[i] + t * (T_vals[i + 1] - T_vals[i]);
    }
  }
  return null;
}

// PS — isentropic lookup: given P and s, find T and h
function _propsFromPS(fluidKey, P_kPa, s_target) {
  const { superheat } = _cache.get(fluidKey);

  let satRow = null;
  try { satRow = _getSatProps(fluidKey, "P", P_kPa); } catch (_) {}

  // Two-phase region
  if (satRow && s_target >= satRow.sf && s_target <= satRow.sg) {
    const x = (s_target - satRow.sf) / (satRow.sg - satRow.sf);
    const h = satRow.hf + x * (satRow.hg - satRow.hf);
    const rho = 1 / (x / satRow.rhog + (1 - x) / satRow.rhof);
    return { T_C: satRow.sat_T_C, P_kPa, h, s: s_target, rho, x };
  }

  // Superheated region
  const T_C = _findTFromS(superheat, P_kPa, s_target, fluidKey);
  if (T_C === null) throw new Error(`s=${s_target} kJ/kgK out of range at P=${P_kPa} kPa`);

  // Try bilinear first; fall back to near-sat bridge when corners are null
  const result = _bilinear(superheat, T_C, P_kPa, "TP");
  if (result !== null) return { T_C, P_kPa, ...result, x: null };

  if (satRow) {
    const bridged = _bridgeNearSat(superheat, satRow, T_C, P_kPa);
    if (bridged) return bridged;
  }
  throw new Error(`Superheated state not found: T=${T_C}°C P=${P_kPa} kPa`);
}

function _bridgeNearSat(superheat, satRow, T_C, P_kPa) {
  const T_vals = superheat.T_values_C;
  const P_vals = superheat.P_values_kPa;
  const T_sat = satRow.sat_T_C;

  const jPair = _findBracket(P_vals, P_kPa);
  if (!jPair) return null;
  const [j0, j1] = jPair;
  const tP = j0 === j1 ? 0 : (P_kPa - P_vals[j0]) / (P_vals[j1] - P_vals[j0]);

  // Find first T where BOTH j-columns are valid (proper bilinear anchor)
  let firstFullIdx = -1;
  for (let i = 0; i < T_vals.length; i++) {
    if (superheat.grid.h[i][j0] !== null && superheat.grid.h[i][j1] !== null) {
      firstFullIdx = i; break;
    }
  }
  if (firstFullIdx < 0) return null;

  const T_first = T_vals[firstFullIdx];
  const tBridge = T_first > T_sat ? (T_C - T_sat) / (T_first - T_sat) : 0;

  function interpFull(grid) {
    const v0 = grid[firstFullIdx][j0];
    const v1 = grid[firstFullIdx][j1];
    if (v0 === null || v1 === null) return null;
    return v0 + tP * (v1 - v0);
  }

  const h_first = interpFull(superheat.grid.h) ?? satRow.hg;
  const s_first = interpFull(superheat.grid.s) ?? satRow.sg;
  const r_first = interpFull(superheat.grid.rho) ?? satRow.rhog;

  return {
    T_C, P_kPa,
    h: satRow.hg + tBridge * (h_first - satRow.hg),
    s: satRow.sg + tBridge * (s_first - satRow.sg),
    rho: satRow.rhog + tBridge * (r_first - satRow.rhog),
    cp: null, x: null,
  };
}

function _findTFromS(table, P_kPa, s_target, fluidKey) {
  const T_vals = table.T_values_C;
  const P_vals = table.P_values_kPa;
  const s_grid = table.grid.s;

  const jPair = _findBracket(P_vals, P_kPa);
  if (jPair === null) return null;
  const [j0, j1] = jPair;
  const tP = j0 === j1 ? 0 : (P_kPa - P_vals[j0]) / (P_vals[j1] - P_vals[j0]);

  // Interpolate s at each T — use single column if the other is null
  const sAtP = T_vals.map((_, i) => {
    const s0 = s_grid[i][j0];
    const s1 = s_grid[i][j1];
    if (s0 === null && s1 === null) return null;
    if (s0 === null) return s1;
    if (s1 === null) return s0;
    return s0 + tP * (s1 - s0);
  });

  for (let i = 0; i < T_vals.length - 1; i++) {
    const sa = sAtP[i];
    const sb = sAtP[i + 1];
    if (sa === null || sb === null) continue;
    if ((sa <= s_target && s_target <= sb) || (sb <= s_target && s_target <= sa)) {
      const t = (s_target - sa) / (sb - sa);
      return T_vals[i] + t * (T_vals[i + 1] - T_vals[i]);
    }
  }

  // s_target below first valid entry — bridge from sat curve
  const firstValidIdx = sAtP.findIndex(v => v !== null);
  if (firstValidIdx < 0) return null;
  const s_first = sAtP[firstValidIdx];
  const T_first = T_vals[firstValidIdx];

  if (fluidKey) {
    try {
      const satRow = _getSatProps(fluidKey, "P", P_kPa);
      const sg = satRow.sg;
      const T_sat = satRow.sat_T_C;
      if ((sg <= s_target && s_target <= s_first) || (s_first <= s_target && s_target <= sg)) {
        const t = (s_target - sg) / (s_first - sg);
        return T_sat + t * (T_first - T_sat);
      }
    } catch (_) {}
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bilinear interpolation on T×P grid
// ---------------------------------------------------------------------------

function _bilinear(table, T_C, P_kPa, _mode) {
  const T_vals = table.T_values_C;
  const P_vals = table.P_values_kPa;

  const iPair = _findBracket(T_vals, T_C);
  const jPair = _findBracket(P_vals, P_kPa);
  if (iPair === null || jPair === null) return null;

  const [i0, i1] = iPair;
  const [j0, j1] = jPair;
  const tT = i0 === i1 ? 0 : (T_C - T_vals[i0]) / (T_vals[i1] - T_vals[i0]);
  const tP = j0 === j1 ? 0 : (P_kPa - P_vals[j0]) / (P_vals[j1] - P_vals[j0]);

  const result = {};
  for (const prop of table.properties) {
    const g = table.grid[prop];
    const v00 = g[i0][j0];
    const v01 = g[i0][j1];
    const v10 = g[i1][j0];
    const v11 = g[i1][j1];
    if (v00 === null || v01 === null || v10 === null || v11 === null) {
      return null;
    }
    result[prop] = (v00 * (1 - tT) + v10 * tT) * (1 - tP) +
                   (v01 * (1 - tT) + v11 * tT) * tP;
  }
  return result;
}

// Returns [lo, hi] index pair bracketing value, or null if out of range
function _findBracket(arr, value) {
  const n = arr.length;
  if (value < arr[0] || value > arr[n - 1]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid; else hi = mid;
  }
  return [lo, hi];
}
