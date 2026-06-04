/**
 * chart.js — T-s diagram for FrigProp.
 * Requires Chart.js 4.x loaded as a global (window.Chart) before this runs.
 */

const STYLE = {
  dome:    'rgba(0,212,255,0.70)',
  cycle:   '#ff6b35',
  grid:    'rgba(30,45,61,0.9)',
  tick:    '#5a7a94',
  label:   '#5a7a94',
  tooltip: { bg: 'rgba(11,17,26,0.96)', border: '#1e2d3d', title: '#eaf4ff', body: '#c8d8e8' },
  font:    "'IBM Plex Mono', monospace",
};

let _chart       = null;
let _canvas      = null;
let _domeBounds  = null;   // natural bounds for saturation dome only
let _cycleBounds = null;   // natural bounds when cycle is shown
let _hasCycle    = false;

// Pan state
let _drag        = false;
let _lastX       = 0;
let _lastY       = 0;
let _touchX      = 0;
let _touchY      = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initTsChart() {
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

  // Recenter button
  const btn = document.getElementById('ts-recenter-btn');
  if (btn) btn.addEventListener('click', resetTsView);
}

/**
 * Render or update the T-s diagram.
 * Always resets to natural view bounds (dome-only or dome+cycle).
 *
 * @param {Array}      satRows  Rows from sat.json: [T, P, hf, hg, sf, sg, ...]
 * @param {Array|null} states   4 states from computeVCRCStates(), or null
 */
export function updateTsChart(satRows, states) {
  if (!_canvas || !window.Chart) return;

  _hasCycle    = !!(states && states.length === 4);
  _domeBounds  = _calcDomeBounds(satRows);
  _cycleBounds = _hasCycle ? _calcCycleBounds(states, _domeBounds) : null;

  const bounds   = _naturalBounds();
  const datasets = _buildDomeDatasets(satRows);
  if (_hasCycle) datasets.push(..._buildCycleDatasets(states, satRows));

  if (_chart) {
    _chart.data.datasets = datasets;
    // Replace options with explicit bounds to reset any panning
    _chart.options = _buildOptions(bounds);
    _chart.update('active');
  } else {
    _chart = new window.Chart(_canvas, {
      type:    'scatter',
      data:    { datasets },
      options: _buildOptions(bounds),
    });
  }
}

export function clearCycleOverlay() {
  if (!_chart) return;
  _hasCycle    = false;
  _cycleBounds = null;
  _chart.data.datasets = _chart.data.datasets.slice(0, 2);
  _chart.update('active');
}

/** Reset pan to the natural view: dome-only, or dome+cycle if cycle is shown. */
export function resetTsView() {
  if (!_chart) return;
  const b = _naturalBounds();
  if (!b) return;
  _chart.options.scales.x.min = b.xMin;
  _chart.options.scales.x.max = b.xMax;
  _chart.options.scales.y.min = b.yMin;
  _chart.options.scales.y.max = b.yMax;
  _chart.update('active');
}

// ---------------------------------------------------------------------------
// Pan implementation
// ---------------------------------------------------------------------------

function _applyPan(dxPx, dyPx) {
  const xs = _chart.scales.x;
  const ys = _chart.scales.y;
  const xShift = -(dxPx / xs.width)  * (xs.max - xs.min);
  const yShift =  (dyPx / ys.height) * (ys.max - ys.min);

  _chart.options.scales.x.min = xs.min + xShift;
  _chart.options.scales.x.max = xs.max + xShift;
  _chart.options.scales.y.min = ys.min + yShift;
  _chart.options.scales.y.max = ys.max + yShift;
  _chart.update('none');  // no animation — must feel instant during drag
}

// ---------------------------------------------------------------------------
// Bounds helpers
// ---------------------------------------------------------------------------

function _naturalBounds() {
  return (_hasCycle && _cycleBounds) ? _cycleBounds : _domeBounds;
}

function _calcDomeBounds(satRows) {
  let sfMin =  Infinity, sgMax = -Infinity;
  let tMin  =  Infinity, tMax  = -Infinity;
  for (const r of satRows) {
    if (r[4] != null && r[4] < sfMin) sfMin = r[4];
    if (r[5] != null && r[5] > sgMax) sgMax = r[5];
    if (r[0] < tMin) tMin = r[0];
    if (r[0] > tMax) tMax = r[0];
  }
  const xPad = (sgMax - sfMin) * 0.07;
  const yPad = (tMax  - tMin)  * 0.07;
  return { xMin: sfMin - xPad, xMax: sgMax + xPad, yMin: tMin - yPad, yMax: tMax + yPad };
}

function _calcCycleBounds(states, dome) {
  const sVals = states.map(s => s.s).filter(v => v != null && isFinite(v));
  const tVals = states.map(s => s.T_C).filter(v => v != null && isFinite(v));
  const xMin  = Math.min(dome.xMin, ...sVals);
  const xMax  = Math.max(dome.xMax, ...sVals);
  const yMin  = Math.min(dome.yMin, ...tVals);
  const yMax  = Math.max(dome.yMax, ...tVals);
  const xPad  = (xMax - xMin) * 0.05;
  const yPad  = (yMax - yMin) * 0.05;
  return { xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad };
}

// ---------------------------------------------------------------------------
// Dataset builders
// ---------------------------------------------------------------------------

function _buildDomeDatasets(satRows) {
  const bubble = satRows.map(r => ({ x: r[4], y: r[0] }));
  const dew    = satRows.map(r => ({ x: r[5], y: r[0] }));
  const base = {
    showLine: true, pointRadius: 0, borderColor: STYLE.dome,
    borderWidth: 1.5, tension: 0.12, fill: false, order: 3, parsing: false,
  };
  return [
    { ...base, label: 'Bubble (Q=0)', data: bubble },
    { ...base, label: 'Dew (Q=1)',    data: dew    },
  ];
}

function _buildCycleDatasets(states, satRows) {
  const [s1, s2, s3, s4] = states;

  // 1→2: isentropic compression — vertical line at s = s1
  const path12 = [{ x: s1.s, y: s1.T_C }, { x: s1.s, y: s2.T_C }];

  // 2→3: desuperheat → horizontal condensation at T_cond → optional subcool
  const satT3 = _closestSatRow(satRows, s3.T_C);
  const path23 = satT3
    ? [
        { x: s2.s,     y: s2.T_C  },
        { x: satT3[5], y: s3.T_C  },  // dew point at T_cond
        { x: satT3[4], y: s3.T_C  },  // bubble point at T_cond
        { x: s3.s,     y: s3.T_C  },  // state 3 (subcooled if applicable)
      ]
    : [{ x: s2.s, y: s2.T_C }, { x: s3.s, y: s3.T_C }];

  // 3→4: isenthalpic expansion (straight-line approximation in T-s)
  const path34 = [{ x: s3.s, y: s3.T_C }, { x: s4.s, y: s4.T_C }];

  // 4→1: evaporation — horizontal at T_evap
  const path41 = [{ x: s4.s, y: s4.T_C }, { x: s1.s, y: s1.T_C }];

  const cyclePath = [
    ...path12,
    ...path23.slice(1),
    ...path34.slice(1),
    ...path41.slice(1),
  ];

  return [
    // Process lines
    {
      label: '', data: cyclePath,
      showLine: true, pointRadius: 0,
      borderColor: 'rgba(255,107,53,0.75)', borderWidth: 1.75,
      tension: 0, fill: false, order: 2, parsing: false,
    },
    // State point dots
    {
      label: 'States',
      data:  states.map((s, i) => ({ x: s.s, y: s.T_C, stateNum: i + 1 })),
      showLine: false,
      pointRadius: 5, pointHoverRadius: 7,
      pointBackgroundColor: STYLE.cycle,
      pointBorderColor: '#0a0e14', pointBorderWidth: 1.5,
      order: 1, parsing: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _closestSatRow(satRows, T_C) {
  let best = null, bestDist = Infinity;
  for (const r of satRows) {
    const d = Math.abs(r[0] - T_C);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  return bestDist < 2.0 ? best : null;
}

function _buildOptions(bounds) {
  const fontDef    = { family: STYLE.font, size: 10 };
  const axisCommon = {
    grid:  { color: STYLE.grid },
    ticks: { color: STYLE.tick, font: fontDef, maxTicksLimit: 8 },
  };

  return {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 250 },
    scales: {
      x: {
        ...axisCommon, type: 'linear',
        min: bounds?.xMin, max: bounds?.xMax,
        title: { display: true, text: 's  (kJ / kg·K)', color: STYLE.label,
                 font: { ...fontDef, size: 11 } },
      },
      y: {
        ...axisCommon, type: 'linear',
        min: bounds?.yMin, max: bounds?.yMax,
        title: { display: true, text: 'T  (°C)', color: STYLE.label,
                 font: { ...fontDef, size: 11 } },
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
        filter: ctx => ctx.datasetIndex >= 2,   // only state point dots
        callbacks: {
          title: () => '',
          label(ctx) {
            const { x, y, stateNum } = ctx.raw;
            const prefix = stateNum ? `State ${stateNum}:  ` : '';
            return `${prefix}T = ${y.toFixed(2)} °C   s = ${x.toFixed(4)} kJ/kg·K`;
          },
        },
      },
    },
  };
}
