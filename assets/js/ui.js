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
// Refrigerant selector
// ---------------------------------------------------------------------------

export function populateRefrigerantSelector(keys) {
  const sel = $("refrigerant-select");
  sel.innerHTML = '<option value="">— select refrigerant —</option>';
  keys.forEach(k => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    sel.appendChild(opt);
  });
  sel.disabled = false;
}

export function onRefrigerantChange(handler) {
  $("refrigerant-select").addEventListener("change", e => handler(e.target.value));
}

// ---------------------------------------------------------------------------
// Info panel
// ---------------------------------------------------------------------------

export function renderInfoPanel(key, info, meta) {
  const panel = $("info-content");
  panel.innerHTML = "";

  const gwpColor = info.GWP_AR5 <= 10 ? "good" : info.GWP_AR5 <= 150 ? "" : info.GWP_AR5 <= 1000 ? "warn" : "danger";
  const odpColor = info.ODP > 0 ? "danger" : "good";
  const safetyColor = info.safety_class.includes("B") ? "warn" : "";

  const rows = [
    ["Designation", info.ashrae_designation, "highlight"],
    ["Chemical name", info.chemical_name, ""],
    ["Formula", info.formula, ""],
    ["Type", info.refrigerant_type, ""],
    ["Safety class", info.safety_class, safetyColor],
    ["GWP (AR5)", info.GWP_AR5 === 0 ? "0 (natural)" : info.GWP_AR5.toString(), gwpColor],
    ["ODP", info.ODP === 0 ? "0.00" : info.ODP.toString(), odpColor],
    ["Normal B.P.", `${info.normal_boiling_point_C} °C`, ""],
    ["T_crit", `${info.T_crit_C} °C`, ""],
    ["P_crit", `${info.P_crit_kPa} kPa`, ""],
    ["T glide", info.T_glide_C === 0 ? "0 (azeotrope)" : `${info.T_glide_C} °C`, info.T_glide_C > 1 ? "warn" : ""],
    ["M.W.", `${info.molecular_weight} g/mol`, ""],
    ["Regulatory", info.regulatory_status, "warn"],
  ];

  if (info.blend_components) {
    rows.push(["Components", info.blend_components.join(", "), ""]);
  }
  if (info.replaces && info.replaces.length) {
    rows.push(["Replaces", info.replaces.join(", "), ""]);
  }
  if (info.replaced_by && info.replaced_by.length) {
    rows.push(["Replaced by", info.replaced_by.join(", "), "dim"]);
  }
  if (info.typical_applications) {
    rows.push(["Applications", info.typical_applications.join(", "), ""]);
  }

  const tbl = document.createElement("table");
  tbl.className = "info-table";
  rows.forEach(([k, v, cls]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="info-key">${k}</td><td class="info-val ${cls || ""}">${v}</td>`;
    tbl.appendChild(tr);
  });
  panel.appendChild(tbl);

  // Critical point note from manifest
  if (meta) {
    const note = document.createElement("div");
    note.className = "info-section-header";
    note.style.marginTop = "8px";
    note.textContent = `Table range: ${meta.T_min_C}°C – ${meta.T_max_C}°C, P_max ${meta.P_max_kPa} kPa`;
    panel.appendChild(note);
  }
}

// ---------------------------------------------------------------------------
// Input controls
// ---------------------------------------------------------------------------

export function wireInputControls() {
  // Superheated inlet toggle
  $("sh-inlet").addEventListener("change", function () {
    const extra = $("sh-inlet-extra");
    const s1k2 = $("s1-known2");
    if (this.checked) {
      extra.classList.remove("hidden");
      s1k2.textContent = "P (kPa) — entered above";
    } else {
      extra.classList.add("hidden");
      s1k2.textContent = "x = 1 (sat. vapor)";
    }
  });

  // Subcooled exit toggle
  $("sc-exit").addEventListener("change", function () {
    const extra = $("sc-exit-extra");
    const s3k2 = $("s3-known2");
    if (this.checked) {
      extra.classList.remove("hidden");
      s3k2.textContent = "P (kPa) — entered above";
    } else {
      extra.classList.add("hidden");
      s3k2.textContent = "x = 0 (sat. liquid)";
    }
  });
}

export function getInputs() {
  return {
    T1_C: parseFloat($("T1").value),
    T3_C: parseFloat($("T3").value),
    superheat: $("sh-inlet").checked,
    T1sh_C: parseFloat($("T1").value),      // same T field; P is separate
    P1sh_kPa: parseFloat($("P1sh").value),
    subcool: $("sc-exit").checked,
    T3sc_C: parseFloat($("T3").value),
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
// Results rendering
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

  // Warnings
  const wbox = $("warnings-box");
  if (warnings && warnings.length) {
    wbox.innerHTML = "<strong>Warnings:</strong><ul>" +
      warnings.map(w => `<li>${w}</li>`).join("") + "</ul>";
    wbox.classList.remove("hidden");
  } else {
    wbox.classList.add("hidden");
  }

  // State table
  const tbody = $("results-tbody");
  tbody.innerHTML = "";
  states.forEach((s, i) => {
    const phaseClass = s.x === null
      ? (i === 0 || i === 1 ? "val-vapor" : "val-liquid")
      : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="${phaseClass}">${fmt(s.T_C, 2)}</td>
      <td>${fmt(s.P_kPa, 2)}</td>
      <td>${fmt(s.h, 2)}</td>
      <td>${fmt(s.s, 4)}</td>
      <td>${fmtX(s.x)}</td>
      <td>${fmt(s.rho, 3)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Metrics
  $("cop-c").textContent = fmt(metrics.COP_c, 3);
  $("cop-h").textContent = fmt(metrics.COP_h, 3);
  $("q-evap").textContent = fmt(metrics.Q_evap, 2);
  $("q-cond").textContent = fmt(metrics.Q_cond, 2);
  $("w-comp").textContent = fmt(metrics.W_comp, 2);
  $("energy-balance").textContent = fmt(metrics.energy_balance_residual, 4);

  $("results-section").classList.remove("hidden");
}
