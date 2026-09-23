/**
 * app.js — Controller. Wires backend + cycle logic + UI together.
 * The property backend is swappable via this one import (same interface).
 */
import backend from "./tables.js?v=20260923a";
import { computeVCRCStates, analyzeVCRC, validateCycle, expansionPath, coilProfiles, advancedMetrics,
  isoLines, lookupFromTS } from "./cycle.js?v=20260923b";
import { getRefrigerantList, getRefrigerantInfo } from "./refrigerants.js";
import {
  setStatus, populateRefrigerantSelector, onRefrigerantChange,
  renderInfoPanel, wireInputControls, getInputs, applyInputs, setRangeHint,
  enableCalcButton, onCalcClick, showError, clearError,
  renderResults, buildResultsCSV, buildSatCSV, showTranscritWarning, highlightRefCard,
  populateComparisonSelect, getComparisonFluid, onComparisonChange,
  wireAdvancedSection, openAdvancedSection, setAdvancedMarkers,
  getCapacityKW, getCapacityUnit, setCapacity, onCapacityChange, renderAdvancedResults,
  wireLookupControls, enableLookupButton, showLookupError, setLookupInputs,
  renderLookupState, renderLookupSat,
  refreshUnitLabels, refreshLookupFields, onUnitToggle,
} from "./ui.js?v=20260923d";  // versioned: new exports must not meet a cached ui.js
import {
  initCharts, updateCharts, setChartMode, getChartMode, setLookupMarker, onDiagramPick,
} from "./chart.js?v=20260923b";
import * as units from "./units.js?v=20260923a";

let currentFluidKey = null;
let currentInfo = null;
// retained SI results so a unit toggle can re-render without recomputing
let last = null;        // { primary, comparison } bundles from handleCalc
let lastInputs = null;  // SI inputs of the last successful calculation
let lastLookup = null;  // { kind: "state"|"sat", data, phaseLabel }

async function init() {
  // Resolve unit system from URL before wiring controls so labels render correctly once.
  const params = new URLSearchParams(location.search);
  if (params.get("u") === "IP") units.setSystem("IP");

  wireInputControls();
  wireAdvancedSection();
  wireLookupControls(handleLookup);  // calls refreshLookupFields() internally
  onUnitToggle(handleUnitToggle);
  initCharts();
  onDiagramPick(handleDiagramPick);
  refreshUnitLabels();

  try {
    await backend.loadManifest();  // fetches manifest without pre-loading any fluid tables
    const cpVer = backend.getManifest().coolprop_version;
    const verEl = document.getElementById("footer-cp-ver");
    if (verEl && cpVer) verEl.textContent = ` v${cpVer}`;

    const keys = await getRefrigerantList();
    // Pre-fetch all metadata so cards render with type/GWP badges immediately
    const allInfo = {};
    await Promise.all(keys.map(async k => { allInfo[k] = await getRefrigerantInfo(k); }));
    populateRefrigerantSelector(keys, allInfo);
    populateComparisonSelect(keys, allInfo);
    setStatus("ready", "Ready");

    // Default to the first card in gallery sort order, not a hardcoded key
    const firstCard = document.querySelector("#ref-cards .ref-card");
    const defaultKey = (firstCard && firstCard.dataset.key) || "R32";
    const startKey = backend.getFluidMeta(params.get("f")) ? params.get("f") : defaultKey;
    await selectFluid(startKey);
    await _applyShareParams(params);

  } catch (err) {
    setStatus("error", "Load failed");
    showError(`Initialization failed: ${err.message}. Serve over HTTP (not file:///).`);
    return;
  }

  onRefrigerantChange(async key => {
    if (!key) return;
    await selectFluid(key);
  });
  onComparisonChange(handleComparisonChange);
  onCapacityChange(() => {
    if (!last) return;
    _attachAdvanced();
    renderAdvancedResults(last.primary, last.comparison);
  });
  onCalcClick(handleCalc);

  const csvBtn = document.getElementById("export-csv-btn");
  if (csvBtn) csvBtn.addEventListener("click", () => {
    if (!last) return;
    _copyToClipboard(buildResultsCSV(last.primary, last.comparison), csvBtn);
  });
  const satBtn = document.getElementById("sat-csv-btn");
  satBtn.addEventListener("click", () => {
    const rows = currentFluidKey && backend.getSatRows(currentFluidKey);
    if (!rows || !currentInfo) return;
    _copyToClipboard(buildSatCSV(currentInfo.ashrae_designation, currentInfo.reference_state, rows), satBtn);
  });
  const linkBtn = document.getElementById("share-link-btn");
  if (linkBtn) linkBtn.addEventListener("click", () => {
    const url = _buildShareURL();
    if (!url) return;
    history.replaceState(null, "", url);
    _copyToClipboard(url, linkBtn);
  });
}

async function selectFluid(key) {
  currentFluidKey = key;
  setStatus("working", "Loading…");
  enableCalcButton(false);
  enableLookupButton(false);

  try {
    await backend.init(key);
    const info = await getRefrigerantInfo(key);
    currentInfo = info;
    last = null;
    lastInputs = null;
    lastLookup = null;
    const meta = backend.getFluidMeta(key);
    renderInfoPanel(key, info, meta);
    setRangeHint(meta);
    highlightRefCard(key, info);
    document.getElementById("sat-csv-btn").disabled = false;
    setStatus("ready", `Ready — ${key}`);
    enableCalcButton(true);
    enableLookupButton(true);
    clearError();
    // Hide old results
    document.getElementById("results-section").classList.add("hidden");
    renderAdvancedResults(null);
    document.getElementById("warnings-box").classList.add("hidden");
    document.getElementById("notes-box").classList.add("hidden");
    document.getElementById("transcrit-notice").classList.add("hidden");
    document.getElementById("error-box").classList.add("hidden");
    document.getElementById("lookup-result").classList.add("hidden");
    document.getElementById("lookup-error").classList.add("hidden");
    setLookupMarker(null);
    await _updateDiagram();
  } catch (err) {
    setStatus("error", "Load failed");
    showError(`Failed to load ${key}: ${err.message}`);
  }
}

/** Comparison fluid changed: load its tables and refresh the dome overlay. */
async function handleComparisonChange() {
  const compKey = getComparisonFluid(currentFluidKey);
  if (compKey) {
    try {
      await backend.init(compKey);
      await backend.init(currentFluidKey);  // cached — restores current fluid
    } catch (err) {
      document.getElementById("compare-fluid").value = "";
      showError(`Failed to load comparison fluid ${compKey}: ${err.message}`);
      return;
    }
  }
  // comparison cycle (if any) no longer matches the selection — keep primary only
  if (last) last.comparison = null;
  await _updateDiagram();
  // the control sits below the results: re-run a calculated cycle so the
  // results + diagram reflect the new selection without another click
  if (lastInputs) await handleCalc();
}

/** Chart bundle for one fluid; states/expPath may be null (dome only). */
function _chartBundle(key, states, expPath) {
  return { label: key, satRows: backend.getSatRows(key), states: states || null, expPath: expPath || null };
}

/** Redraw the diagram from current selection + last results. */
async function _updateDiagram() {
  const compKey = getComparisonFluid(currentFluidKey);
  const primary = _chartBundle(currentFluidKey,
    last && last.primary.states, last && last.primary.expPath);
  const compare = compKey && backend.getSatRows(compKey)
    ? _chartBundle(compKey,
        last && last.comparison && last.comparison.states,
        last && last.comparison && last.comparison.expPath)
    : null;
  const fluidLabel = document.getElementById("ts-fluid-label");
  if (fluidLabel) {
    const name = currentInfo ? currentInfo.ashrae_designation : currentFluidKey;
    fluidLabel.textContent = compare ? `${name} vs ${compKey}` : name;
  }
  if (primary.satRows) updateCharts(primary, compare, await _isoLines(primary.satRows));
  _refreshAdvancedMarkers();
}

/** Tabulated pressure extent of the current fluid (kPa). */
function _pRange(rows) {
  return { P_lo_kPa: Math.min(rows[0][10], rows[0][11]),
           P_hi_kPa: backend.getFluidMeta(currentFluidKey).P_max_kPa };
}

/**
 * Backdrop iso-lines for the current fluid at values that are round in the
 * display units: 1-2-5 (or sparser) pressures, even temperature steps.
 */
async function _isoLines(rows) {
  const n = rows.length;
  const states = [last && last.primary, last && last.comparison].flatMap(b => b ? b.states : []);
  const T_hi = Math.max(rows[n - 1][0], ...states.map(s => s.T_C)) + 15;
  const range = { T_lo_C: rows[0][0], T_hi_C: T_hi, ..._pRange(rows) };

  const disp = (v, k) => units.toDisplay(v, k);
  const pLo = disp(range.P_lo_kPa, "P"), pHi = disp(Math.max(rows[n - 1][10], rows[n - 1][11]), "P");
  let pressures = [];
  for (const mult of [[1, 2, 5], [1, 3], [1]]) {
    pressures = [];
    for (let e = Math.floor(Math.log10(pLo)); e <= Math.ceil(Math.log10(pHi)); e++) {
      for (const m of mult) { const v = m * 10 ** e; if (v > pLo && v < pHi) pressures.push(v); }
    }
    if (pressures.length <= 9) break;
  }
  const tLo = disp(range.T_lo_C, "T"), tHi = disp(T_hi, "T");
  const step = [5, 10, 20, 25, 50, 100].find(st => (tHi - tLo) / st <= 8) || 200;
  const temps = [];
  for (let v = Math.ceil(tLo / step) * step; v < tHi; v += step) temps.push(v);

  try {
    await backend.init(currentFluidKey);  // cached; comparison may have switched fluid
    return await isoLines(backend, pressures.map(v => units.fromInput(v, "P")),
                          temps.map(v => units.fromInput(v, "T")), range);
  } catch (_) {
    return null;  // backdrop only — never block the diagram
  }
}

/** Diagram click → fill and run the Property Lookup at that point. */
async function handleDiagramPick({ mode, x, y }) {
  if (!currentFluidKey) return;
  try {
    await backend.init(currentFluidKey);
    const spec = mode === "ph"
      ? { pair: "PH", v1: y, v2: x }
      : await lookupFromTS(backend, y, x, _pRange(backend.getSatRows(currentFluidKey)));
    setLookupInputs(spec.pair, spec.v1, spec.v2);
    await handleLookup(spec);
  } catch (_) {
    setLookupMarker(null);
    showLookupError(`That diagram point is outside the tabulated region for ${currentFluidKey} — ` +
                    `pick inside the dome or in the vapor region.`);
  }
}

/** Flag the results + diagram with every active advanced option. */
function _refreshAdvancedMarkers() {
  const labels = [];
  const compKey = getComparisonFluid(currentFluidKey);
  if (compKey) {
    const sel = document.getElementById("compare-fluid");
    labels.push(`vs ${sel.options[sel.selectedIndex].textContent}`);
  }
  setAdvancedMarkers(labels);
}

async function handleCalc() {
  clearError();
  if (!currentFluidKey) return;

  const inputs = getInputs();
  const meta = backend.getFluidMeta(currentFluidKey);

  // In pressure mode T1/T3 are actual state temperatures, not sat temps
  const shByP = inputs.superheat && inputs.sh_by === "P";
  const scByP = inputs.subcool && inputs.sc_by === "P";

  // Validate inputs
  if (isNaN(inputs.T1_C)) {
    showError(`State 1: enter the ${shByP ? "compressor inlet" : "evaporator"} temperature (T1).`); return;
  }
  if (inputs.superheat && !shByP && (isNaN(inputs.dT_sh_K) || inputs.dT_sh_K < 0)) {
    showError("State 1 (superheated): enter superheat ΔT ≥ 0 K."); return;
  }
  if (shByP && (isNaN(inputs.P_evap_kPa) || inputs.P_evap_kPa <= 0)) {
    showError("State 1 (superheated): enter an evaporator pressure > 0."); return;
  }
  if (isNaN(inputs.T3_C)) {
    showError(`State 3: enter the ${scByP ? "condenser exit" : "condensing"} temperature (T3).`); return;
  }
  if (inputs.subcool && !scByP && (isNaN(inputs.dT_sc_K) || inputs.dT_sc_K < 0)) {
    showError("State 3 (subcooled): enter subcooling ΔT ≥ 0 K."); return;
  }
  if (scByP && (isNaN(inputs.P_cond_kPa) || inputs.P_cond_kPa <= 0)) {
    showError("State 3 (subcooled): enter a condenser pressure > 0."); return;
  }
  if (inputs.eta_isen <= 0 || inputs.eta_isen > 1) {
    showError("Compressor: isentropic efficiency must be between 10 % and 100 %."); return;
  }

  // Range validation against fluid metadata (friendly, in display units)
  if (meta) {
    const T_hi = Math.min(meta.T_max_C, meta.T_crit_C - 0.5);
    const L = units.label("T");
    const dt = v => units.toDisplay(v, "T").toFixed(1);
    const range = `${currentFluidKey} saturation data covers ${dt(meta.T_min_C)} ${L} to ${dt(T_hi)} ${L}`;
    if (!shByP && (inputs.T1_C < meta.T_min_C || inputs.T1_C > T_hi)) {
      showError(`Evaporator temperature ${dt(inputs.T1_C)} ${L} out of range — ${range}.`); return;
    }
    if (!scByP) {
      if (inputs.T3_C >= meta.T_crit_C) {
        showTranscritWarning(true);
        showError(`Condensing temperature ${dt(inputs.T3_C)} ${L} is above the critical point ` +
                  `(${dt(meta.T_crit_C)} ${L}) — transcritical operation is not supported by the ` +
                  `subcritical cycle model. Choose T3 < ${dt(T_hi)} ${L}.`);
        return;
      }
      showTranscritWarning(false);
      if (inputs.T3_C < meta.T_min_C || inputs.T3_C > T_hi) {
        showError(`Condensing temperature ${dt(inputs.T3_C)} ${L} out of range — ${range}.`); return;
      }
    } else if (inputs.P_cond_kPa >= meta.P_crit_kPa) {
      showTranscritWarning(true);
      showError(`Condenser pressure ${units.toDisplay(inputs.P_cond_kPa, "P").toFixed(0)} ${units.label("P")} ` +
                `is above the critical pressure (${units.toDisplay(meta.P_crit_kPa, "P").toFixed(0)} ` +
                `${units.label("P")}) — transcritical operation is not supported.`);
      return;
    } else {
      showTranscritWarning(false);
    }
    if (!shByP && !scByP && inputs.T3_C <= inputs.T1_C) {
      showError(`Condensing temperature (${dt(inputs.T3_C)} ${L}) must exceed evaporator temperature (${dt(inputs.T1_C)} ${L}).`); return;
    }
    if (shByP && scByP && inputs.P_cond_kPa <= inputs.P_evap_kPa) {
      const dp = v => units.toDisplay(v, "P").toFixed(0);
      const LP = units.label("P");
      showError(`Condenser pressure (${dp(inputs.P_cond_kPa)} ${LP}) must exceed evaporator pressure (${dp(inputs.P_evap_kPa)} ${LP}).`); return;
    }
  }

  setStatus("working", "Calculating…");
  enableCalcButton(false);

  try {
    await backend.init(currentFluidKey);  // comparison may have switched fluid
    const states = await computeVCRCStates(backend, inputs);
    const metrics = analyzeVCRC(states);
    const { warnings, notes } = validateCycle(states);
    const expPath = await expansionPath(backend, states[2], states[3]);
    const coils = await coilProfiles(backend, states, inputs);
    const primary = { key: currentFluidKey, states, metrics, warnings, notes, expPath, coils };

    // Same cycle inputs on the comparison fluid (errors don't block the primary)
    let comparison = null;
    const compKey = getComparisonFluid(currentFluidKey);
    if (compKey) {
      try {
        await backend.init(compKey);
        const cStates = await computeVCRCStates(backend, inputs);
        comparison = {
          key: compKey, states: cStates, metrics: analyzeVCRC(cStates),
          expPath: await expansionPath(backend, cStates[2], cStates[3]),
          coils: await coilProfiles(backend, cStates, inputs),
        };
      } catch (err) {
        warnings.push(`Comparison fluid ${compKey}: ${err.message}.`);
      } finally {
        await backend.init(currentFluidKey);
      }
    }

    last = { primary, comparison };
    lastInputs = inputs;
    _attachAdvanced();
    renderResults(primary, comparison);
    renderAdvancedResults(primary, comparison);
    await _updateDiagram();
    setStatus("ready", `Ready — ${currentFluidKey}`);
  } catch (err) {
    setStatus("ready", `Ready — ${currentFluidKey}`);
    showError(`Calculation error: ${err.message}`);
  } finally {
    enableCalcButton(true);
  }
}

/** (Re)compute the Advanced Tools metrics on the last cycle bundles. */
function _attachAdvanced() {
  const cap = getCapacityKW();
  for (const b of [last.primary, last.comparison]) {
    if (b) b.adv = advancedMetrics(b.states, b.metrics, b.coils, cap);
  }
}

async function handleLookup(inp) {
  if (!currentFluidKey) return;
  const { pair, v1, v2 } = inp;

  if (isNaN(v1)) { showLookupError("Enter the first property value."); return; }
  const needsV2 = pair !== "satT" && pair !== "satP";
  if (needsV2 && isNaN(v2)) { showLookupError("Enter the second property value."); return; }
  if ((pair === "TQ" || pair === "PQ") && (v2 < 0 || v2 > 1)) {
    showLookupError(`Quality x = ${v2} out of range — must be between 0 and 1.`); return;
  }

  try {
    await backend.init(currentFluidKey);  // comparison may have switched fluid
    if (pair === "satT" || pair === "satP") {
      const sat = await backend.getSatProps(pair === "satT" ? "T" : "P", v1);
      lastLookup = { kind: "sat", data: sat };
      renderLookupSat(sat);
      setLookupMarker(null);
    } else {
      const st = await backend.getProps(pair, v1, v2);
      const phaseLabel = await _phaseLabel(st);
      lastLookup = { kind: "state", data: st, phaseLabel };
      renderLookupState(st, phaseLabel);
      setLookupMarker(st);
    }
  } catch (err) {
    showLookupError(err.message);
  }
}

/** Switch SI ⇄ IP: relabel everything and re-render retained results. */
function handleUnitToggle() {
  units.setSystem(units.getSystem() === "SI" ? "IP" : "SI");
  refreshUnitLabels();
  refreshLookupFields();

  const meta = currentFluidKey ? backend.getFluidMeta(currentFluidKey) : null;
  if (meta) setRangeHint(meta);
  if (currentInfo) renderInfoPanel(currentFluidKey, currentInfo, meta);
  if (last) {
    renderResults(last.primary, last.comparison);
    renderAdvancedResults(last.primary, last.comparison);
  }
  if (lastLookup) {
    if (lastLookup.kind === "sat") renderLookupSat(lastLookup.data);
    else renderLookupState(lastLookup.data, lastLookup.phaseLabel);
  }
  // rebuild charts so axis titles/ticks pick up the new labels
  if (currentFluidKey) {
    _updateDiagram();
    if (lastLookup && lastLookup.kind === "state") setLookupMarker(lastLookup.data);
  }
}

async function _phaseLabel(st) {
  if (st.x !== null && st.x !== undefined) {
    if (st.x <= 0.0001) return "saturated liquid";
    if (st.x >= 0.9999) return "saturated vapor";
    return `two-phase mixture (x = ${st.x.toFixed(3)})`;
  }
  try {
    const sat = await backend.getSatProps("P", st.P_kPa);
    return st.T_C >= sat.T_dew_C ? "superheated vapor" : "subcooled liquid";
  } catch (_) {
    return "single-phase";
  }
}

// ---------------------------------------------------------------------------
// Cycle sharing — URL query params (SI values, independent of display units)
// ---------------------------------------------------------------------------

/** Shareable URL reproducing the last calculated cycle, or null. */
function _buildShareURL() {
  if (!lastInputs) return null;
  const p = new URLSearchParams();
  p.set("f", currentFluidKey);
  const compKey = last && last.comparison && last.comparison.key;
  if (compKey) p.set("c", compKey);
  p.set("te", +lastInputs.T1_C.toFixed(2));
  p.set("tc", +lastInputs.T3_C.toFixed(2));
  if (lastInputs.superheat) {
    if (lastInputs.sh_by === "P") p.set("shp", +lastInputs.P_evap_kPa.toFixed(2));
    else p.set("sh", +lastInputs.dT_sh_K.toFixed(2));
  }
  if (lastInputs.subcool) {
    if (lastInputs.sc_by === "P") p.set("scp", +lastInputs.P_cond_kPa.toFixed(2));
    else p.set("sc", +lastInputs.dT_sc_K.toFixed(2));
  }
  if (lastInputs.eta_isen < 1) p.set("eta", Math.round(lastInputs.eta_isen * 100));
  const cap = getCapacityKW();
  if (cap) {
    p.set("q", +cap.toFixed(4));
    if (getCapacityUnit() === "TR") p.set("qu", "TR");
  }
  if (units.getSystem() === "IP") p.set("u", "IP");
  if (getChartMode() !== "ts") p.set("d", getChartMode());
  return `${location.origin}${location.pathname}?${p}`;
}

/** Restore a shared cycle from URL params and run it (fluid already selected). */
async function _applyShareParams(p) {
  if (p.get("d") === "ph") setChartMode("ph");
  const compKey = p.get("c");
  if (compKey && backend.getFluidMeta(compKey)) {
    document.getElementById("compare-fluid").value = compKey;
    openAdvancedSection();
    await handleComparisonChange();
  }
  const q = parseFloat(p.get("q"));
  if (q > 0) {
    setCapacity(q, p.get("qu"));
    openAdvancedSection();
  }
  const te = parseFloat(p.get("te"));
  const tc = parseFloat(p.get("tc"));
  if (isNaN(te) || isNaN(tc)) return;
  applyInputs({
    T1_C: te, T3_C: tc,
    superheat: p.has("sh") || p.has("shp"),
    sh_by: p.has("shp") ? "P" : "dT",
    dT_sh_K: parseFloat(p.get("sh")),
    P_evap_kPa: parseFloat(p.get("shp")),
    subcool: p.has("sc") || p.has("scp"),
    sc_by: p.has("scp") ? "P" : "dT",
    dT_sc_K: parseFloat(p.get("sc")),
    P_cond_kPa: parseFloat(p.get("scp")),
    eta_isen: p.has("eta") ? parseFloat(p.get("eta")) / 100 : 1,
  });
  await handleCalc();
}

/** Copy text to the clipboard with a brief ✓ flash on the trigger button. */
function _copyToClipboard(text, btn) {
  const done = () => {
    const orig = btn.textContent;
    btn.textContent = "✓ Copied";
    setTimeout(() => { btn.textContent = orig; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => {});
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (_) {}
    ta.remove();
  }
}

init();
