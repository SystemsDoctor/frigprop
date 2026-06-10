/**
 * app.js — Controller. Wires backend + cycle logic + UI together.
 * The property backend is swappable via this one import (same interface).
 */
import backend from "./tables.js";
import { computeVCRCStates, analyzeVCRC, validateCycle } from "./cycle.js";
import { getRefrigerantList, getRefrigerantInfo } from "./refrigerants.js";
import {
  setStatus, populateRefrigerantSelector, onRefrigerantChange,
  renderInfoPanel, wireInputControls, getInputs, setRangeHint,
  enableCalcButton, onCalcClick, showError, clearError,
  renderResults, showTranscritWarning, highlightRefCard,
  wireLookupControls, enableLookupButton, showLookupError,
  renderLookupState, renderLookupSat,
} from "./ui.js";
import { initTsChart, updateTsChart, clearCycleOverlay, setTsMarker } from "./chart.js";

let currentFluidKey = null;

async function init() {
  wireInputControls();
  wireLookupControls(handleLookup);
  initTsChart();

  try {
    // Pre-load manifest (no fluid yet)
    await backend.init("R134a");  // loads manifest + R134a tables as default

    const keys = await getRefrigerantList();
    // Pre-fetch all metadata so cards render with type/GWP badges immediately
    const allInfo = {};
    await Promise.all(keys.map(async k => { allInfo[k] = await getRefrigerantInfo(k); }));
    populateRefrigerantSelector(keys, allInfo);
    setStatus("ready", "Ready");

    // Default to R134a
    await selectFluid("R134a");

  } catch (err) {
    setStatus("error", "Load failed");
    showError(`Initialization failed: ${err.message}. Serve over HTTP (not file:///).`);
    return;
  }

  onRefrigerantChange(async key => {
    if (!key) return;
    await selectFluid(key);
  });

  onCalcClick(handleCalc);
}

async function selectFluid(key) {
  currentFluidKey = key;
  setStatus("working", "Loading…");
  enableCalcButton(false);
  enableLookupButton(false);

  try {
    await backend.init(key);
    const info = await getRefrigerantInfo(key);
    const meta = backend.getFluidMeta(key);
    renderInfoPanel(key, info, meta);
    setRangeHint(meta);
    highlightRefCard(key, info);
    setStatus("ready", `Ready — ${key}`);
    enableCalcButton(true);
    enableLookupButton(true);
    clearError();
    // Hide old results
    document.getElementById("results-section").classList.add("hidden");
    document.getElementById("warnings-box").classList.add("hidden");
    document.getElementById("notes-box").classList.add("hidden");
    document.getElementById("transcrit-notice").classList.add("hidden");
    document.getElementById("error-box").classList.add("hidden");
    document.getElementById("lookup-result").classList.add("hidden");
    document.getElementById("lookup-error").classList.add("hidden");
    setTsMarker(null);
    // Update T-s diagram with saturation dome for new fluid
    const satRows = backend.getSatRows(key);
    const fluidLabel = document.getElementById("ts-fluid-label");
    if (fluidLabel) fluidLabel.textContent = info ? info.ashrae_designation : key;
    if (satRows) updateTsChart(satRows, null);
  } catch (err) {
    setStatus("error", "Load failed");
    showError(`Failed to load ${key}: ${err.message}`);
  }
}

async function handleCalc() {
  clearError();
  if (!currentFluidKey) return;

  const inputs = getInputs();
  const meta = backend.getFluidMeta(currentFluidKey);

  // Validate inputs
  if (isNaN(inputs.T1_C)) {
    showError("State 1: enter evaporator temperature (T1)."); return;
  }
  if (inputs.superheat && (isNaN(inputs.dT_sh_K) || inputs.dT_sh_K < 0)) {
    showError("State 1 (superheated): enter superheat ΔT ≥ 0 K."); return;
  }
  if (isNaN(inputs.T3_C)) {
    showError("State 3: enter condensing temperature (T3)."); return;
  }
  if (inputs.subcool && (isNaN(inputs.dT_sc_K) || inputs.dT_sc_K < 0)) {
    showError("State 3 (subcooled): enter subcooling ΔT ≥ 0 K."); return;
  }

  // Range validation against fluid metadata (friendly, pre-backend)
  if (meta) {
    const T_hi = Math.min(meta.T_max_C, meta.T_crit_C - 0.5);
    const range = `${currentFluidKey} saturation data covers ${meta.T_min_C} °C to ${T_hi.toFixed(1)} °C`;
    if (inputs.T1_C < meta.T_min_C || inputs.T1_C > T_hi) {
      showError(`Evaporator temperature ${inputs.T1_C} °C out of range — ${range}.`); return;
    }
    if (inputs.T3_C >= meta.T_crit_C) {
      showTranscritWarning(true);
      showError(`Condensing temperature ${inputs.T3_C} °C is above the critical point ` +
                `(${meta.T_crit_C} °C) — transcritical operation is not supported by the ` +
                `subcritical cycle model. Choose T3 < ${T_hi.toFixed(1)} °C.`);
      return;
    }
    showTranscritWarning(false);
    if (inputs.T3_C < meta.T_min_C || inputs.T3_C > T_hi) {
      showError(`Condensing temperature ${inputs.T3_C} °C out of range — ${range}.`); return;
    }
    if (inputs.T3_C <= inputs.T1_C) {
      showError(`Condensing temperature (${inputs.T3_C} °C) must exceed evaporator temperature (${inputs.T1_C} °C).`); return;
    }
  }

  setStatus("working", "Calculating…");
  enableCalcButton(false);

  try {
    const states = await computeVCRCStates(backend, inputs);
    const metrics = analyzeVCRC(states);
    const { warnings, notes } = validateCycle(states);

    renderResults(states, metrics, warnings, notes);
    // Overlay cycle on T-s diagram
    const satRows = backend.getSatRows(currentFluidKey);
    if (satRows) updateTsChart(satRows, states);
    setStatus("ready", `Ready — ${currentFluidKey}`);
  } catch (err) {
    setStatus("ready", `Ready — ${currentFluidKey}`);
    showError(`Calculation error: ${err.message}`);
  } finally {
    enableCalcButton(true);
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
    if (pair === "satT" || pair === "satP") {
      const sat = await backend.getSatProps(pair === "satT" ? "T" : "P", v1);
      renderLookupSat(sat);
      setTsMarker(null);
    } else {
      const st = await backend.getProps(pair, v1, v2);
      renderLookupState(st, await _phaseLabel(st));
      setTsMarker({ x: st.s, y: st.T_C });
    }
  } catch (err) {
    showLookupError(err.message);
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

init();
