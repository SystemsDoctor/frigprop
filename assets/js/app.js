/**
 * app.js — Controller. Wires backend + cycle logic + UI together.
 * To switch to Plan A (CoolProp WASM), change this one import:
 */
import backend from "./tables.js";
import { computeVCRCStates, analyzeVCRC, validateCycle } from "./cycle.js";
import { getRefrigerantList, getRefrigerantInfo } from "./refrigerants.js";
import {
  setStatus, populateRefrigerantSelector, onRefrigerantChange,
  renderInfoPanel, wireInputControls, getInputs,
  enableCalcButton, onCalcClick, showError, clearError,
  renderResults, showTranscritWarning,
} from "./ui.js";

let currentFluidKey = null;

async function init() {
  wireInputControls();

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

  try {
    await backend.init(key);
    const info = await getRefrigerantInfo(key);
    const meta = backend.getFluidMeta(key);
    renderInfoPanel(key, info, meta);
    setStatus("ready", `Ready — ${key}`);
    enableCalcButton(true);
    clearError();
    // Hide old results
    document.getElementById("results-section").classList.add("hidden");
    document.getElementById("warnings-box").classList.add("hidden");
    document.getElementById("transcrit-notice").classList.add("hidden");
    document.getElementById("error-box").classList.add("hidden");
  } catch (err) {
    setStatus("error", "Load failed");
    showError(`Failed to load ${key}: ${err.message}`);
  }
}

async function handleCalc() {
  clearError();
  if (!currentFluidKey) return;

  const inputs = getInputs();

  // Validate inputs
  if (!inputs.superheat && isNaN(inputs.T1_C)) {
    showError("State 1: enter evaporator temperature (T1)."); return;
  }
  if (inputs.superheat && (isNaN(inputs.T1sh_C) || isNaN(inputs.P1sh_kPa))) {
    showError("State 1 (superheated): enter both T and P."); return;
  }
  if (!inputs.subcool && isNaN(inputs.T3_C)) {
    showError("State 3: enter condensing temperature (T3)."); return;
  }
  if (inputs.subcool && (isNaN(inputs.T3sc_C) || isNaN(inputs.P3sc_kPa))) {
    showError("State 3 (subcooled): enter both T and P."); return;
  }

  setStatus("working", "Calculating…");
  enableCalcButton(false);

  try {
    const states = await computeVCRCStates(backend, inputs);
    const metrics = analyzeVCRC(states);
    const { warnings } = validateCycle(states);

    // Transcritical check for R-744
    const meta = backend.getFluidMeta(currentFluidKey);
    let transcrit = false;
    if (meta && meta.T_crit_C !== undefined) {
      const T3 = inputs.subcool ? inputs.T3sc_C : inputs.T3_C;
      transcrit = T3 >= meta.T_crit_C;
    }
    showTranscritWarning(transcrit);

    renderResults(states, metrics, warnings);
    setStatus("ready", `Ready — ${currentFluidKey}`);
  } catch (err) {
    setStatus("ready", `Ready — ${currentFluidKey}`);
    showError(`Calculation error: ${err.message}`);
  } finally {
    enableCalcButton(true);
  }
}

init();
