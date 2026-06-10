/**
 * ui.js — DOM manipulation helpers for FrigProp.
 * No business logic here — pure rendering.
 */

const $ = id => document.getElementById(id);

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
    ["Normal B.P.",   `${info.normal_boiling_point_C} °C`, ""],
    ["T_crit",        `${info.T_crit_C} °C`,    ""],
    ["P_crit",        `${info.P_crit_kPa} kPa`, ""],
    ["T glide",       info.T_glide_C === 0 ? "0 (azeotrope)" : `${info.T_glide_C} °C`, info.T_glide_C > 1 ? "warn" : ""],
    ["M.W.",          `${info.molecular_weight} g/mol`, ""],
    ["Regulatory",    info.regulatory_status,   "warn"],
  ];

  if (info.blend_components) rows.push(["Components",  info.blend_components.join(", "), ""]);
  if (info.replaces && info.replaces.length)       rows.push(["Replaces",    info.replaces.join(", "), ""]);
  if (info.replaced_by && info.replaced_by.length) rows.push(["Replaced by", info.replaced_by.join(", "), "dim"]);
  if (info.typical_applications) rows.push(["Applications", info.typical_applications.join(", "), ""]);

  const tbl = document.createElement("table");
  tbl.className = "info-table";
  rows.forEach(([k, v, cls]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="info-key">${k}</td><td class="info-val ${cls || ""}">${v}</td>`;
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
    T1_C:     parseFloat($("T1").value),
    T3_C:     parseFloat($("T3").value),
    superheat: $("sh-inlet").checked,
    dT_sh_K:  parseFloat($("dT-sh").value),
    subcool:  $("sc-exit").checked,
    dT_sc_K:  parseFloat($("dT-sc").value),
  };
}

/** Show the selected fluid's valid temperature range under the inputs. */
export function setRangeHint(meta) {
  const el = $("range-hint");
  if (!el) return;
  if (!meta) { el.textContent = ""; return; }
  const T_hi = Math.min(meta.T_max_C, meta.T_crit_C - 0.5);
  el.textContent = `Saturation data: ${meta.T_min_C} °C to ${T_hi.toFixed(1)} °C · critical point ${meta.T_crit_C} °C`;
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

const PAIR_DEFS = {
  TP:   { fields: [["Temperature", "°C"], ["Pressure", "kPa"]] },
  PH:   { fields: [["Pressure", "kPa"], ["Enthalpy", "kJ/kg"]] },
  PS:   { fields: [["Pressure", "kPa"], ["Entropy", "kJ/kg·K"]] },
  TQ:   { fields: [["Temperature", "°C"], ["Quality", "0–1"]] },
  PQ:   { fields: [["Pressure", "kPa"], ["Quality", "0–1"]] },
  satT: { fields: [["Temperature", "°C"]] },
  satP: { fields: [["Pressure", "kPa"]] },
};

export function wireLookupControls(onSubmit) {
  const pairSel = $("lookup-pair");
  pairSel.addEventListener("change", () => {
    const def = PAIR_DEFS[pairSel.value];
    $("lookup-v1-label").textContent = def.fields[0][0];
    $("lookup-v1-unit").textContent  = def.fields[0][1];
    const v2row = $("lookup-v2-row");
    if (def.fields.length > 1) {
      v2row.classList.remove("hidden");
      $("lookup-v2-label").textContent = def.fields[1][0];
      $("lookup-v2-unit").textContent  = def.fields[1][1];
    } else {
      v2row.classList.add("hidden");
    }
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
  return {
    pair: $("lookup-pair").value,
    v1: parseFloat($("lookup-v1").value),
    v2: parseFloat($("lookup-v2").value),
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
    ["Phase",       phaseLabel,                          "highlight"],
    ["T",           `${fmt(st.T_C, 2)} °C`,              ""],
    ["P",           `${fmt(st.P_kPa, 1)} kPa`,           ""],
    ["h",           `${fmt(st.h, 2)} kJ/kg`,             ""],
    ["s",           `${fmt(st.s, 4)} kJ/kg·K`,           ""],
    ["u",           `${fmt(st.u, 2)} kJ/kg`,             ""],
    ["v",           `${st.rho ? (1 / st.rho).toPrecision(5) : "—"} m³/kg`, ""],
    ["ρ",           `${fmt(st.rho, 3)} kg/m³`,           ""],
  ];
  if (st.x !== null && st.x !== undefined) rows.push(["x", fmt(st.x, 4), ""]);
  if (st.cp !== null && st.cp !== undefined) rows.push(["cp", `${fmt(st.cp, 3)} kJ/kg·K`, ""]);
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
      ? `${fmt(sat.T_bubble_C, 2)} (bub) / ${fmt(sat.T_dew_C, 2)} (dew) °C`
      : `${fmt(sat.sat_T_C, 2)} °C`, "highlight"],
    ["P_sat", glideP
      ? `${fmt(sat.P_bub_kPa, 1)} (bub) / ${fmt(sat.P_dew_kPa, 1)} (dew) kPa`
      : `${fmt(sat.sat_P_kPa, 1)} kPa`, "highlight"],
    ["h_f / h_g",  `${fmt(sat.hf, 2)} / ${fmt(sat.hg, 2)} kJ/kg`, ""],
    ["s_f / s_g",  `${fmt(sat.sf, 4)} / ${fmt(sat.sg, 4)} kJ/kg·K`, ""],
    ["u_f / u_g",  `${fmt(sat.uf, 2)} / ${fmt(sat.ug, 2)} kJ/kg`, ""],
    ["v_f / v_g",  `${(1 / sat.rhof).toPrecision(5)} / ${(1 / sat.rhog).toPrecision(5)} m³/kg`, ""],
    ["ρ_f / ρ_g",  `${fmt(sat.rhof, 2)} / ${fmt(sat.rhog, 4)} kg/m³`, ""],
    ["h_fg",       `${fmt(sat.hg - sat.hf, 2)} kJ/kg`, ""],
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
      <td class="${phaseClass}">${fmt(s.T_C, 2)}</td>
      <td>${fmt(s.P_kPa, 2)}</td>
      <td>${fmt(s.h, 2)}</td>
      <td>${fmt(s.s, 4)}</td>
      <td>${fmt(s.u, 2)}</td>
      <td>${fmtX(s.x)}</td>
      <td>${fmt(s.rho, 3)}</td>
    `;
    tbody.appendChild(tr);
  });

  $("cop-c").textContent = fmt(metrics.COP_c, 3);
  $("cop-h").textContent = fmt(metrics.COP_h, 3);
  $("q-evap").innerHTML  = `${fmt(metrics.Q_evap, 2)} <span class="unit">kJ/kg</span>`;
  $("q-cond").innerHTML  = `${fmt(metrics.Q_cond, 2)} <span class="unit">kJ/kg</span>`;
  $("w-comp").innerHTML  = `${fmt(metrics.W_comp, 2)} <span class="unit">kJ/kg</span>`;
  $("energy-balance").innerHTML = `${fmt(metrics.energy_balance_residual, 4)} <span class="unit">kJ/kg</span>`;

  $("results-section").classList.remove("hidden");
}
