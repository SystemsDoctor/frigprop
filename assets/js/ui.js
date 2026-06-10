/**
 * ui.js — DOM manipulation helpers for FrigProp.
 * No business logic here — pure rendering. All values cross this module's
 * boundary in SI; display conversion goes through units.js.
 */

import * as units from "./units.js";

const $ = id => document.getElementById(id);

/** Format an SI value for display in the current unit system. */
function du(v, kind, decimals) {
  return fmt(units.toDisplay(v, kind), decimals);
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

export function setStatus(state, text) {
  const pill = $("status-pill");
  pill.className = `nav-badge ${state}`;
  pill.textContent = text;
}

// ---------------------------------------------------------------------------
// Refrigerant card grid (persistent — always visible, no toggle)
// ---------------------------------------------------------------------------

let _onRefrigerantChange = null;

export function populateRefrigerantSelector(keys, allInfo) {
  const grid = $("ref-cards");
  grid.innerHTML = "";

  keys.forEach(key => {
    const info     = allInfo && allInfo[key];
    const typeRaw  = info ? info.refrigerant_type : "";
    const typeSlug = _typeSlug(typeRaw);
    const gwp      = info ? info.GWP_AR5 : null;
    const safety   = info ? info.safety_class : "";
    const bp       = info ? info.normal_boiling_point_C : null;

    const card = document.createElement("div");
    card.className = "ref-card";
    card.dataset.key = key;

    card.innerHTML = `
      <div class="ref-card-name">${info ? info.ashrae_designation : key}</div>
      <div class="ref-card-meta">
        <span class="ref-badge ref-badge-type-${typeSlug}">${_typeLabel(typeRaw)}</span>
        ${safety ? `<span class="ref-badge ref-badge-safety">${safety}</span>` : ""}
      </div>
      <div class="ref-card-stats">
        ${gwp !== null ? `<span>GWP <span class="ref-card-stat-val ${_gwpClass(gwp)}">${gwp === 0 ? "&lt;1" : gwp}</span></span>` : ""}
        ${bp  !== null ? `<span>BP <span class="ref-card-stat-val">${bp}°C</span></span>` : ""}
      </div>
    `;

    card.addEventListener("click", () => {
      _selectCard(key, info);
      if (_onRefrigerantChange) _onRefrigerantChange(key);
    });

    grid.appendChild(card);
  });
}

export function onRefrigerantChange(handler) {
  _onRefrigerantChange = handler;
}

export function highlightRefCard(key, info) {
  _selectCard(key, info);
}

function _selectCard(key, info) {
  // Update nav display
  const navDisplay = $("nav-ref-display");
  if (navDisplay) navDisplay.textContent = info ? info.ashrae_designation : key;

  // Highlight selected card
  document.querySelectorAll(".ref-card").forEach(c => {
    c.classList.toggle("selected", c.dataset.key === key);
  });
}

function _typeSlug(type) {
  if (!type) return "hfc";
  const t = type.toLowerCase();
  if (t.includes("natural")) return "natural";
  if (t.includes("hcfo"))    return "hcfo";
  if (t.includes("hfo"))     return "hfo";
  if (t.includes("hcfc"))    return "hcfc";
  if (t.includes("cfc"))     return "cfc";
  if (t.includes("blend"))   return "blend";
  return "hfc";
}

function _typeLabel(type) {
  if (!type) return "HFC";
  const t = type.toLowerCase();
  if (t.includes("natural")) return "Natural";
  if (t.includes("hcfo"))    return "HCFO";
  if (t.includes("hfo"))     return "HFO";
  if (t.includes("hcfc"))    return "HCFC";
  if (t.includes("cfc"))     return "CFC";
  if (t === "hfc blend" || t.includes("blend")) return "Blend";
  return "HFC";
}

function _gwpClass(gwp) {
  if (gwp <= 10)   return "ref-badge-gwp-low";
  if (gwp <= 700)  return "ref-badge-gwp-mid";
  if (gwp <= 1500) return "ref-badge-gwp-high";
  return "ref-badge-gwp-vhigh";
}

// ---------------------------------------------------------------------------
// Info panel
// ---------------------------------------------------------------------------

// Hover explanations for each property row (esp. initialisms)
const INFO_TIPS = {
  "Designation":   "ASHRAE Standard 34 refrigerant number",
  "Chemical name": "Chemical name of the working fluid",
  "Formula":       "Chemical formula",
  "Type":          "Chemical family / refrigerant generation",
  "Safety class":  "ASHRAE 34 safety group: toxicity (A = lower, B = higher) + flammability (1 = none … 3 = high)",
  "GWP (AR5)":     "Global Warming Potential over 100 years, IPCC AR5 basis (CO₂ = 1)",
  "ODP":           "Ozone Depletion Potential relative to R-11 (= 1.0)",
  "Normal B.P.":   "Boiling temperature at 1 atm (101.325 kPa)",
  "T_crit":        "Critical temperature — above it no liquid phase exists",
  "P_crit":        "Critical pressure — saturation pressure at the critical point",
  "T glide":       "Temperature glide: dew − bubble temperature spread during phase change (zeotropic blends)",
  "M.W.":          "Molecular weight (molar mass)",
  "Regulatory":    "Phase-out / phasedown status under the Montreal Protocol, EU F-Gas rules, or EPA SNAP",
  "Components":    "Blend composition by mass fraction",
  "Replaces":      "Refrigerants this fluid was developed to replace",
  "Replaced by":   "Lower-GWP successors replacing this fluid",
  "Applications":  "Typical system types using this fluid",
  "h/s reference": "Zero-point convention for enthalpy and entropy — values are only comparable within one convention",
};

export function renderInfoPanel(key, info, meta) {
  const panel = $("info-content");
  panel.innerHTML = "";

  const gwpColor    = info.GWP_AR5 <= 10 ? "good" : info.GWP_AR5 <= 150 ? "" : info.GWP_AR5 <= 1000 ? "warn" : "danger";
  const odpColor    = info.ODP > 0 ? "danger" : "good";
  const safetyColor = info.safety_class.includes("B") ? "warn" : "";

  const rows = [
    ["Designation",   info.ashrae_designation,  "highlight"],
    ["Chemical name", info.chemical_name,        ""],
    ["Formula",       info.formula,              ""],
    ["Type",          info.refrigerant_type,     ""],
    ["Safety class",  info.safety_class,         safetyColor],
    ["GWP (AR5)",     info.GWP_AR5 === 0 ? "0 (natural)" : info.GWP_AR5.toString(), gwpColor],
    ["ODP",           info.ODP === 0 ? "0.00" : info.ODP.toString(), odpColor],
    ["Normal B.P.",   `${du(info.normal_boiling_point_C, "T", 1)} ${units.label("T")}`, ""],
    ["T_crit",        `${du(info.T_crit_C, "T", 1)} ${units.label("T")}`, ""],
    ["P_crit",        `${du(info.P_crit_kPa, "P", 1)} ${units.label("P")}`, ""],
    ["T glide",       info.T_glide_C === 0 ? "0 (azeotrope)" : `${du(info.T_glide_C, "dT", 1)} ${units.label("dT")}`, info.T_glide_C > 1 ? "warn" : ""],
    ["M.W.",          `${info.molecular_weight} g/mol`, ""],
    ["Regulatory",    info.regulatory_status,   "warn"],
  ];

  if (info.blend_components) rows.push(["Components",  info.blend_components.join(", "), ""]);
  if (info.replaces && info.replaces.length)       rows.push(["Replaces",    info.replaces.join(", "), ""]);
  if (info.replaced_by && info.replaced_by.length) rows.push(["Replaced by", info.replaced_by.join(", "), "dim"]);
  if (info.typical_applications) rows.push(["Applications", info.typical_applications.join(", "), ""]);
  // h/s values are only comparable within one reference convention
  if (info.reference_state) rows.push(["h/s reference", info.reference_state, "dim"]);

  const tbl = document.createElement("table");
  tbl.className = "info-table";
  rows.forEach(([k, v, cls]) => {
    const tr = document.createElement("tr");
    const tip = INFO_TIPS[k] ? ` title="${INFO_TIPS[k]}"` : "";
    tr.innerHTML = `<td class="info-key${INFO_TIPS[k] ? " has-tip" : ""}"${tip}>${k}</td><td class="info-val ${cls || ""}">${v}</td>`;
    tbl.appendChild(tr);
  });
  panel.appendChild(tbl);

  if (meta) {
    const note = document.createElement("div");
    note.className = "info-section-header";
    note.style.marginTop = "6px";
    note.textContent = `Table range: ${meta.T_min_C}°C – ${meta.T_max_C}°C · P_max ${meta.P_max_kPa} kPa`;
    panel.appendChild(note);
  }
}

// ---------------------------------------------------------------------------
// Input controls
// ---------------------------------------------------------------------------

export function wireInputControls() {
  $("sh-inlet").addEventListener("change", function () {
    const extra = $("sh-inlet-extra");
    const badge = $("badge-s1");
    if (this.checked) {
      extra.classList.remove("hidden");
      if (badge) { badge.className = "state-badge state-superheated"; badge.textContent = "superheated"; }
    } else {
      extra.classList.add("hidden");
      if (badge) { badge.className = "state-badge state-saturated"; badge.textContent = "sat. vapor"; }
    }
  });

  $("sc-exit").addEventListener("change", function () {
    const extra = $("sc-exit-extra");
    const badge = $("badge-s3");
    if (this.checked) {
      extra.classList.remove("hidden");
      if (badge) { badge.className = "state-badge state-subcooled"; badge.textContent = "subcooled"; }
    } else {
      extra.classList.add("hidden");
      if (badge) { badge.className = "state-badge state-subcooled"; badge.textContent = "sat. liquid"; }
    }
  });
}

export function getInputs() {
  return {
    T1_C:     units.fromInput(parseFloat($("T1").value), "T"),
    T3_C:     units.fromInput(parseFloat($("T3").value), "T"),
    superheat: $("sh-inlet").checked,
    dT_sh_K:  units.fromInput(parseFloat($("dT-sh").value), "dT"),
    subcool:  $("sc-exit").checked,
    dT_sc_K:  units.fromInput(parseFloat($("dT-sc").value), "dT"),
  };
}

/** Show the selected fluid's valid temperature range under the inputs. */
export function setRangeHint(meta) {
  const el = $("range-hint");
  if (!el) return;
  if (!meta) { el.textContent = ""; return; }
  const T_hi = Math.min(meta.T_max_C, meta.T_crit_C - 0.5);
  const L = units.label("T");
  el.textContent = `Saturation data: ${du(meta.T_min_C, "T", 1)} ${L} to ${du(T_hi, "T", 1)} ${L} · critical point ${du(meta.T_crit_C, "T", 1)} ${L}`;
}

// ---------------------------------------------------------------------------
// Unit system toggle
// ---------------------------------------------------------------------------

/** Rewrite all static unit labels and placeholders for the current system. */
export function refreshUnitLabels() {
  document.querySelectorAll("[data-kind]").forEach(el => {
    el.textContent = units.label(el.dataset.kind);
  });
  document.querySelectorAll("input[data-ph-si]").forEach(el => {
    el.placeholder = units.getSystem() === "IP" ? el.dataset.phIp : el.dataset.phSi;
  });
  const toggle = $("unit-toggle");
  if (toggle) {
    toggle.querySelectorAll(".unit-opt").forEach(o => {
      o.classList.toggle("active", o.dataset.sys === units.getSystem());
    });
  }
}

export function onUnitToggle(handler) {
  const btn = $("unit-toggle");
  if (btn) btn.addEventListener("click", handler);
}

export function enableCalcButton(enabled) {
  $("calc-btn").disabled = !enabled;
}

export function onCalcClick(handler) {
  $("calc-btn").addEventListener("click", handler);
}

// ---------------------------------------------------------------------------
// Property lookup pane
// ---------------------------------------------------------------------------

// field: [label, unit-kind]
const PAIR_DEFS = {
  TP:   { fields: [["Temperature", "T"], ["Pressure", "P"]] },
  PH:   { fields: [["Pressure", "P"], ["Enthalpy", "h"]] },
  PS:   { fields: [["Pressure", "P"], ["Entropy", "s"]] },
  TQ:   { fields: [["Temperature", "T"], ["Quality", "x"]] },
  PQ:   { fields: [["Pressure", "P"], ["Quality", "x"]] },
  satT: { fields: [["Temperature", "T"]] },
  satP: { fields: [["Pressure", "P"]] },
};

/** Re-apply labels/units for the selected lookup pair (also on unit toggle). */
export function refreshLookupFields() {
  const def = PAIR_DEFS[$("lookup-pair").value];
  $("lookup-v1-label").textContent = def.fields[0][0];
  $("lookup-v1-unit").textContent  = units.label(def.fields[0][1]);
  const v2row = $("lookup-v2-row");
  if (def.fields.length > 1) {
    v2row.classList.remove("hidden");
    $("lookup-v2-label").textContent = def.fields[1][0];
    $("lookup-v2-unit").textContent  = units.label(def.fields[1][1]);
  } else {
    v2row.classList.add("hidden");
  }
}

export function wireLookupControls(onSubmit) {
  $("lookup-pair").addEventListener("change", () => {
    refreshLookupFields();
    $("lookup-result").classList.add("hidden");
    clearLookupError();
  });

  const submit = () => onSubmit(getLookupInputs());
  $("lookup-btn").addEventListener("click", submit);
  for (const id of ["lookup-v1", "lookup-v2"]) {
    $(id).addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  }
}

export function getLookupInputs() {
  const def = PAIR_DEFS[$("lookup-pair").value];
  return {
    pair: $("lookup-pair").value,
    v1: units.fromInput(parseFloat($("lookup-v1").value), def.fields[0][1]),
    v2: def.fields.length > 1
      ? units.fromInput(parseFloat($("lookup-v2").value), def.fields[1][1])
      : NaN,
  };
}

export function enableLookupButton(enabled) {
  $("lookup-btn").disabled = !enabled;
}

export function showLookupError(msg) {
  const box = $("lookup-error");
  box.textContent = msg;
  box.classList.remove("hidden");
  $("lookup-result").classList.add("hidden");
}

export function clearLookupError() {
  $("lookup-error").classList.add("hidden");
}

/** Render a single-/two-phase state in the lookup pane. */
export function renderLookupState(st, phaseLabel) {
  clearLookupError();
  const rows = [
    ["Phase",       phaseLabel,                                      "highlight"],
    ["T",           `${du(st.T_C, "T", 2)} ${units.label("T")}`,     ""],
    ["P",           `${du(st.P_kPa, "P", 1)} ${units.label("P")}`,   ""],
    ["h",           `${du(st.h, "h", 2)} ${units.label("h")}`,       ""],
    ["s",           `${du(st.s, "s", 4)} ${units.label("s")}`,       ""],
    ["u",           `${du(st.u, "u", 2)} ${units.label("u")}`,       ""],
    ["v",           `${st.rho ? units.toDisplay(1 / st.rho, "v").toPrecision(5) : "—"} ${units.label("v")}`, ""],
    ["ρ",           `${du(st.rho, "rho", 3)} ${units.label("rho")}`, ""],
  ];
  if (st.x !== null && st.x !== undefined) rows.push(["x", fmt(st.x, 4), ""]);
  if (st.cp !== null && st.cp !== undefined) rows.push(["cp", `${du(st.cp, "cp", 3)} ${units.label("cp")}`, ""]);
  _renderLookupTable(rows);
}

/** Render a full saturation row (f/g sides) in the lookup pane. */
export function renderLookupSat(sat) {
  clearLookupError();
  // Zeotropic glide shows in T for P-keyed rows, in P for T-keyed rows
  const glideT = Math.abs(sat.T_dew_C - sat.T_bubble_C) > 0.05;
  const glideP = Math.abs(sat.P_dew_kPa - sat.P_bub_kPa) > 0.001 * sat.P_bub_kPa;
  const rows = [
    ["T_sat", glideT
      ? `${du(sat.T_bubble_C, "T", 2)} (bub) / ${du(sat.T_dew_C, "T", 2)} (dew) ${units.label("T")}`
      : `${du(sat.sat_T_C, "T", 2)} ${units.label("T")}`, "highlight"],
    ["P_sat", glideP
      ? `${du(sat.P_bub_kPa, "P", 1)} (bub) / ${du(sat.P_dew_kPa, "P", 1)} (dew) ${units.label("P")}`
      : `${du(sat.sat_P_kPa, "P", 1)} ${units.label("P")}`, "highlight"],
    ["h_f / h_g",  `${du(sat.hf, "h", 2)} / ${du(sat.hg, "h", 2)} ${units.label("h")}`, ""],
    ["s_f / s_g",  `${du(sat.sf, "s", 4)} / ${du(sat.sg, "s", 4)} ${units.label("s")}`, ""],
    ["u_f / u_g",  `${du(sat.uf, "u", 2)} / ${du(sat.ug, "u", 2)} ${units.label("u")}`, ""],
    ["v_f / v_g",  `${units.toDisplay(1 / sat.rhof, "v").toPrecision(5)} / ${units.toDisplay(1 / sat.rhog, "v").toPrecision(5)} ${units.label("v")}`, ""],
    ["ρ_f / ρ_g",  `${du(sat.rhof, "rho", 2)} / ${du(sat.rhog, "rho", 4)} ${units.label("rho")}`, ""],
    ["h_fg",       `${du(sat.hg - sat.hf, "h", 2)} ${units.label("h")}`, ""],
  ];
  _renderLookupTable(rows);
}

function _renderLookupTable(rows) {
  const box = $("lookup-result");
  box.innerHTML = "";
  const tbl = document.createElement("table");
  tbl.className = "info-table";
  rows.forEach(([k, v, cls]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="info-key">${k}</td><td class="info-val ${cls || ""}">${v}</td>`;
    tbl.appendChild(tr);
  });
  box.appendChild(tbl);
  box.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function showError(msg) {
  const box = $("error-box");
  box.textContent = msg;
  box.classList.remove("hidden");
  $("results-section").classList.add("hidden");
  $("warnings-box").classList.add("hidden");
  const nbox = $("notes-box");
  if (nbox) nbox.classList.add("hidden");
}

export function clearError() {
  $("error-box").textContent = "";
  $("error-box").classList.add("hidden");
}

export function showTranscritWarning(show) {
  const el = $("transcrit-notice");
  if (show) el.classList.remove("hidden"); else el.classList.add("hidden");
}

function fmt(v, decimals) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return v.toFixed(decimals);
}

function fmtX(x) {
  if (x === null || x === undefined) return '<span class="val-x-single">—</span>';
  return `<span class="val-x-twophase">${fmt(x, 3)}</span>`;
}

export function renderResults(states, metrics, warnings, notes) {
  clearError();

  const wbox = $("warnings-box");
  if (warnings && warnings.length) {
    wbox.innerHTML = "<strong>Warnings:</strong><ul>" +
      warnings.map(w => `<li>${w}</li>`).join("") + "</ul>";
    wbox.classList.remove("hidden");
  } else {
    wbox.classList.add("hidden");
  }

  const nbox = $("notes-box");
  if (nbox) {
    if (notes && notes.length) {
      nbox.innerHTML = notes.map(n => `<div>ⓘ ${n}</div>`).join("");
      nbox.classList.remove("hidden");
    } else {
      nbox.classList.add("hidden");
    }
  }

  const tbody = $("results-tbody");
  tbody.innerHTML = "";
  states.forEach((s, i) => {
    const phaseClass = s.x === null
      ? (i === 0 || i === 1 ? "val-vapor" : "val-liquid")
      : "";
    const isDerived  = i === 1 || i === 3;
    const badgeClass = isDerived
      ? "state-badge state-badge-derived"
      : "state-badge";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="${badgeClass}">${i + 1}</span></td>
      <td class="${phaseClass}">${du(s.T_C, "T", 2)}</td>
      <td>${du(s.P_kPa, "P", 2)}</td>
      <td>${du(s.h, "h", 2)}</td>
      <td>${du(s.s, "s", 4)}</td>
      <td>${du(s.u, "u", 2)}</td>
      <td>${fmtX(s.x)}</td>
      <td>${du(s.rho, "rho", 3)}</td>
    `;
    tbody.appendChild(tr);
  });

  const hUnit = units.label("h");
  $("cop-c").textContent = fmt(metrics.COP_c, 3);
  $("cop-h").textContent = fmt(metrics.COP_h, 3);
  $("q-evap").innerHTML  = `${du(metrics.Q_evap, "h", 2)} <span class="unit">${hUnit}</span>`;
  $("q-cond").innerHTML  = `${du(metrics.Q_cond, "h", 2)} <span class="unit">${hUnit}</span>`;
  $("w-comp").innerHTML  = `${du(metrics.W_comp, "h", 2)} <span class="unit">${hUnit}</span>`;

  $("results-section").classList.remove("hidden");
}
