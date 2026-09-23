/**
 * ui.js — DOM manipulation helpers for FrigProp.
 * No business logic here — pure rendering. All values cross this module's
 * boundary in SI; display conversion goes through units.js.
 */

import * as units from "./units.js?v=20260923a";

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
function _typeGroup(type) {
  const t = (type || "").toLowerCase();
  if (t.includes("natural")) return "natural";
  if (t.includes("hcfo"))    return "hcfo";
  if (t.includes("hfo"))     return t.includes("blend") ? "hfo-blend" : "hfo";
  if (t.includes("hcfc"))    return "hcfc";
  if (t.includes("hfc"))     return t.includes("blend") ? "hfc-blend" : "hfc";
  if (t.includes("cfc"))     return "cfc";
  return "hfc";
}

function _typeRank(type) {
  return TYPE_RANK.indexOf(_typeGroup(type));
}

// Gallery filter chips: filter key → card predicate (on card data attributes)
const GALLERY_FILTERS = {
  all:     () => true,
  natural: c => c.dataset.group === "natural",
  hfo:     c => ["hfo", "hfo-blend", "hcfo"].includes(c.dataset.group),
  hfc:     c => ["hfc", "hfc-blend"].includes(c.dataset.group),
  legacy:  c => ["hcfc", "cfc"].includes(c.dataset.group),
  lowgwp:  c => c.dataset.gwp !== "" && +c.dataset.gwp < 150,
  a1:      c => c.dataset.safety === "A1",
};

/** Show only the cards matching a filter chip; keeps a visible card tabbable. */
function _applyGalleryFilter(filter) {
  const cards = [...document.querySelectorAll("#ref-cards .ref-card")];
  cards.forEach(c => c.classList.toggle("hidden", !GALLERY_FILTERS[filter](c)));
  document.querySelectorAll("#gallery-filters .chart-tab").forEach(b => {
    const on = b.dataset.filter === filter;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const visible = cards.filter(c => !c.classList.contains("hidden"));
  $("gallery-count").textContent = filter === "all" ? "" : `${visible.length} / ${cards.length}`;
  cards.forEach(c => { c.tabIndex = -1; });
  const focusable = visible.find(c => c.classList.contains("selected")) || visible[0];
  if (focusable) focusable.tabIndex = 0;
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
    card.dataset.group = _typeGroup(typeRaw);
    card.dataset.gwp = gwp ?? "";
    card.dataset.safety = safety || "";
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
  document.querySelectorAll("#gallery-filters .chart-tab").forEach(b => {
    b.addEventListener("click", () => _applyGalleryFilter(b.dataset.filter));
  });
}

/** Roving-tabindex arrow-key navigation across the card grid. */
function _wireGalleryKeyboardNav(grid) {
  const first = grid.querySelector(".ref-card");
  if (first) first.tabIndex = 0;
  grid.addEventListener("keydown", e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const cards = [...grid.querySelectorAll(".ref-card:not(.hidden)")];  // filtered view
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

// ---------------------------------------------------------------------------
// Advanced Tools section
// ---------------------------------------------------------------------------

const ADV_OPEN_KEY = "frigprop.advancedOpen";

/** Restore the Advanced Tools open/closed state (closed unless remembered open). */
export function wireAdvancedSection() {
  const det = $("advanced-tools");
  try { det.open = localStorage.getItem(ADV_OPEN_KEY) === "1"; } catch (_) {}
  det.addEventListener("toggle", () => {
    try { localStorage.setItem(ADV_OPEN_KEY, det.open ? "1" : "0"); } catch (_) {}
  });
}

/** Open the Advanced Tools section (e.g. when a shared link uses one of its options). */
export function openAdvancedSection() {
  $("advanced-tools").open = true;
}

const KW_PER_TR = 3.516853;  // 1 ton of refrigeration = 12 000 Btu/h

/** Cooling capacity entered under Advanced Tools, in kW, or null when blank/invalid. */
export function getCapacityKW() {
  const v = parseFloat($("capacity").value);
  if (!(v > 0)) return null;
  return $("capacity-unit").value === "TR" ? v * KW_PER_TR : v;
}

/** Capacity unit picker value: "kW" or "TR". */
export function getCapacityUnit() {
  return $("capacity-unit").value;
}

/** Restore a capacity (kW) shown in the given unit ("kW" | "TR"); null clears it. */
export function setCapacity(kW, unit) {
  $("capacity-unit").value = unit === "TR" ? "TR" : "kW";
  if (!(kW > 0)) { $("capacity").value = ""; return; }
  const v = unit === "TR" ? kW / KW_PER_TR : kW;
  $("capacity").value = +v.toFixed(4);
}

export function onCapacityChange(handler) {
  $("capacity").addEventListener("input", handler);
  $("capacity-unit").addEventListener("change", handler);
}

// Advanced metric rows: [label (HTML), getter(adv) → SI value, unit-kind|null, decimals]
const ADV_ROWS = [
  ["Volumetric cooling capacity",       a => a.q_vol_kJ_m3,       "vcc",   0],
  ["Specific displacement",             a => a.disp_spec_m3_h_kW, "vspec", 3],
  ["Carnot temps T<sub>L</sub> / T<sub>H</sub>", null,           "T",     2],
  ["COP<sub>Carnot</sub> — Cooling",    a => a.COP_carnot_c,      null,    3],
  ["COP<sub>Carnot</sub> — Heating",    a => a.COP_carnot_h,      null,    3],
  ["Second-law efficiency — Cooling",   a => a.eta_II_c * 100,    "%",     1],
  ["Second-law efficiency — Heating",   a => a.eta_II_h * 100,    "%",     1],
];
const CAP_ROWS = [
  ["Refrigerant mass flow",             c => c.m_dot_kg_s,        "mdot",  4],
  ["Compressor power",                  c => c.W_kW,              "power", 2],
  ["Condenser heat rejection",          c => c.Q_cond_kW,         "power", 2],
  ["Compressor displacement",           c => c.V_disp_m3_h,       "vflow", 2],
];

// US-unit decimals where the magnitudes differ a lot from SI
const IP_DECIMALS = { power: 0, vcc: 1, vflow: 1, mdot: 2 };

/** One formatted advanced value (display units). */
function _advCell(v, kind, dec) {
  if (kind === "%") return `${fmt(v, dec)} <span class="unit">%</span>`;
  if (!kind) return fmt(v, dec);
  const d = units.getSystem() === "IP" && kind in IP_DECIMALS ? IP_DECIMALS[kind] : dec;
  return `${du(v, kind, d)} <span class="unit">${units.label(kind)}</span>`;
}

/**
 * Render the Advanced Tools cycle-metrics table for the last cycle
 * (a second column when a comparison ran); null clears it.
 * @param {object|null} primary     — bundle with .key and .adv (advancedMetrics)
 * @param {object|null} comparison
 */
export function renderAdvancedResults(primary, comparison) {
  const box = $("adv-results");
  if (!primary || !primary.adv) {
    box.innerHTML = '<p class="adv-note adv-empty">Calculate a cycle to see these metrics.</p>';
    return;
  }
  const cols = [primary, comparison].filter(b => b && b.adv);
  const row = ([label, get, kind, dec], pick) => `
      <tr><td style="text-align:left;color:var(--text-dim)">${label}</td>
      ${cols.map(b => {
        const src = pick(b.adv);
        if (!src) return "<td>—</td>";
        if (!get) return `<td>${du(src.T_L_C, "T", dec)} / ${du(src.T_H_C, "T", dec)} <span class="unit">${units.label("T")}</span></td>`;
        return `<td>${_advCell(get(src), kind, dec)}</td>`;
      }).join("")}</tr>`;
  // one capacity input drives every column
  const cap = primary.adv.capacity;
  const capRows = cap
    ? `<tr><td colspan="${cols.length + 1}" class="adv-subhead">At ${getCapacityUnit() === "TR"
        ? `${fmt(cap.Q_evap_kW / KW_PER_TR, 2)} TR (${_advCell(cap.Q_evap_kW, "power", 2)})`
        : _advCell(cap.Q_evap_kW, "power", 2)} cooling</td></tr>` +
      CAP_ROWS.map(r => row(r, a => a.capacity)).join("")
    : "";
  box.innerHTML = `
    <table class="results-table" aria-label="Advanced cycle metrics">
      <thead><tr><th style="text-align:left">Metric</th>${cols.map(b => `<th>${b.key}</th>`).join("")}</tr></thead>
      <tbody>${ADV_ROWS.map(r => row(r, a => a)).join("")}${capRows}</tbody>
    </table>`;
}

// --- Tool inputs (display units in, SI out) --------------------------------

/** Show (or clear, with null) an Advanced Tools error box. */
export function showToolError(id, msg) {
  $(id).textContent = msg || "";
  $(id).classList.toggle("hidden", !msg);
}

/** Sweep form: { variable: "T1"|"T3", from_C, to_C, n }. */
export function getSweepInputs() {
  return {
    variable: $("sweep-var").value,
    from_C: units.fromInput(parseFloat($("sweep-from").value), "T"),
    to_C:   units.fromInput(parseFloat($("sweep-to").value), "T"),
    n:      parseInt($("sweep-n").value, 10),
  };
}

/** Prefill the sweep range (SI °C, shown rounded in display units). */
export function setSweepRange(from_C, to_C) {
  $("sweep-from").value = Math.round(units.toDisplay(from_C, "T"));
  $("sweep-to").value   = Math.round(units.toDisplay(to_C, "T"));
}

/** Superheat-table form: { pressures_kPa[], from_C, to_C, step_K, prop }; bad pressure entries → NaN. */
export function getSuperheatInputs() {
  return {
    pressures_kPa: $("sht-p").value.split(/[,\s;]+/).filter(Boolean)
      .map(v => units.fromInput(parseFloat(v), "P")),
    from_C: units.fromInput(parseFloat($("sht-from").value), "T"),
    to_C:   units.fromInput(parseFloat($("sht-to").value), "T"),
    step_K: units.fromInput(parseFloat($("sht-step").value), "dT"),
    prop:   $("sht-prop").value,
  };
}

/** Prefill the superheat-table form; values are already round display values. */
export function setSuperheatDefaults(pressuresDisp, fromDisp, toDisp, stepDisp) {
  $("sht-p").value = pressuresDisp.join(", ");
  $("sht-from").value = fromDisp;
  $("sht-to").value = toDisp;
  $("sht-step").value = stepDisp;
}

// --- Sensitivity sweep --------------------------------------------------------

// Series colors (validated for the dark surface: OKLCH L band, CVD ΔE 14.5);
// the comparison series is also dashed and direct-labeled.
const SERIES = [
  { color: "var(--series-1)", dash: "" },
  { color: "var(--series-2)", dash: "5 3" },
];

/** Round tick values spanning [lo, hi] (about n of them). */
function _niceTicks(lo, hi, n = 4) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw);
  const ticks = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(+v.toPrecision(10));
  if (ticks[ticks.length - 1] < hi) ticks.push(+(ticks[ticks.length - 1] + step).toPrecision(10));
  return ticks;
}

/**
 * Small single-axis SVG line chart with a hover crosshair + tooltip listing
 * every series at the nearest x. Values are display-unit numbers; gaps
 * (null y) break the line.
 */
function _lineChart(box, { title, xText, yText, xs, series, yDec }) {
  const W = 320, H = 180, m = { l: 44, r: 14, t: 22, b: 30 };
  const ys = series.flatMap(sr => sr.ys).filter(v => v !== null);
  const yt = _niceTicks(Math.min(...ys), Math.max(...ys));
  const xt = _niceTicks(Math.min(...xs), Math.max(...xs));
  const [x0, x1, y0, y1] = [xt[0], xt[xt.length - 1], yt[0], yt[yt.length - 1]];
  const X = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const grid = yt.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="viz-grid"/>
    <text x="${m.l - 5}" y="${Y(v) + 3}" text-anchor="end" class="viz-tick">${+v.toFixed(yDec)}</text>`).join("") +
    xt.map(v => `<text x="${X(v)}" y="${H - m.b + 13}" text-anchor="middle" class="viz-tick">${+v.toFixed(1)}</text>`).join("");
  // last defined point per series; with two series the upper one is labeled
  // above its end, the lower one below, so direct labels never collide
  const lastIdx = series.map(sr => sr.ys.map((v, j) => v === null ? -1 : j).filter(j => j >= 0).pop());
  const endY = series.map((sr, i) => lastIdx[i] === undefined ? 0 : sr.ys[lastIdx[i]]);
  const lines = series.map((sr, i) => {
    let d = "", pen = false;
    sr.ys.forEach((v, j) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${X(xs[j]).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    const dots = sr.ys.map((v, j) => v === null ? "" :
      `<circle cx="${X(xs[j])}" cy="${Y(v)}" r="3.5" class="viz-dot" style="fill:${SERIES[i].color}"/>`).join("");
    // direct label at the last defined point (text in ink, not series color)
    const lastJ = lastIdx[i];
    const upper = endY[i] >= Math.max(...endY.filter((_, k) => k !== i));
    const lbl = series.length > 1 && lastJ !== undefined
      ? `<text x="${X(xs[lastJ]) - 4}" y="${Y(sr.ys[lastJ]) + (upper ? -8 : 14)}" text-anchor="end" class="viz-lbl"></text>` : "";
    return `<path d="${d}" class="viz-line" style="stroke:${SERIES[i].color}" stroke-dasharray="${SERIES[i].dash}"/>${dots}${lbl}`;
  }).join("");
  box.innerHTML = `
    <div class="viz-title"></div>
    <svg viewBox="0 0 ${W} ${H}" role="img">
      ${grid}
      <text x="${(m.l + W - m.r) / 2}" y="${H - 3}" text-anchor="middle" class="viz-axis"></text>
      <line class="viz-cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
      ${lines}
      <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" class="viz-hit"/>
    </svg>
    <div class="viz-tip hidden"></div>`;
  // text via textContent — labels never pass through innerHTML
  box.querySelector(".viz-title").textContent = yText ? `${title} (${yText})` : title;
  box.querySelector(".viz-axis").textContent = xText;
  box.querySelector("svg").setAttribute("aria-label", `${title} versus ${xText}`);
  box.querySelectorAll(".viz-lbl").forEach((t, i) => { t.textContent = series[i].name; });

  const svg = box.querySelector("svg"), cross = box.querySelector(".viz-cross"), tip = box.querySelector(".viz-tip");
  box.querySelector(".viz-hit").addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect();
    const vx = (e.clientX - r.left) / r.width * W;
    let j = 0;
    xs.forEach((x, k) => { if (Math.abs(X(x) - vx) < Math.abs(X(xs[j]) - vx)) j = k; });
    cross.setAttribute("x1", X(xs[j])); cross.setAttribute("x2", X(xs[j]));
    cross.setAttribute("visibility", "visible");
    tip.textContent = "";
    const head = document.createElement("div");
    head.textContent = `${xText} = ${+xs[j].toFixed(2)}`;
    tip.appendChild(head);
    series.forEach(sr => {
      const row = document.createElement("div");
      row.textContent = `${sr.name}: ${sr.ys[j] === null ? "—" : sr.ys[j].toFixed(yDec)}`;
      tip.appendChild(row);
    });
    tip.classList.remove("hidden");
    const left = X(xs[j]) / W * r.width;
    tip.style.left = `${Math.min(left + 10, r.width - tip.offsetWidth - 4)}px`;
  });
  box.querySelector(".viz-hit").addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    tip.classList.add("hidden");
  });
}

/**
 * Render a sensitivity sweep: COP and discharge-T charts plus a table view.
 * @param {{variable: "T1"|"T3", series: {key: string, pts: object[]}[]}|null} sweep
 */
export function renderSweep(sweep) {
  const out = $("sweep-out");
  $("sweep-csv-btn").classList.toggle("hidden", !sweep);
  if (!sweep) { out.innerHTML = ""; return; }
  const LT = units.label("T");
  const xText = `${sweep.variable === "T1" ? "T evap" : "T cond"} (${LT})`;
  const xs = sweep.series[0].pts.map(p => units.toDisplay(p.value, "T"));
  const pick = f => sweep.series.map(sr => ({ name: sr.key, ys: sr.pts.map(p => p.metrics ? f(p.metrics) : null) }));
  const skipped = sweep.series.reduce((n, sr) => n + sr.pts.filter(p => p.error).length, 0);
  out.innerHTML = `
    ${sweep.series.length > 1 ? `<div class="chart-legend">${sweep.series.map((sr, i) =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${SERIES[i].color}"></span><span class="lg"></span></span>`).join("")}</div>` : ""}
    <div class="sweep-charts"><div class="viz-box"></div><div class="viz-box"></div></div>
    ${skipped ? `<p class="adv-note">${skipped} point(s) outside the table range or cycle limits are left blank.</p>` : ""}
    <div class="table-wrap"><table class="results-table" aria-label="Sweep results">
      <thead><tr><th>${xText}</th>${sweep.series.map(sr => `<th class="k">COP<sub>c</sub></th><th class="k">T<sub>2</sub> (${LT})</th>`).join("")}</tr></thead>
      <tbody>${xs.map((x, j) => `<tr><td>${fmt(x, 1)}</td>${sweep.series.map(sr => {
        const p = sr.pts[j];
        return p.metrics ? `<td>${fmt(p.metrics.COP_c, 3)}</td><td>${du(p.metrics.T_discharge_C, "T", 1)}</td>`
                         : `<td class="viz-na">—</td><td class="viz-na">—</td>`;
      }).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  out.querySelectorAll(".lg").forEach((el, i) => { el.textContent = sweep.series[i].key; });
  // two fluids: prefix column headers with the fluid key
  if (sweep.series.length > 1) {
    out.querySelectorAll("th.k").forEach((th, i) => { th.prepend(`${sweep.series[i >> 1].key} `); });
  }
  const boxes = out.querySelectorAll(".viz-box");
  _lineChart(boxes[0], { title: "COP cooling", yText: "", xText, xs, series: pick(m => m.COP_c), yDec: 2 });
  _lineChart(boxes[1], { title: "Discharge T₂", yText: LT, xText, xs,
                         series: pick(m => units.toDisplay(m.T_discharge_C, "T")), yDec: 1 });
}

/** Sweep as CSV (display units). */
export function buildSweepCSV(sweep) {
  const L = k => units.label(k);
  const head = [`${sweep.variable === "T1" ? "T_evap" : "T_cond"} (${L("T")})`];
  sweep.series.forEach(sr => head.push(`${sr.key} COP_c`, `${sr.key} COP_h`, `${sr.key} W_comp (${L("h")})`,
                                       `${sr.key} Q_evap (${L("h")})`, `${sr.key} T2 (${L("T")})`, `${sr.key} P_ratio`));
  const lines = [head.join(",")];
  sweep.series[0].pts.forEach((p0, j) => {
    const row = [du(p0.value, "T", 2)];
    sweep.series.forEach(sr => {
      const m = sr.pts[j].metrics;
      row.push(...(m ? [fmt(m.COP_c, 4), fmt(m.COP_h, 4), du(m.W_comp, "h", 3), du(m.Q_evap, "h", 3),
                        du(m.T_discharge_C, "T", 2), fmt(m.P_ratio, 3)] : ["", "", "", "", "", ""]));
    });
    lines.push(row.join(","));
  });
  return lines.join("\n") + "\n";
}

// --- Superheated vapor table --------------------------------------------------

const SHT_PROPS = { h: ["h", "h", 2], s: ["s", "s", 4], rho: ["ρ", "rho", 3], u: ["u", "u", 2], cp: ["cp", "cp", 4] };

/**
 * Render the superheated vapor grid for one property (rows T, columns P).
 * @param {{designation: string, tbl: object}|null} sht — superheatTable() result
 * @param {string} prop — "h" | "s" | "rho" | "u" | "cp"
 */
export function renderSuperheatTable(sht, prop) {
  const out = $("sht-out");
  $("sht-csv-btn").classList.toggle("hidden", !sht);
  if (!sht) { out.innerHTML = ""; return; }
  const [sym, kind, dec] = SHT_PROPS[prop];
  const { columns, rows } = sht.tbl;
  out.innerHTML = `
    <table class="results-table sht-table" aria-label="Superheated vapor ${sym}">
      <caption class="adv-note"></caption>
      <thead><tr><th>T (${units.label("T")})</th>${columns.map(c =>
        `<th>${du(c.P_kPa, "P", 1)} ${units.label("P")}<br><span class="th-unit">T<sub>dew</sub> ${c.T_dew_C === null ? "—" : du(c.T_dew_C, "T", 1)}</span></th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr><td>${du(r.T_C, "T", 1)}</td>${r.cells.map(st =>
        st && st[kind] !== null && st[kind] !== undefined ? `<td>${du(st[kind], kind, dec)}</td>` : `<td class="viz-na">·</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  out.querySelector("caption").textContent = `${sht.designation} — superheated vapor ${sym} (${units.label(kind)})`;
}

/** Superheated vapor table as long-form CSV, all properties (display units). */
export function buildSuperheatCSV(sht) {
  const L = k => units.label(k);
  const lines = [`Fluid,${sht.designation}`,
    `P (${L("P")}),T_dew (${L("T")}),T (${L("T")}),h (${L("h")}),s (${L("s")}),rho (${L("rho")}),u (${L("u")}),cp (${L("cp")})`];
  sht.tbl.columns.forEach((c, i) => {
    sht.tbl.rows.forEach(r => {
      const st = r.cells[i];
      if (!st) return;
      lines.push([du(c.P_kPa, "P", 3), du(c.T_dew_C, "T", 2), du(r.T_C, "T", 2), du(st.h, "h", 3),
                  du(st.s, "s", 5), du(st.rho, "rho", 4), st.u === null ? "" : du(st.u, "u", 3),
                  st.cp === null || st.cp === undefined ? "" : du(st.cp, "cp", 4)].join(","));
    });
  });
  return lines.join("\n") + "\n";
}

// --- Recent cycles -------------------------------------------------------------

/** One-line summary of a stored cycle entry in display units. */
function _historyLabel(e) {
  const i = e.inputs, LT = units.label("T");
  const parts = [`${e.designation}${e.compare ? ` vs ${e.compare}` : ""}`,
                 `${du(i.T1_C, "T", 1)} / ${du(i.T3_C, "T", 1)} ${LT}`];
  if (i.superheat) parts.push(i.sh_by === "P" ? `SH @ ${du(i.P_evap_kPa, "P", 0)} ${units.label("P")}` : `SH ${du(i.dT_sh_K, "dT", 1)} ${units.label("dT")}`);
  if (i.subcool) parts.push(i.sc_by === "P" ? `SC @ ${du(i.P_cond_kPa, "P", 0)} ${units.label("P")}` : `SC ${du(i.dT_sc_K, "dT", 1)} ${units.label("dT")}`);
  if (i.eta_isen < 1) parts.push(`η ${Math.round(i.eta_isen * 100)} %`);
  return parts.join(" · ");
}

/**
 * Render pinned + recent cycles; buttons carry data-act (recall|pin|unpin),
 * data-list (pinned|recent) and data-i for onHistoryAction.
 */
export function renderHistory(pinned, recent) {
  const out = $("history-out");
  if (!pinned.length && !recent.length) {
    out.innerHTML = '<p class="adv-note adv-empty">No cycles yet.</p>';
    return;
  }
  const row = (e, list, i) => `
    <div class="hist-row">
      <button class="chart-btn hist-pin" data-act="${list === "pinned" ? "unpin" : "pin"}" data-list="${list}" data-i="${i}"
        title="${list === "pinned" ? "Unpin" : "Pin (keeps it across reloads)"}" aria-label="${list === "pinned" ? "Unpin" : "Pin"}">${list === "pinned" ? "★" : "☆"}</button>
      <span class="hist-label"></span>
      <span class="hist-cop">COP ${fmt(e.cop, 3)}</span>
      <button class="chart-btn" data-act="recall" data-list="${list}" data-i="${i}">Recall</button>
    </div>`;
  out.innerHTML = pinned.map((e, i) => row(e, "pinned", i)).join("") + recent.map((e, i) => row(e, "recent", i)).join("");
  const labels = out.querySelectorAll(".hist-label");
  [...pinned, ...recent].forEach((e, k) => { labels[k].textContent = _historyLabel(e); });
}

/** Wire the history buttons: handler(act, list, index). */
export function onHistoryAction(handler) {
  $("history-out").addEventListener("click", e => {
    const b = e.target.closest("button[data-act]");
    if (b) handler(b.dataset.act, b.dataset.list, parseInt(b.dataset.i, 10));
  });
}

/**
 * Flag the results, diagram and Advanced Tools headers with the advanced
 * options currently affecting the cycle; an empty list hides the flags.
 * @param {string[]} labels  e.g. ["vs R-134a"]
 */
export function setAdvancedMarkers(labels) {
  const text = labels.length ? `Advanced: ${labels.join(" · ")}` : "";
  document.querySelectorAll("[data-adv-marker]").forEach(el => {
    el.textContent = text;
    el.classList.toggle("hidden", !text);
  });
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

/** Fill the lookup pane from SI values (diagram picks); shows the pair's fields. */
export function setLookupInputs(pair, v1, v2) {
  $("lookup-pair").value = pair;
  refreshLookupFields();
  const def = PAIR_DEFS[pair];
  $("lookup-v1").value = +units.toDisplay(v1, def.fields[0][1]).toPrecision(6);
  if (def.fields.length > 1) $("lookup-v2").value = +units.toDisplay(v2, def.fields[1][1]).toPrecision(6);
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

// glide below this is reported as none (pure fluids, azeotropes)
const GLIDE_MIN_K = 0.05;

/** True when either coil of a cycle shows temperature glide. */
function _hasGlide(coils) {
  return !!coils && Math.max(Math.abs(coils.evap.glide_K), Math.abs(coils.cond.glide_K)) > GLIDE_MIN_K;
}

/** "a → b °C" and "g K · mean m °C" strings for one coil, in display units. */
function _coilText(from_C, to_C, glide_K, mean_C) {
  const L = units.label("T");
  return {
    span:  `${du(from_C, "T", 2)} → ${du(to_C, "T", 2)} <span class="unit">${L}</span>`,
    glide: `${du(glide_K, "dT", 2)} <span class="unit">${units.label("dT")}</span> · ` +
           `${du(mean_C, "T", 2)} <span class="unit">${L}</span>`,
  };
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
    const glide = _hasGlide(primary.coils);
    $("coil-glide").classList.toggle("hidden", !glide);
    if (glide) {
      const { evap: e, cond: c } = primary.coils;
      const ev = _coilText(e.T_in_C, e.T_dew_C, e.glide_K, e.T_mean_C);
      const cd = _coilText(c.T_dew_C, c.T_bub_C, c.glide_K, c.T_mean_C);
      $("coil-evap").innerHTML = ev.span;
      $("coil-evap-glide").innerHTML = ev.glide;
      $("coil-cond").innerHTML = cd.span;
      $("coil-cond-glide").innerHTML = cd.glide;
    }
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
  // coil glide rows when either fluid is zeotropic
  const coilRow = (label, pick) => `
          <tr><td style="text-align:left;color:var(--text-dim)">${label}</td>
          ${[primary.coils, comparison.coils].map(k => `<td>${_hasGlide(k) ? pick(k)
            : '<span class="unit">no glide</span>'}</td>`).join("")}</tr>`;
  const glideRows = _hasGlide(primary.coils) || _hasGlide(comparison.coils)
    ? coilRow("Evap. inlet → dew", k => _coilText(k.evap.T_in_C, k.evap.T_dew_C, k.evap.glide_K, k.evap.T_mean_C).span) +
      coilRow("Evap. glide · mean", k => _coilText(k.evap.T_in_C, k.evap.T_dew_C, k.evap.glide_K, k.evap.T_mean_C).glide) +
      coilRow("Cond. dew → bubble", k => _coilText(k.cond.T_dew_C, k.cond.T_bub_C, k.cond.glide_K, k.cond.T_mean_C).span) +
      coilRow("Cond. glide · mean", k => _coilText(k.cond.T_dew_C, k.cond.T_bub_C, k.cond.glide_K, k.cond.T_mean_C).glide)
    : "";
  box.innerHTML = `
    <table class="results-table" aria-label="Performance comparison">
      <thead><tr><th style="text-align:left">Metric</th><th>${primary.key}</th><th>${comparison.key}</th></tr></thead>
      <tbody>
        ${METRIC_ROWS.map(r => `
          <tr><td style="text-align:left;color:var(--text-dim)">${r[0]}</td>
          ${cell(primary.metrics, r)}${cell(comparison.metrics, r)}</tr>`).join("")}${glideRows}
      </tbody>
    </table>`;
}

/**
 * Saturation table as CSV in the current display units. Zeotropes get
 * separate bubble/dew pressures (h_f/s_f/ρ_f are bubble-side, h_g/s_g/ρ_g
 * dew-side at each T); pure fluids and azeotropes a single P_sat.
 * @param {string}  designation — e.g. "R-449A"
 * @param {string}  reference   — h/s reference-state note
 * @param {Array[]} rows        — sat.json rows (getSatRows)
 */
export function buildSatCSV(designation, reference, rows) {
  const L = k => units.label(k);
  const quote = v => /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  // sat-table column order: T, P_sat, hf, hg, sf, sg, rhof, rhog, uf, ug, P_bub, P_dew
  const glide = rows.some(r => Math.abs(r[10] - r[11]) > 1e-3 * r[10]);
  const Tdec = units.getSystem() === "IP" ? 2 : 1;
  const lines = [
    `Fluid,${quote(designation)}`,
    `h/s reference,${quote(reference || "")}`,
    [`T (${L("T")})`, ...(glide ? [`P_bubble (${L("P")})`, `P_dew (${L("P")})`] : [`P_sat (${L("P")})`]),
     `h_f (${L("h")})`, `h_g (${L("h")})`, `s_f (${L("s")})`, `s_g (${L("s")})`,
     `rho_f (${L("rho")})`, `rho_g (${L("rho")})`].join(","),
  ];
  for (const r of rows) {
    lines.push([
      du(r[0], "T", Tdec),
      ...(glide ? [du(r[10], "P", 3), du(r[11], "P", 3)] : [du(r[1], "P", 3)]),
      du(r[2], "h", 3), du(r[3], "h", 3), du(r[4], "s", 5), du(r[5], "s", 5),
      du(r[6], "rho", 4), du(r[7], "rho", 5),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}

/** Build a CSV export (current display units) of states + performance. */
export function buildResultsCSV(primary, comparison) {
  const L = k => units.label(k);
  const lines = [];
  const block = ({ key, states, metrics, coils, adv }) => {
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
    if (_hasGlide(coils)) {
      const { evap: e, cond: c } = coils;
      lines.push(`Evaporator inlet T4 (${L("T")}),${du(e.T_in_C, "T", 2)}`);
      lines.push(`Evaporator dew T (${L("T")}),${du(e.T_dew_C, "T", 2)}`);
      lines.push(`Evaporating glide (${L("dT")}),${du(e.glide_K, "dT", 2)}`);
      lines.push(`Condenser dew T (${L("T")}),${du(c.T_dew_C, "T", 2)}`);
      lines.push(`Condenser bubble T (${L("T")}),${du(c.T_bub_C, "T", 2)}`);
      lines.push(`Condensing glide (${L("dT")}),${du(c.glide_K, "dT", 2)}`);
    }
    if (adv) {
      lines.push(`Volumetric cooling capacity (${L("vcc")}),${du(adv.q_vol_kJ_m3, "vcc", 2)}`);
      lines.push(`Specific displacement (${L("vspec")}),${du(adv.disp_spec_m3_h_kW, "vspec", 4)}`);
      lines.push(`Carnot T_L (${L("T")}),${du(adv.T_L_C, "T", 2)}`);
      lines.push(`Carnot T_H (${L("T")}),${du(adv.T_H_C, "T", 2)}`);
      lines.push(`COP_Carnot_c,${fmt(adv.COP_carnot_c, 3)}`);
      lines.push(`COP_Carnot_h,${fmt(adv.COP_carnot_h, 3)}`);
      lines.push(`Second-law efficiency cooling (%),${fmt(adv.eta_II_c * 100, 1)}`);
      lines.push(`Second-law efficiency heating (%),${fmt(adv.eta_II_h * 100, 1)}`);
      const cap = adv.capacity;
      if (cap) {
        lines.push(`Cooling capacity (${L("power")}),${du(cap.Q_evap_kW, "power", 2)}`);
        lines.push(`Refrigerant mass flow (${L("mdot")}),${du(cap.m_dot_kg_s, "mdot", 4)}`);
        lines.push(`Compressor power (${L("power")}),${du(cap.W_kW, "power", 2)}`);
        lines.push(`Condenser heat rejection (${L("power")}),${du(cap.Q_cond_kW, "power", 2)}`);
        lines.push(`Compressor displacement (${L("vflow")}),${du(cap.V_disp_m3_h, "vflow", 2)}`);
      }
    }
  };
  block(primary);
  if (comparison) { lines.push(""); block(comparison); }
  return lines.join("\n") + "\n";
}
