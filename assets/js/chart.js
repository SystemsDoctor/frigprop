/**
 * chart.js — T-s and P-h diagrams for FrigProp.
 * Requires Chart.js 4.x loaded as a global (window.Chart) before this runs.
 * Data stays in SI internally; axis ticks/tooltips convert via units.js.
 * Pure rendering: states/paths are computed upstream (cycle.js via app.js).
 */

import * as units from "./units.js";

// Primary fluid keeps the classic palette; the comparison fluid gets its own.
const PALETTES = [
  { dome: 'rgba(0,212,255,0.70)',  cycle: '#ff6b35', cycleLine: 'rgba(255,107,53,0.75)' },
  { dome: 'rgba(168,130,230,0.65)', cycle: '#39e58c', cycleLine: 'rgba(57,229,140,0.70)' },
];

const STYLE = {
  bg:      '#0a0e14',
  grid:    'rgba(30,45,61,0.9)',
  tick:    '#5a7a94',
  label:   '#5a7a94',
  tooltip: { bg: 'rgba(11,17,26,0.96)', border: '#1e2d3d', title: '#eaf4ff', body: '#c8d8e8' },
  font:    "'IBM Plex Mono', monospace",
};

// mode → axis mapping (SI kinds) and point pickers
const MODES = {
  ts: {
    x: { kind: 's', title: 's', decimals: 2 },
    y: { kind: 'T', title: 'T', decimals: 0, log: false },
    pt: st => ({ x: st.s, y: st.T_C }),
  },
  ph: {
    x: { kind: 'h', title: 'h', decimals: 0 },
    y: { kind: 'P', title: 'P', decimals: 0, log: true },
    pt: st => ({ x: st.h, y: st.P_kPa }),
  },
};

let _chart    = null;
let _canvas   = null;
let _mode     = 'ts';
let _primary  = null;   // { label, satRows, states, expPath }
let _compare  = null;   // same shape, or null
let _marker   = null;   // full lookup state, or null
let _bounds   = null;   // natural bounds for the current mode/data

const MARKER_LABEL = '_lookup';

// Pan state
let _drag   = false;
let _lastX  = 0;
let _lastY  = 0;
let _touchX = 0;
let _touchY = 0;

// Solid background so exported PNGs are not transparent
const _bgPlugin = {
  id: 'frigprop-bg',
  beforeDraw(chart) {
    const ctx = chart.ctx;
    ctx.save();
    ctx.fillStyle = STYLE.bg;
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initCharts() {
  _canvas = document.getElementById('ts-chart');
  if (!_canvas) return;

  _canvas.style.cursor = 'grab';

  // Mouse pan
  _canvas.addEventListener('mousedown', e => {
    _drag  = true;
    _lastX = e.clientX;
    _lastY = e.clientY;
    _canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!_drag || !_chart) return;
    _applyPan(e.clientX - _lastX, e.clientY - _lastY);
    _lastX = e.clientX;
    _lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => {
    _drag = false;
    if (_canvas) _canvas.style.cursor = 'grab';
  });

  // Touch pan (single-finger)
  _canvas.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    _drag  = true;
    _touchX = e.touches[0].clientX;
    _touchY = e.touches[0].clientY;
  }, { passive: true });
  _canvas.addEventListener('touchmove', e => {
    if (!_drag || !_chart || e.touches.length !== 1) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - _touchX;
    const dy = e.touches[0].clientY - _touchY;
    _applyPan(dx, dy);
    _touchX = e.touches[0].clientX;
    _touchY = e.touches[0].clientY;
  }, { passive: false });
  _canvas.addEventListener('touchend', () => { _drag = false; });

  // Recenter / zoom / export buttons
  const btn = document.getElementById('ts-recenter-btn');
  if (btn) btn.addEventListener('click', resetView);
  const zin  = document.getElementById('ts-zoom-in-btn');
  const zout = document.getElementById('ts-zoom-out-btn');
  if (zin)  zin.addEventListener('click', () => _zoom(0.8));
  if (zout) zout.addEventListener('click', () => _zoom(1.25));
  const png = document.getElementById('chart-png-btn');
  if (png) png.addEventListener('click', downloadPNG);

  // T-s / P-h tabs
  for (const m of ['ts', 'ph']) {
    const tab = document.getElementById(`chart-tab-${m}`);
    if (tab) tab.addEventListener('click', () => setChartMode(m));
  }
}

/** Switch between the T-s and P-h diagrams (rebuilds at natural bounds). */
export function setChartMode(mode) {
  if (!MODES[mode] || mode === _mode) return;
  _mode = mode;
  for (const m of ['ts', 'ph']) {
    const tab = document.getElementById(`chart-tab-${m}`);
    if (tab) {
      tab.classList.toggle('active', m === mode);
      tab.setAttribute('aria-selected', m === mode ? 'true' : 'false');
    }
  }
  _rebuild();
}

export function getChartMode() {
  return _mode;
}

/**
 * Render or update the diagram. Always resets to natural view bounds.
 * @param {object}      primary  — { label, satRows, states|null, expPath|null }
 * @param {object|null} compare  — same shape for the comparison fluid
 */
export function updateCharts(primary, compare) {
  _primary = primary;
  _compare = compare || null;
  _rebuild();
}

/**
 * Show (or clear, with null) a lookup-state marker on the diagram.
 * @param {object|null} st  — full state { T_C, P_kPa, h, s }
 */
export function setLookupMarker(st) {
  _marker = st;
  if (!_chart) return;
  _chart.data.datasets = _chart.data.datasets.filter(d => d.label !== MARKER_LABEL);
  if (st) _chart.data.datasets.push(_buildMarkerDataset(st));
  _chart.update('none');
}

/** Reset pan/zoom to the natural view of the current data. */
export function resetView() {
  if (!_chart || !_bounds) return;
  _chart.options.scales.x.min = _bounds.xMin;
  _chart.options.scales.x.max = _bounds.xMax;
  _chart.options.scales.y.min = _bounds.yMin;
  _chart.options.scales.y.max = _bounds.yMax;
  _chart.update();
}

/** Download the current diagram as a PNG file. */
export function downloadPNG() {
  if (!_chart) return;
  const a = document.createElement('a');
  const vs = _compare ? `-vs-${_compare.label}` : '';
  a.download = `frigprop-${_primary ? _primary.label : 'chart'}${vs}-${_mode}.png`;
  a.href = _chart.toBase64Image('image/png', 1);
  a.click();
}

// ---------------------------------------------------------------------------
// Rebuild
// ---------------------------------------------------------------------------

function _rebuild() {
  if (!_canvas || !window.Chart || !_primary) return;

  const fluids = [_primary, _compare].filter(Boolean);
  _bounds = _calcBounds(fluids);

  const datasets = [];
  fluids.forEach((f, i) => {
    const pal = PALETTES[i];
    datasets.push(..._buildDomeDatasets(f, pal));
    if (f.states && f.states.length === 4) datasets.push(..._buildCycleDatasets(f, pal));
  });
  if (_marker) datasets.push(_buildMarkerDataset(_marker));
  _renderLegend(fluids);

  const options = _buildOptions(_bounds);
  if (_chart) {
    _chart.data.datasets = datasets;
    // Replace options with explicit bounds to reset any panning.
    // Plain update(): mode 'active' would resolve every element in hover
    // state, fattening the dome lines (radius 0 → hover 4).
    _chart.options = options;
    _chart.update();
  } else {
    _chart = new window.Chart(_canvas, {
      type:    'scatter',
      data:    { datasets },
      options,
      plugins: [_bgPlugin],
    });
  }
}

/** Dome/cycle color key — shown only when two fluids are compared. */
function _renderLegend(fluids) {
  const el = document.getElementById('chart-legend');
  if (!el) return;
  const show = fluids.length > 1;
  el.classList.toggle('hidden', !show);
  if (!show) { el.innerHTML = ''; return; }
  const item = (color, text) =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${text}</span>`;
  el.innerHTML = fluids.map((f, i) => {
    const pal = PALETTES[i];
    return item(pal.dome, `${f.label} dome`) +
           (f.states ? item(pal.cycle, `${f.label} cycle`) : '');
  }).join('');
}

// ---------------------------------------------------------------------------
// Pan / zoom (log-aware on the P-h pressure axis)
// ---------------------------------------------------------------------------

function _isLogY() {
  return !!MODES[_mode].y.log;
}

/** Current span of a scale in its working space (log10 for log axes). */
function _shiftScale(scale, frac, log) {
  if (log) {
    const span = Math.log10(scale.max / scale.min) * frac;
    return [scale.min * Math.pow(10, span), scale.max * Math.pow(10, span)];
  }
  const d = (scale.max - scale.min) * frac;
  return [scale.min + d, scale.max + d];
}

function _applyPan(dxPx, dyPx) {
  const xs = _chart.scales.x;
  const ys = _chart.scales.y;
  [_chart.options.scales.x.min, _chart.options.scales.x.max] =
    _shiftScale(xs, -(dxPx / xs.width), false);
  [_chart.options.scales.y.min, _chart.options.scales.y.max] =
    _shiftScale(ys, dyPx / ys.height, _isLogY());
  _chart.update('none');  // no animation — must feel instant during drag
}

/** Scale both axis ranges by `factor` about the current view center. */
function _zoom(factor) {
  if (!_chart) return;
  const xs = _chart.scales.x;
  const ys = _chart.scales.y;
  const xc = (xs.min + xs.max) / 2;
  const xHalf = (xs.max - xs.min) / 2 * factor;
  _chart.options.scales.x.min = xc - xHalf;
  _chart.options.scales.x.max = xc + xHalf;
  if (_isLogY()) {
    const lc = (Math.log10(ys.min) + Math.log10(ys.max)) / 2;
    const lHalf = Math.log10(ys.max / ys.min) / 2 * factor;
    _chart.options.scales.y.min = Math.pow(10, lc - lHalf);
    _chart.options.scales.y.max = Math.pow(10, lc + lHalf);
  } else {
    const yc = (ys.min + ys.max) / 2;
    const yHalf = (ys.max - ys.min) / 2 * factor;
    _chart.options.scales.y.min = yc - yHalf;
    _chart.options.scales.y.max = yc + yHalf;
  }
  _chart.update('none');
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

// sat-row column indices per mode: [x_liquid, x_vapor, y]
function _domeCols() {
  return _mode === 'ts' ? [4, 5, 0] : [2, 3, 1];
}

function _calcBounds(fluids) {
  const [cf, cg, cy] = _domeCols();
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  const eat = (x, y) => {
    if (x != null && isFinite(x)) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
    if (y != null && isFinite(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
  };
  for (const f of fluids) {
    for (const r of f.satRows) { eat(r[cf], r[cy]); eat(r[cg], r[cy]); }
    if (f.states) for (const s of f.states) { const p = MODES[_mode].pt(s); eat(p.x, p.y); }
  }
  const xPad = (xMax - xMin) * 0.07;
  if (_isLogY()) {
    const lPad = Math.log10(yMax / yMin) * 0.07;
    return { xMin: xMin - xPad, xMax: xMax + xPad,
             yMin: yMin / Math.pow(10, lPad), yMax: yMax * Math.pow(10, lPad) };
  }
  const yPad = (yMax - yMin) * 0.07;
  return { xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad };
}

// ---------------------------------------------------------------------------
// Dataset builders
// ---------------------------------------------------------------------------

function _buildDomeDatasets(fluid, pal) {
  const [cf, cg, cy] = _domeCols();
  const liquid = fluid.satRows.map(r => ({ x: r[cf], y: r[cy] }));
  const vapor  = fluid.satRows.map(r => ({ x: r[cg], y: r[cy] }));
  const base = {
    showLine: true, pointRadius: 0, borderColor: pal.dome,
    borderWidth: 1.5, tension: 0.12, fill: false, order: 3, parsing: false,
  };
  return [
    { ...base, label: `${fluid.label} bubble`, data: liquid },
    { ...base, label: `${fluid.label} dew`,    data: vapor  },
  ];
}

function _buildCycleDatasets(fluid, pal) {
  const { states, satRows, expPath } = fluid;
  const [s1, s2, s3, s4] = states;
  const pt = MODES[_mode].pt;

  let cyclePath;
  if (_mode === 'ts') {
    // 1→2: compression — vertical at s1 for ideal, slanted when η < 1
    const path12 = [pt(s1), pt(s2)];

    // 2→3: desuperheat → horizontal condensation at Tsat(P_cond) → optional subcool
    const shelf = _satShelfAtP(satRows, s2.P_kPa);
    let path23;
    if (shelf) {
      path23 = [pt(s2)];
      // dew point only if state 2 is superheated (wet compression starts inside the dome)
      if (s2.s > shelf.sg) path23.push({ x: shelf.sg, y: shelf.T });
      path23.push({ x: shelf.sf, y: shelf.T });
      path23.push(pt(s3));  // state 3 (subcooled if applicable)
    } else {
      path23 = [pt(s2), pt(s3)];
    }

    // 3→4: isenthalpic expansion — true constant-h contour when provided
    const path34 = (expPath && expPath.length > 2)
      ? expPath.map(p => ({ x: p.s, y: p.T_C }))
      : [pt(s3), pt(s4)];

    // 4→1: horizontal evaporation at Tsat(P_evap) → optional superheat rise
    const shelfE = _satShelfAtP(satRows, s4.P_kPa);
    const path41 = [pt(s4)];
    // dew-point vertex only when state 1 leaves the dome (superheated inlet)
    if (shelfE && s1.s > shelfE.sg) path41.push({ x: shelfE.sg, y: shelfE.T });
    path41.push(pt(s1));

    cyclePath = [...path12, ...path23.slice(1), ...path34.slice(1), ...path41.slice(1)];
  } else {
    // P-h: condenser/evaporator are exact horizontals, expansion exact vertical
    cyclePath = [pt(s1), pt(s2), pt(s3), pt(s4), pt(s1)];
  }

  return [
    // Process lines
    {
      label: `${fluid.label} path`, data: cyclePath,
      showLine: true, pointRadius: 0,
      borderColor: pal.cycleLine, borderWidth: 1.75,
      tension: 0, fill: false, order: 2, parsing: false,
    },
    // State point dots
    {
      label: `${fluid.label} states`, isStates: true, fluidLabel: fluid.label,
      data:  states.map((s, i) => ({ ...pt(s), stateNum: i + 1 })),
      showLine: false,
      pointRadius: 5, pointHoverRadius: 7,
      pointBackgroundColor: pal.cycle,
      pointBorderColor: '#0a0e14', pointBorderWidth: 1.5,
      order: 1, parsing: false,
    },
  ];
}

function _buildMarkerDataset(st) {
  return {
    label: MARKER_LABEL,
    data: [{ ...MODES[_mode].pt(st), isLookup: true }],
    showLine: false,
    pointStyle: 'rectRot',
    pointRadius: 7, pointHoverRadius: 9,
    pointBackgroundColor: '#ffd166',
    pointBorderColor: '#0a0e14', pointBorderWidth: 1.5,
    order: 0, parsing: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Condensation shelf (T, sf, sg) at pressure P, lerped from sat rows. */
function _satShelfAtP(satRows, P_kPa) {
  const n = satRows.length;
  if (P_kPa < satRows[0][1] || P_kPa > satRows[n - 1][1]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (satRows[mid][1] <= P_kPa) lo = mid; else hi = mid;
  }
  const a = satRows[lo], b = satRows[hi];
  const t = b[1] === a[1] ? 0 : (P_kPa - a[1]) / (b[1] - a[1]);
  return {
    T:  a[0] + t * (b[0] - a[0]),
    sf: a[4] + t * (b[4] - a[4]),
    sg: a[5] + t * (b[5] - a[5]),
  };
}

function _fmtTick(v, axis) {
  const d = units.toDisplay(v, axis.kind);
  // log pressure ticks span orders of magnitude — keep them compact
  return Math.abs(d) >= 100 ? d.toFixed(0) : String(+d.toPrecision(3));
}

function _buildOptions(bounds) {
  const mode = MODES[_mode];
  const fontDef    = { family: STYLE.font, size: 10 };
  const axisCommon = {
    grid:  { color: STYLE.grid },
    ticks: { color: STYLE.tick, font: fontDef, maxTicksLimit: 8 },
  };
  const title = axis => ({
    display: true, text: `${axis.title}  (${units.label(axis.kind)})`,
    color: STYLE.label, font: { ...fontDef, size: 11 },
  });

  return {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 250 },
    scales: {
      x: {
        ...axisCommon, type: 'linear',
        min: bounds?.xMin, max: bounds?.xMax,
        ticks: { ...axisCommon.ticks,
                 callback: v => units.toDisplay(v, mode.x.kind).toFixed(mode.x.decimals) },
        title: title(mode.x),
      },
      y: {
        ...axisCommon, type: mode.y.log ? 'logarithmic' : 'linear',
        min: bounds?.yMin, max: bounds?.yMax,
        ticks: { ...axisCommon.ticks, callback: v => _fmtTick(v, mode.y) },
        title: title(mode.y),
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: STYLE.tooltip.bg,
        borderColor:     STYLE.tooltip.border,
        borderWidth:     1,
        titleColor:      STYLE.tooltip.title,
        bodyColor:       STYLE.tooltip.body,
        padding:         10,
        filter: ctx => ctx.dataset.isStates || ctx.dataset.label === MARKER_LABEL,
        callbacks: {
          title: () => '',
          label(ctx) {
            const { x, y, stateNum, isLookup } = ctx.raw;
            const fluid  = ctx.dataset.fluidLabel ? `${ctx.dataset.fluidLabel} ` : '';
            const prefix = stateNum ? `${fluid}State ${stateNum}:  ` : (isLookup ? 'Lookup:  ' : '');
            const fx = `${mode.x.title} = ${units.toDisplay(x, mode.x.kind).toFixed(_mode === 'ts' ? 4 : 2)} ${units.label(mode.x.kind)}`;
            const fy = `${mode.y.title} = ${units.toDisplay(y, mode.y.kind).toFixed(_mode === 'ts' ? 2 : 1)} ${units.label(mode.y.kind)}`;
            return `${prefix}${fy}   ${fx}`;
          },
        },
      },
    },
  };
}
