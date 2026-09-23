/**
 * units.js — SI ⇄ US-customary (IP) display conversion.
 * The backend, cycle math, and tables are always SI; conversion happens only
 * at the display/input boundary. No DOM access.
 */

const STORAGE_KEY = "frigprop-units";

// kind → { si label, ip label, toIp(v), fromIp(v) }
const KINDS = {
  T:   { si: "°C",      ip: "°F",        toIp: v => v * 9 / 5 + 32, fromIp: v => (v - 32) * 5 / 9 },
  dT:  { si: "K",       ip: "°R",        toIp: v => v * 1.8,        fromIp: v => v / 1.8 },
  P:   { si: "kPa",     ip: "psia",      toIp: v => v / 6.894757,   fromIp: v => v * 6.894757 },
  h:   { si: "kJ/kg",   ip: "Btu/lb",    toIp: v => v / 2.326,      fromIp: v => v * 2.326 },
  u:   { si: "kJ/kg",   ip: "Btu/lb",    toIp: v => v / 2.326,      fromIp: v => v * 2.326 },
  s:   { si: "kJ/kg·K", ip: "Btu/lb·°R", toIp: v => v / 4.1868,     fromIp: v => v * 4.1868 },
  cp:  { si: "kJ/kg·K", ip: "Btu/lb·°R", toIp: v => v / 4.1868,     fromIp: v => v * 4.1868 },
  rho: { si: "kg/m³",   ip: "lb/ft³",    toIp: v => v / 16.018463,  fromIp: v => v * 16.018463 },
  v:   { si: "m³/kg",   ip: "ft³/lb",    toIp: v => v * 16.018463,  fromIp: v => v / 16.018463 },
  x:   { si: "0–1",     ip: "0–1",       toIp: v => v,              fromIp: v => v },
  // system-scale quantities (Advanced Tools)
  power: { si: "kW",         ip: "Btu/h",    toIp: v => v * 3412.142,  fromIp: v => v / 3412.142 },
  mdot:  { si: "kg/s",       ip: "lb/min",   toIp: v => v * 132.2774,  fromIp: v => v / 132.2774 },
  vflow: { si: "m³/h",       ip: "CFM",      toIp: v => v * 0.5885778, fromIp: v => v / 0.5885778 },
  vcc:   { si: "kJ/m³",      ip: "Btu/ft³",  toIp: v => v / 37.25895,  fromIp: v => v * 37.25895 },
  // swept volume per unit capacity: m³/h per kW ⇄ CFM per ton (1 TR = 3.516853 kW)
  vspec: { si: "m³/h per kW", ip: "CFM/ton", toIp: v => v * 2.069942,  fromIp: v => v / 2.069942 },
};

let _system = "SI";
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "IP" || saved === "SI") _system = saved;
} catch (_) { /* storage unavailable (private mode, file://) */ }

/** Current system: "SI" or "IP". */
export function getSystem() {
  return _system;
}

export function setSystem(sys) {
  _system = sys === "IP" ? "IP" : "SI";
  try { localStorage.setItem(STORAGE_KEY, _system); } catch (_) {}
}

/** Convert an SI value to the current display system. */
export function toDisplay(value, kind) {
  if (value === null || value === undefined || Number.isNaN(value)) return value;
  return _system === "IP" ? KINDS[kind].toIp(value) : value;
}

/** Convert a user-entered value in the current system to SI. */
export function fromInput(value, kind) {
  if (value === null || value === undefined || Number.isNaN(value)) return value;
  return _system === "IP" ? KINDS[kind].fromIp(value) : value;
}

/** Unit label for a kind in the current system. */
export function label(kind) {
  const k = KINDS[kind];
  return _system === "IP" ? k.ip : k.si;
}
