/**
 * chart.js — T-s diagram for FrigProp.
 * Requires Chart.js 4.x loaded as a global (window.Chart) before this runs.
 */

const STYLE = {
  dome:    'rgba(0,212,255,0.70)',
  domeFill:'rgba(0,212,255,0.04)',
  cycle:   '#ff6b35',
  cycleFill:'rgba(255,107,53,0.08)',
  grid:    'rgba(30,45,61,0.9)',
  tick:    '#5a7a94',
  label:   '#5a7a94',
  tooltip: { bg: 'rgba(11,17,26,0.96)', border: '#1e2d3d', title: '#eaf4ff', body: '#c8d8e8' },
  font:    "'IBM Plex Mono', monospace",
};

let _chart   = null;
let _canvas  = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initTsChart() {
  _canvas = document.getElementById('ts-chart');
}

/**
 * Render or update the T-s diagram.
 * @param {Array}  satRows  Rows from sat.json: [T, P, hf, hg, sf, sg, ...]
 * @param {Array|null} states  4-element state array from computeVCRCStates(), or null
 */
export function updateTsChart(satRows, states) {
  if (!_canvas || !window.Chart) return;

  const datasets = _buildDomeDatasets(satRows);
  if (states && states.length === 4) {
    datasets.push(..._buildCycleDatasets(states, satRows));
  }

  if (_chart) {
    _chart.data.datasets = datasets;
    _chart.update('active');
  } else {
    _chart = new window.Chart(_canvas, {
      type:    'scatter',
      data:    { datasets },
      options: _buildOptions(),
    });
  }
}

export function clearCycleOverlay() {
  if (!_chart) return;
  // Keep only the first two datasets (bubble + dew)
  _chart.data.datasets = _chart.data.datasets.slice(0, 2);
  _chart.update('active');
}

// ---------------------------------------------------------------------------
// Dataset builders
// ---------------------------------------------------------------------------

function _buildDomeDatasets(satRows) {
  const bubble = satRows.map(r => ({ x: r[4], y: r[0] })); // sf, T
  const dew    = satRows.map(r => ({ x: r[5], y: r[0] })); // sg, T

  const base = {
    showLine: true,
    pointRadius: 0,
    borderColor: STYLE.dome,
    borderWidth: 1.5,
    tension: 0.12,
    fill: false,
    order: 3,
    parsing: false,
  };

  return [
    { ...base, label: 'Bubble (Q=0)', data: bubble },
    { ...base, label: 'Dew (Q=1)',    data: dew    },
  ];
}

function _buildCycleDatasets(states, satRows) {
  // State points: simple dots for all 4 states
  const pts = states.map((s, i) => ({ x: s.s, y: s.T_C, stateNum: i + 1 }));

  // Build process paths as separate line segments so we can
  // show physically correct paths where possible:
  //   1→2  isentropic: vertical line (constant s = s1)
  //   2→3  desuperheating + condensation + optional subcool: approximated
  //   3→4  isenthalpic expansion: straight line (approximate)
  //   4→1  evaporation: horizontal at T_evap (exact for pure, approx for blend)

  const s1 = states[0], s2 = states[1], s3 = states[2], s4 = states[3];

  // 1→2: isentropic — vertical segment at s = s1
  const path12 = [
    { x: s1.s, y: s1.T_C },
    { x: s1.s, y: s2.T_C },  // same s, higher T
  ];

  // 2→3: approximate isobaric path through superheat region then condensation
  // We draw a straight line from state 2 to the dew point at T3, then
  // horizontal condensation to the bubble point at T3, then to state 3.
  const satAtT3 = _satRowAtT(satRows, s3.T_C);
  let path23;
  if (satAtT3) {
    const sgT3 = satAtT3[5];
    const sfT3 = satAtT3[4];
    path23 = [
      { x: s2.s,  y: s2.T_C  },   // state 2 (superheated)
      { x: sgT3,  y: s3.T_C  },   // dew point at condensing T
      { x: sfT3,  y: s3.T_C  },   // bubble point at condensing T (horizontal)
      { x: s3.s,  y: s3.T_C  },   // state 3 (may be sub-cooled — same T, less s)
    ];
  } else {
    path23 = [{ x: s2.s, y: s2.T_C }, { x: s3.s, y: s3.T_C }];
  }

  // 3→4: isenthalpic expansion — straight line (approximate)
  const path34 = [
    { x: s3.s, y: s3.T_C },
    { x: s4.s, y: s4.T_C },
  ];

  // 4→1: evaporation at (approx) constant T — horizontal line
  const path41 = [
    { x: s4.s, y: s4.T_C },
    { x: s1.s, y: s1.T_C },
  ];

  const cyclePath = [...path12, ...path23.slice(1), ...path34.slice(1), ...path41.slice(1)];

  const lineBase = {
    showLine:    true,
    pointRadius: 0,
    borderColor: 'rgba(255,107,53,0.75)',
    borderWidth: 1.75,
    tension:     0,
    fill:        false,
    order:       2,
    parsing:     false,
  };

  return [
    // Process path (lines)
    { ...lineBase, label: '', data: cyclePath },

    // State point dots (rendered on top)
    {
      label:              'States',
      data:               pts,
      showLine:           false,
      pointRadius:        5,
      pointHoverRadius:   7,
      pointBackgroundColor: STYLE.cycle,
      pointBorderColor:   '#0a0e14',
      pointBorderWidth:   1.5,
      order:              1,
      parsing:            false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _satRowAtT(satRows, T_C) {
  // Find closest row to target temperature
  let best = null, bestDist = Infinity;
  for (const row of satRows) {
    const d = Math.abs(row[0] - T_C);
    if (d < bestDist) { bestDist = d; best = row; }
  }
  return bestDist < 1.0 ? best : null;
}

function _buildOptions() {
  const fontDef = { family: STYLE.font, size: 10 };
  const axisCommon = {
    grid:  { color: STYLE.grid },
    ticks: { color: STYLE.tick, font: fontDef },
  };

  return {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 250 },
    scales: {
      x: {
        ...axisCommon,
        type:  'linear',
        title: { display: true, text: 's  (kJ / kg·K)', color: STYLE.label, font: { ...fontDef, size: 11 } },
      },
      y: {
        ...axisCommon,
        type:  'linear',
        title: { display: true, text: 'T  (°C)', color: STYLE.label, font: { ...fontDef, size: 11 } },
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
        filter: ctx => ctx.datasetIndex >= 2, // only tooltip state points
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
