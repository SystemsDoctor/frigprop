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
  pill.className = `status-pill ${state}`;
  pill.textContent = text;
}

// ---------------------------------------------------------------------------
// Refrigerant card picker
// ---------------------------------------------------------------------------

let _onRefrigerantChange = null;
let _selectedKey = null;

export function populateRefrigerantSelector(keys, allInfo) {
  const btn    = $("ref-select-btn");
  const cards  = $("ref-cards");

  cards.innerHTML = "";

  keys.forEach(key => {
    const info = allInfo && allInfo[key];
    const card = document.createElement("div");
    card.className = "ref-card";
    card.setAttribute("role", "option");
    card.dataset.key = key;

    const typeRaw = info ? info.refrigerant_type : "";
    const typeSlug = _typeSlug(typeRaw);
    const gwp = info ? info.GWP_AR5 : null;
    const safety = info ? info.safety_class : "";
    const bp = info ? info.normal_boiling_point_C : null;

    card.innerHTML = `
      <div class="ref-card-name">${info ? info.ashrae_designation : key}</div>
      <div class="ref-card-meta">
        <span class="ref-badge ref-badge-type-${typeSlug}">${_typeLabel(typeRaw)}</span>
        ${safety ? `<span class="ref-badge ref-badge-safety">${safety}</span>` : ""}
      </div>
      <div class="ref-card-stats">
        ${gwp !== null ? `<span>GWP <span class="ref-card-stat-val ${_gwpClass(gwp)}">${gwp === 0 ? "<1" : gwp}</span></span>` : ""}
        ${bp !== null ? `<span>BP <span class="ref-card-stat-val">${bp}°C</span></span>` : ""}
      </div>
    `;

    card.addEventListener("click", () => {
      _selectCard(key, btn, allInfo && allInfo[key]);
      _closePicker();
      if (_onRefrigerantChange) _onRefrigerantChange(key);
    });

    cards.appendChild(card);
  });

  btn.disabled = false;
}

export function onRefrigerantChange(handler) {
  _onRefrigerantChange = handler;

  const btn    = $("ref-select-btn");
  const picker = $("ref-picker");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !picker.classList.contains("hidden");
    if (isOpen) {
      _closePicker();
    } else {
      _openPicker();
    }
  });

  document.addEventListener("click", (e) => {
    if (!$("ref-select-wrap").contains(e.target)) _closePicker();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") _closePicker();
  });
}

function _openPicker() {
  const btn    = $("ref-select-btn");
  const picker = $("ref-picker");
  picker.classList.remove("hidden");
  btn.classList.add("open");
}

function _closePicker() {
  const btn    = $("ref-select-btn");
  const picker = $("ref-picker");
  picker.classList.add("hidden");
  btn.classList.remove("open");
}

function _selectCard(key, btn, info) {
  _selectedKey = key;
  $("ref-select-label").textContent = info ? info.ashrae_designation : key;

  // Highlight selected card
  document.querySelectorAll(".ref-card").forEach(c => {
    c.classList.toggle("selected", c.dataset.key === key);
  });
}

function _typeSlug(type) {
  if (!type) return "hfc";
  const t = type.toLowerCase();
  if (t.includes("natural")) return "natural";
  if (t.includes("hfo"))  return "hfo";
  if (t.includes("hcfc")) return "hcfc";
  if (t.includes("blend")) return "blend";
  return "hfc";
}

function _typeLabel(type) {
  if (!type) return "HFC";
  const t = type.toLowerCase();
  if (t.includes("natural")) return "Natural";
  if (t.includes("hfo"))  return "HFO";
  if (t.includes("hcfc")) return "HCFC";
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
    ["Designation",  info.ashrae_designation,  "highlight"],
    ["Chemical name",info.chemical_name,        ""],
    ["Formula",      info.formula,              ""],
    ["Type",         info.refrigerant_type,     ""],
    ["Safety class", info.safety_class,         safetyColor],
    ["GWP (AR5)",    info.GWP_AR5 === 0 ? "0 (natural)" : info.GWP_AR5.toString(), gwpColor],
    ["ODP",          info.ODP === 0 ? "0.00" : info.ODP.toString(), odpColor],
    ["Normal B.P.",  `${info.normal_boiling_point_C} °C`, ""],
    ["T_crit",       `${info.T_crit_C} °C`,    ""],
    ["P_crit",       `${info.P_crit_kPa} kPa`, ""],
    ["T glide",      info.T_glide_C === 0 ? "0 (azeotrope)" : `${info.T_glide_C} °C`, info.T_glide_C > 1 ? "warn" : ""],
    ["M.W.",         `${info.molecular_weight} g/mol`, ""],
    ["Regulatory",   info.regulatory_status,   "warn"],
  ];

  if (info.blend_components) rows.push(["Components",  info.blend_components.join(", "), ""]);
  if (info.replaces && info.replaces.length)     rows.push(["Replaces",    info.replaces.join(", "), ""]);
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
    const s1k2  = $("s1-known2");
    if (this.checked) {
      extra.classList.remove("hidden");
      s1k2.innerHTML = `<span class="derived-tag">T + P</span><span class="derived-note">superheated inlet</span>`;
    } else {
      extra.classList.add("hidden");
      s1k2.innerHTML = `<span class="derived-tag">x = 1</span><span class="derived-note">sat. vapor</span>`;
    }
  });

  $("sc-exit").addEventListener("change", function () {
    const extra = $("sc-exit-extra");
    const s3k2  = $("s3-known2");
    if (this.checked) {
      extra.classList.remove("hidden");
      s3k2.innerHTML = `<span class="derived-tag">T + P</span><span class="derived-note">subcooled exit</span>`;
    } else {
      extra.classList.add("hidden");
      s3k2.innerHTML = `<span class="derived-tag">x = 0</span><span class="derived-note">sat. liquid</span>`;
    }
  });
}

export function getInputs() {
  return {
    T1_C:     parseFloat($("T1").value),
    T3_C:     parseFloat($("T3").value),
    superheat: $("sh-inlet").checked,
    T1sh_C:   parseFloat($("T1").value),
    P1sh_kPa: parseFloat($("P1sh").value),
    subcool:  $("sc-exit").checked,
    T3sc_C:   parseFloat($("T3").value),
    P3sc_kPa: parseFloat($("P3sc").value),
  };
}

export function enableCalcButton(enabled) {
  $("calc-btn").disabled = !enabled;
}

export function onCalcClick(handler) {
  $("calc-btn").addEventListener("click", handler);
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

export function renderResults(states, metrics, warnings) {
  clearError();

  const wbox = $("warnings-box");
  if (warnings && warnings.length) {
    wbox.innerHTML = "<strong>Warnings:</strong><ul>" +
      warnings.map(w => `<li>${w}</li>`).join("") + "</ul>";
    wbox.classList.remove("hidden");
  } else {
    wbox.classList.add("hidden");
  }

  const tbody = $("results-tbody");
  tbody.innerHTML = "";
  states.forEach((s, i) => {
    const phaseClass = s.x === null
      ? (i === 0 || i === 1 ? "val-vapor" : "val-liquid")
      : "";
    const tr = document.createElement("tr");
    const badgeClass = i === 1 || i === 3 ? "state-badge-derived" : "";
    tr.innerHTML = `
      <td><span class="state-badge ${badgeClass}">${i + 1}</span></td>
      <td class="${phaseClass}">${fmt(s.T_C, 2)}</td>
      <td>${fmt(s.P_kPa, 2)}</td>
      <td>${fmt(s.h, 2)}</td>
      <td>${fmt(s.s, 4)}</td>
      <td>${fmtX(s.x)}</td>
      <td>${fmt(s.rho, 3)}</td>
    `;
    tbody.appendChild(tr);
  });

  $("cop-c").textContent         = fmt(metrics.COP_c, 3);
  $("cop-h").textContent         = fmt(metrics.COP_h, 3);
  $("q-evap").textContent        = fmt(metrics.Q_evap, 2);
  $("q-cond").textContent        = fmt(metrics.Q_cond, 2);
  $("w-comp").textContent        = fmt(metrics.W_comp, 2);
  $("energy-balance").textContent = fmt(metrics.energy_balance_residual, 4);

  $("results-section").classList.remove("hidden");
}
