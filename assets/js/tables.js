/**
 * tables.js — Property table backend for FrigProp (precomputed tables).
 * Exports a single default object; an alternative backend (e.g. CoolProp
 * WASM) implementing the same interface could be swapped in via app.js.
 *
 * Schema v2: single-phase grids are indexed by (ΔT from saturation, P), so the
 * grid is dense everywhere a cycle lives. Each table carries its own Tsat_C
 * per pressure column (dew line for superheat, bubble line for subcool).
 */

const TABLES_BASE = "./tables";
const SCHEMA_VERSION = 2;

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
      if (_manifest.schema_version !== SCHEMA_VERSION) {
        throw new Error(`Table schema ${_manifest.schema_version} ≠ expected ${SCHEMA_VERSION} — regenerate with scripts/generate_tables.py`);
      }
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
    row = _interpSatByP(fluidKey, value);
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
    uf: d.uf, ug: d.ug,
    // Bubble/dew per side; equal for pure fluids, differ (glide) for zeotropes.
    // Grid-bridged rows (near critical) carry explicit bubble/dew temps.
    T_bubble_C: row.T_bubble_C ?? d.T, T_dew_C: row.T_dew_C ?? d.T,
    P_bub_kPa: d.P_bub ?? d.P_sat, P_dew_kPa: d.P_dew ?? d.P_sat,
  };
}

function _interpSatByT(rows, T_C) {
  const n = rows.length;
  const T_min = rows[0][0];
  const T_max = rows[n - 1][0];
  if (T_C < T_min || T_C > T_max) {
    throw new Error(`Temperature ${T_C}°C out of saturation range [${T_min}, ${T_max}]`);
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= T_C) lo = mid; else hi = mid;
  }
  if (Math.abs(rows[lo][0] - T_C) < 1e-9) return rows[lo];
  if (Math.abs(rows[hi][0] - T_C) < 1e-9) return rows[hi];
  return _lerpRow(rows[lo], rows[hi], rows[lo][0], rows[hi][0], T_C);
}

/**
 * Saturation state by pressure. Prefers the ΔT-grids' ΔT=0 rows (exact
 * bubble/dew anchors per side — correct for zeotropic glide); falls back to
 * the fine sat table for pressures below the grid range.
 */
function _interpSatByP(fluidKey, P_kPa) {
  const bridged = _satRowFromGrids(fluidKey, P_kPa);
  if (bridged) return bridged;

  const { sat } = _cache.get(fluidKey);
  const rows = sat.rows;
  const n = rows.length;
  const P_min = rows[0][1];
  const P_max = rows[n - 1][1];

  if (P_kPa >= P_min && P_kPa <= P_max) {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rows[mid][1] <= P_kPa) lo = mid; else hi = mid;
    }
    if (Math.abs(rows[lo][1] - P_kPa) < 1e-9) return rows[lo];
    if (Math.abs(rows[hi][1] - P_kPa) < 1e-9) return rows[hi];
    return _lerpRow(rows[lo], rows[hi], rows[lo][1], rows[hi][1], P_kPa);
  }
  throw new Error(`Pressure ${P_kPa} kPa out of saturation range [${P_min.toFixed(2)}, ${P_max.toFixed(2)}]`);
}

/** Build a sat-table-shaped row from the ΔT=0 rows of both grids. */
function _satRowFromGrids(fluidKey, P_kPa) {
  const { superheat, subcool } = _cache.get(fluidKey);
  const g = _rowAtP(superheat, 0, P_kPa);   // saturated vapor (dew)
  const f = _rowAtP(subcool, 0, P_kPa);     // saturated liquid (bubble)
  if (!g || !f) return null;
  const T_dew = _interpTsat(superheat, P_kPa);
  const T_bub = _interpTsat(subcool, P_kPa);
  if (T_dew === null || T_bub === null) return null;
  // sat-table column order: T, P_sat, hf, hg, sf, sg, rhof, rhog, uf, ug, P_bub, P_dew
  const row = [(T_dew + T_bub) / 2, P_kPa, f.h, g.h, f.s, g.s, f.rho, g.rho, f.u, g.u, P_kPa, P_kPa];
  row.T_bubble_C = T_bub;
  row.T_dew_C = T_dew;
  return row;
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
// ΔT-grid primitives
// ---------------------------------------------------------------------------

/**
 * Interpolation parameter along the P axis in log space — s and Tsat are far
 * closer to linear in ln(P) than in P (Clausius–Clapeyron).
 */
function _tLogP(P_vals, j0, j1, P_kPa) {
  return j0 === j1 ? 0 : Math.log(P_kPa / P_vals[j0]) / Math.log(P_vals[j1] / P_vals[j0]);
}

/** Tsat (dew or bubble per table type) interpolated at P, or null. */
function _interpTsat(table, P_kPa) {
  const jPair = _findBracket(table.P_values_kPa, P_kPa);
  if (jPair === null) return null;
  const [j0, j1] = jPair;
  const t = _tLogP(table.P_values_kPa, j0, j1, P_kPa);
  return table.Tsat_C[j0] + t * (table.Tsat_C[j1] - table.Tsat_C[j0]);
}

/** All properties of one ΔT row interpolated at P, or null on null cells. */
function _rowAtP(table, rowIdx, P_kPa) {
  const jPair = _findBracket(table.P_values_kPa, P_kPa);
  if (jPair === null) return null;
  const [j0, j1] = jPair;
  const t = _tLogP(table.P_values_kPa, j0, j1, P_kPa);
  const out = {};
  for (const prop of table.properties) {
    const v0 = table.grid[prop][rowIdx][j0];
    const v1 = table.grid[prop][rowIdx][j1];
    if (v0 === null || v1 === null) return null;
    out[prop] = _lerpProp(prop, v0, v1, t);
  }
  return out;
}

/** ρ scales ~P along an isotherm — interpolate it geometrically in P. */
function _lerpProp(prop, v0, v1, t) {
  if (prop === "rho" && v0 > 0 && v1 > 0) {
    return v0 * Math.pow(v1 / v0, t);
  }
  return v0 + t * (v1 - v0);
}

/** Bilinear interpolation at (ΔT, P). Throws with the valid range on miss. */
function _gridLookup(table, dT, P_kPa) {
  const dT_vals = table.dT_values_K;
  const P_vals = table.P_values_kPa;
  const iPair = _findBracket(dT_vals, dT);
  if (iPair === null) {
    throw new Error(`ΔT ${dT.toFixed(1)} K from saturation out of ${table.type} range [0, ${dT_vals[dT_vals.length - 1]}] K`);
  }
  const jPair = _findBracket(P_vals, P_kPa);
  if (jPair === null) {
    throw new Error(`P=${P_kPa} kPa out of ${table.type} range [${P_vals[0]}, ${P_vals[P_vals.length - 1]}] kPa`);
  }
  const [i0, i1] = iPair;
  const [j0, j1] = jPair;
  const tT = i0 === i1 ? 0 : (dT - dT_vals[i0]) / (dT_vals[i1] - dT_vals[i0]);
  const tP = _tLogP(P_vals, j0, j1, P_kPa);

  const result = {};
  for (const prop of table.properties) {
    const g = table.grid[prop];
    const v00 = g[i0][j0], v01 = g[i0][j1], v10 = g[i1][j0], v11 = g[i1][j1];
    if (v00 === null || v01 === null || v10 === null || v11 === null) {
      throw new Error(`State ΔT=${dT.toFixed(1)} K, P=${P_kPa} kPa outside ${table.type} table coverage`);
    }
    // linear in ΔT, then property-appropriate interpolation in P
    const a = v00 + tT * (v10 - v00);
    const b = v01 + tT * (v11 - v01);
    result[prop] = _lerpProp(prop, a, b, tP);
  }
  return result;
}

/**
 * Invert prop(ΔT) at fixed P: find ΔT where the property crosses `target`.
 * Property profiles along ΔT are monotone for h/s in each region.
 */
function _findDTFromProp(table, prop, P_kPa, target) {
  const dT_vals = table.dT_values_K;
  const vals = dT_vals.map((_, i) => {
    const row = _rowAtP(table, i, P_kPa);
    return row ? row[prop] : null;
  });
  for (let i = 0; i < dT_vals.length - 1; i++) {
    const a = vals[i], b = vals[i + 1];
    if (a === null || b === null) continue;
    if ((a <= target && target <= b) || (b <= target && target <= a)) {
      const t = b === a ? 0 : (target - a) / (b - a);
      return dT_vals[i] + t * (dT_vals[i + 1] - dT_vals[i]);
    }
  }
  return null;
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

function _mixState(sat, x, P_kPa) {
  const h = sat.hf + x * (sat.hg - sat.hf);
  const s = sat.sf + x * (sat.sg - sat.sf);
  const u = (sat.uf !== undefined && sat.uf !== null) ? sat.uf + x * (sat.ug - sat.uf) : null;
  const rho = 1 / (x / sat.rhog + (1 - x) / sat.rhof);
  // T across the dome: lerp bubble→dew (captures zeotropic glide)
  const Tb = sat.T_bubble_C ?? sat.sat_T_C;
  const Td = sat.T_dew_C ?? sat.sat_T_C;
  const T_C = Tb + x * (Td - Tb);
  return { T_C, P_kPa: P_kPa ?? sat.sat_P_kPa, h, s, u, rho, cp: null, x };
}

// TQ — two-phase or saturated state
function _propsFromTQ(fluidKey, T_C, x) {
  const sat = _getSatProps(fluidKey, "T", T_C);
  // P across the glide: bubble at x=0 → dew at x=1 (equal for pure fluids)
  const P = sat.P_bub_kPa + x * (sat.P_dew_kPa - sat.P_bub_kPa);
  const st = _mixState(sat, x, P);
  st.T_C = T_C;  // T is the independent variable here
  return st;
}

// PQ — two-phase or saturated state from pressure
function _propsFromPQ(fluidKey, P_kPa, x) {
  const sat = _getSatProps(fluidKey, "P", P_kPa);
  return _mixState(sat, x, P_kPa);
}

// TP — superheated or subcooled single-phase
function _propsFromTP(fluidKey, T_C, P_kPa) {
  const { superheat, subcool } = _cache.get(fluidKey);

  const T_dew = _interpTsat(superheat, P_kPa);
  const T_bub = _interpTsat(subcool, P_kPa);
  if (T_dew === null || T_bub === null) {
    const P = superheat.P_values_kPa;
    throw new Error(`P=${P_kPa} kPa out of table range [${P[0]}, ${P[P.length - 1]}] kPa`);
  }

  if (T_C >= T_dew - 0.01) {
    const dT = Math.max(0, T_C - T_dew);
    const r = _gridLookup(superheat, dT, P_kPa);
    return { T_C, P_kPa, ...r, x: null };
  }
  if (T_C <= T_bub + 0.01) {
    const dT = Math.max(0, T_bub - T_C);
    const r = _gridLookup(subcool, dT, P_kPa);
    return { T_C, P_kPa, ...r, x: null };
  }
  throw new Error(`T=${T_C}°C, P=${P_kPa} kPa is two-phase (Tsat ≈ ${T_dew.toFixed(2)}°C) — use quality input (TQ/PQ)`);
}

// PH — single-phase or two-phase state from pressure + enthalpy
function _propsFromPH(fluidKey, P_kPa, h_target) {
  return _propsFromPX(fluidKey, P_kPa, h_target, "h");
}

// PS — single-phase or two-phase state from pressure + entropy
function _propsFromPS(fluidKey, P_kPa, s_target) {
  return _propsFromPX(fluidKey, P_kPa, s_target, "s");
}

/** Shared PH/PS solver; `prop` is "h" or "s". */
function _propsFromPX(fluidKey, P_kPa, target, prop) {
  const { superheat, subcool } = _cache.get(fluidKey);
  const sat = _getSatProps(fluidKey, "P", P_kPa);
  const f = prop === "h" ? sat.hf : sat.sf;
  const g = prop === "h" ? sat.hg : sat.sg;
  const unit = prop === "h" ? "kJ/kg" : "kJ/kgK";

  if (target >= f && target <= g) {
    const x = (target - f) / (g - f);
    const st = _mixState(sat, x, P_kPa);
    st[prop] = target;
    return st;
  }

  const table = target > g ? superheat : subcool;
  const dT = _findDTFromProp(table, prop, P_kPa, target);
  if (dT === null) {
    throw new Error(`${prop}=${target.toFixed(3)} ${unit} out of ${table.type} range at P=${P_kPa} kPa`);
  }
  const r = _gridLookup(table, dT, P_kPa);
  const Tsat = _interpTsat(table, P_kPa);
  const T_C = table.type === "superheat" ? Tsat + dT : Tsat - dT;
  const st = { T_C, P_kPa, ...r, x: null };
  st[prop] = target;  // the independent variable is exact by construction
  return st;
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

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
