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

// Gallery cluster order: modern low-GWP families first, legacy last.
const TYPE_RANK = ["natural", "hfo", "hfo-blend", "hcfo", "hfc", "hfc-blend", "hcfc", "cfc"];

/** Group key for clustering (finer than the badge slug: blends split out). */
function _typeRank(type) {
  const t = (type || "").toLowerCase();
  let group;
  if      (t.includes("natural")) group = "natural";
  else if (t.includes("hcfo"))    group = "hcfo";
  else if (t.includes("hfo"))     group = t.includes("blend") ? "hfo-blend" : "hfo";
  else if (t.includes("hcfc"))    group = "hcfc";
  else if (t.includes("hfc"))     group = t.includes("blend") ? "hfc-blend" : "hfc";
  else if (t.includes("cfc"))     group = "cfc";
  else                            group = "hfc";
  return TYPE_RANK.indexOf(group);
}

/** Sort: type cluster, then ASHRAE number, then key (R600 < R600a). */
function _sortRefrigerantKeys(keys, allInfo) {
  const num = k => parseInt(k.replace(/\D/g, ""), 10) || 0;
  return [...keys].sort((a, b) => {
    const ra = _typeRank(allInfo[a] && allInfo[a].refrigerant_type);
    const rb = _typeRank(allInfo[b] && allInfo[b].refrigerant_type);
    return ra - rb || num(a) - num(b) || a.localeCompare(b);
  });
}

export function populateRefrigerantSelector(keys, allInfo) {
  const grid = $("ref-cards");
  grid.innerHTML = "";

  _sortRefrigerantKeys(keys, allInfo).forEach(key => {
    const info     = allInfo && allInfo[key];
    const typeRaw  = info ? info.refrigerant_type : "";
    const typeSlug = _typeSlug(typeRaw);
    const gwp      = info ? info.GWP_AR5 : null;
    const safety   = info ? info.safety_class : "";
    const bp       = info ? info.normal_boiling_point_C : null;

    const card = document.createElement("div");
    card.className = "ref-card";
    card.dataset.key = key;
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", "false");
    card.setAttribute("aria-label", `${info ? info.ashrae_designation : key} — ${_typeLabel(typeRaw)}`);
    card.tabIndex = -1;

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

    const select = () => {
      _selectCard(key, info);
      if (_onRefrigerantChange) _onRefrigerantChange(key);
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
    });

    grid.appendChild(card);
  });

  _wireGalleryKeyboardNav(grid);
}

/** Roving-tabindex arrow-key navigation across the card grid. */
function _wireGalleryKeyboardNav(grid) {
  const cards = [...grid.querySelectorAll(".ref-card")];
  if (cards.length) cards[0].tabIndex = 0;
  grid.addEventListener("keydown", e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const i = cards.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = cards[(i + step + cards.length) % cards.length];
    cards.forEach(c => { c.tabIndex = -1; });
    next.tabIndex = 0;
    next.focus();
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
    const sel = c.dataset.key === key;
    c.classList.toggle("selected", sel);
    c.setAttribute("aria-checked", sel ? "true" : "false");
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

/** Selected "specify by" mode for a radio group: "dT" or "P". */
function _specBy(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : "dT";
}

/** In pressure mode the T field means the actual state temperature. */
function _refreshStateLabels() {
  const shP = $("sh-inlet").checked && _specBy("sh-by") === "P";
  const scP = $("sc-exit").checked && _specBy("sc-by") === "P";
  $("T1-label").textContent = shP ? "Compressor Inlet Temperature" : "Evaporator Temperature";
  $("T3-label").textContent = scP ? "Condenser Exit Temperature" : "Condensing Temperature";
  $("sh-dT-row").classList.toggle("hidden", _specBy("sh-by") === "P");
  $("sh-P-row").classList.toggle("hidden", _specBy("sh-by") !== "P");
  $("sc-dT-row").classList.toggle("hidden", _specBy("sc-by") === "P");
  $("sc-P-row").classList.toggle("hidden", _specBy("sc-by") !== "P");
}

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
    _refreshStateLabels();
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
    _refreshStateLabels();
  });

  document.querySelectorAll('input[name="sh-by"], input[name="sc-by"]').forEach(r => {
    r.addEventListener("change", _refreshStateLabels);
  });
}

export function getInputs() {
  const etaPct = parseFloat($("eta-isen").value);
  return {
    T1_C:     units.fromInput(parseFloat($("T1").value), "T"),
    T3_C:     units.fromInput(parseFloat($("T3").value), "T"),
    superheat: $("sh-inlet").checked,
    sh_by:    _specBy("sh-by"),
    dT_sh_K:  units.fromInput(parseFloat($("dT-sh").value), "dT"),
    P_evap_kPa: units.fromInput(parseFloat($("P-evap").value), "P"),
    subcool:  $("sc-exit").checked,
    sc_by:    _specBy("sc-by"),
    dT_sc_K:  units.fromInput(parseFloat($("dT-sc").value), "dT"),
    P_cond_kPa: units.fromInput(parseFloat($("P-cond").value), "P"),
    eta_isen: isNaN(etaPct) ? 1 : etaPct / 100,
  };
}

/** Restore cycle inputs (SI values, e.g. from a share URL). Inverse of getInputs. */
export function applyInputs(inp) {
  const set = (id, v, kind) => {
    if (v !== undefined && v !== null && !isNaN(v)) $(id).value = +units.toDisplay(v, kind).toFixed(4);
  };
  set("T1", inp.T1_C, "T");
  set("T3", inp.T3_C, "T");
  set("dT-sh", inp.dT_sh_K, "dT");
  set("P-evap", inp.P_evap_kPa, "P");
  set("dT-sc", inp.dT_sc_K, "dT");
  set("P-cond", inp.P_cond_kPa, "P");
  if (inp.eta_isen !== undefined && inp.eta_isen < 1) $("eta-isen").value = Math.round(inp.eta_isen * 100);
  for (const [name, v] of [["sh-by", inp.sh_by], ["sc-by", inp.sc_by]]) {
    const radio = document.querySelector(`input[name="${name}"][value="${v}"]`);
    if (radio) radio.checked = true;
  }
  for (const [id, on] of [["sh-inlet", inp.superheat], ["sc-exit", inp.subcool]]) {
    $(id).checked = !!on;
    $(id).dispatchEvent(new Event("change"));  // badge + extra-field visibility
  }
}

// ---------------------------------------------------------------------------
// Comparison fluid selector
// ---------------------------------------------------------------------------

export function populateComparisonSelect(keys, allInfo) {
  const sel = $("compare-fluid");
  _sortRefrigerantKeys(keys, allInfo).forEach(key => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = allInfo[key] ? allInfo[key].ashrae_designation : key;
    sel.appendChild(opt);
  });
}

/** Comparison fluid key, or null when none / same as the primary. */
export function getComparisonFluid(primaryKey) {
  const v = $("compare-fluid").value;
  return v && v !== primaryKey ? v : null;
}

export function onComparisonChange(handler) {
  $("compare-fluid").addEventListener("change", () => handler($("compare-fluid").value || null));
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

// field: [label, unit-kind, SI placeholder, IP placeholder]
const PAIR_DEFS = {
  TP:   { fields: [["Temperature", "T", "e.g. 25", "e.g. 77"], ["Pressure", "P", "e.g. 500", "e.g. 73"]] },
  PH:   { fields: [["Pressure", "P", "e.g. 500", "e.g. 73"], ["Enthalpy", "h", "e.g. 250", "e.g. 107"]] },
  PS:   { fields: [["Pressure", "P", "e.g. 500", "e.g. 73"], ["Entropy", "s", "e.g. 1.15", "e.g. 0.27"]] },
  TQ:   { fields: [["Temperature", "T", "e.g. 25", "e.g. 77"], ["Quality", "x", "e.g. 0.5", "e.g. 0.5"]] },
  PQ:   { fields: [["Pressure", "P", "e.g. 500", "e.g. 73"], ["Quality", "x", "e.g. 0.5", "e.g. 0.5"]] },
  satT: { fields: [["Temperature", "T", "e.g. 25", "e.g. 77"]] },
  satP: { fields: [["Pressure", "P", "e.g. 500", "e.g. 73"]] },
};

/** Re-apply labels/units/placeholders for the selected lookup pair (also on unit toggle). */
export function refreshLookupFields() {
  const def = PAIR_DEFS[$("lookup-pair").value];
  const ph  = f => units.getSystem() === "IP" ? f[3] : f[2];
  $("lookup-v1-label").textContent = def.fields[0][0];
  $("lookup-v1-unit").textContent  = units.label(def.fields[0][1]);
  $("lookup-v1").placeholder       = ph(def.fields[0]);
  const v2row = $("lookup-v2-row");
  if (def.fields.length > 1) {
    v2row.classList.remove("hidden");
    $("lookup-v2-label").textContent = def.fields[1][0];
    $("lookup-v2-unit").textContent  = units.label(def.fields[1][1]);
    $("lookup-v2").placeholder       = ph(def.fields[1]);
  } else {
    v2row.classList.add("hidden");
  }
}

export function wireLookupControls(onSubmit) {
  refreshLookupFields();  // initial labels + placeholders
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

// metric rows shared by the single and comparison performance views:
// [label (HTML), metrics key, unit-kind|null, decimals]
const METRIC_ROWS = [
  ["COP<sub>c</sub> — Cooling",  "COP_c",         null, 3],
  ["COP<sub>h</sub> — Heating",  "COP_h",         null, 3],
  ["Q<sub>evap</sub>",           "Q_evap",        "h",  2],
  ["Q<sub>cond</sub>",           "Q_cond",        "h",  2],
  ["W<sub>comp</sub>",           "W_comp",        "h",  2],
  ["Pressure ratio",             "P_ratio",       null, 2],
  ["Discharge T<sub>2</sub>",    "T_discharge_C", "T",  1],
];

/**
 * Render the cycle results.
 * @param {object}      primary     — { key, states, metrics, warnings, notes }
 * @param {object|null} comparison  — { key, states, metrics } for side-by-side
 */
export function renderResults(primary, comparison) {
  clearError();
  const { states, metrics, warnings, notes } = primary;

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

  $("states-fluid-label").textContent = comparison ? `${primary.key} (primary)` : primary.key;

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

  if (comparison) {
    _renderComparisonMetrics(primary, comparison);
  } else {
    const hUnit = units.label("h");
    $("cop-c").textContent = fmt(metrics.COP_c, 3);
    $("cop-h").textContent = fmt(metrics.COP_h, 3);
    $("q-evap").innerHTML  = `${du(metrics.Q_evap, "h", 2)} <span class="unit">${hUnit}</span>`;
    $("q-cond").innerHTML  = `${du(metrics.Q_cond, "h", 2)} <span class="unit">${hUnit}</span>`;
    $("w-comp").innerHTML  = `${du(metrics.W_comp, "h", 2)} <span class="unit">${hUnit}</span>`;
    $("p-ratio").textContent = fmt(metrics.P_ratio, 2);
    $("t-discharge").innerHTML = `${du(metrics.T_discharge_C, "T", 1)} <span class="unit">${units.label("T")}</span>`;
  }
  $("perf-single").classList.toggle("hidden", !!comparison);
  $("perf-compare").classList.toggle("hidden", !comparison);

  $("results-section").classList.remove("hidden");
}

/** Side-by-side metrics table for the two compared fluids. */
function _renderComparisonMetrics(primary, comparison) {
  const box = $("perf-compare");
  const cell = (m, [, key, kind, dec]) => {
    const v = m[key];
    const txt = kind ? `${du(v, kind, dec)} <span class="unit">${units.label(kind)}</span>` : fmt(v, dec);
    return `<td>${txt}</td>`;
  };
  box.innerHTML = `
    <table class="results-table" aria-label="Performance comparison">
      <thead><tr><th style="text-align:left">Metric</th><th>${primary.key}</th><th>${comparison.key}</th></tr></thead>
      <tbody>
        ${METRIC_ROWS.map(r => `
          <tr><td style="text-align:left;color:var(--text-dim)">${r[0]}</td>
          ${cell(primary.metrics, r)}${cell(comparison.metrics, r)}</tr>`).join("")}
      </tbody>
    </table>`;
}

/** Build a CSV export (current display units) of states + performance. */
export function buildResultsCSV(primary, comparison) {
  const L = k => units.label(k);
  const lines = [];
  const block = ({ key, states, metrics }) => {
    lines.push(`Fluid,${key}`);
    lines.push(`State,T (${L("T")}),P (${L("P")}),h (${L("h")}),s (${L("s")}),u (${L("u")}),x,rho (${L("rho")})`);
    states.forEach((s, i) => lines.push([
      i + 1, du(s.T_C, "T", 2), du(s.P_kPa, "P", 2), du(s.h, "h", 2),
      du(s.s, "s", 4), du(s.u, "u", 2), s.x === null ? "" : fmt(s.x, 4),
      du(s.rho, "rho", 3),
    ].join(",")));
    lines.push(`COP_c,${fmt(metrics.COP_c, 3)}`);
    lines.push(`COP_h,${fmt(metrics.COP_h, 3)}`);
    lines.push(`Q_evap (${L("h")}),${du(metrics.Q_evap, "h", 2)}`);
    lines.push(`Q_cond (${L("h")}),${du(metrics.Q_cond, "h", 2)}`);
    lines.push(`W_comp (${L("h")}),${du(metrics.W_comp, "h", 2)}`);
    lines.push(`Pressure ratio,${fmt(metrics.P_ratio, 2)}`);
    lines.push(`Discharge T2 (${L("T")}),${du(metrics.T_discharge_C, "T", 1)}`);
  };
  block(primary);
  if (comparison) { lines.push(""); block(comparison); }
  return lines.join("\n") + "\n";
}
