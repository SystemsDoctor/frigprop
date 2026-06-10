/**
 * units.mjs — conversion checks for assets/js/units.js against known pairs.
 * Run: node tests/units.mjs (exits non-zero on failure).
 */

// units.js touches localStorage at import; shim it for Node
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const units = await import("../assets/js/units.js");

let pass = 0;
const failures = [];

function chk(label, got, want, tol = 1e-4) {
  if (Math.abs(got - want) > tol) failures.push(`${label}: ${got} vs ${want}`);
  else pass++;
}

// SI mode: identity
units.setSystem("SI");
chk("SI identity T", units.toDisplay(25, "T"), 25);
chk("SI label", units.label("P") === "kPa" ? 1 : 0, 1);

// IP conversions against known pairs
units.setSystem("IP");
chk("0 °C = 32 °F",          units.toDisplay(0, "T"), 32);
chk("100 °C = 212 °F",       units.toDisplay(100, "T"), 212);
chk("-40 °C = -40 °F",       units.toDisplay(-40, "T"), -40);
chk("10 K = 18 °R",          units.toDisplay(10, "dT"), 18);
chk("689.4757 kPa = 100 psia", units.toDisplay(689.4757, "P"), 100);
chk("101.325 kPa = 14.6959 psia", units.toDisplay(101.325, "P"), 14.6959, 1e-3);
chk("2.326 kJ/kg = 1 Btu/lb", units.toDisplay(2.326, "h"), 1);
chk("4.1868 kJ/kgK = 1 Btu/lb°R", units.toDisplay(4.1868, "s"), 1);
chk("16.0185 kg/m³ = 1 lb/ft³", units.toDisplay(16.018463, "rho"), 1);
chk("1 m³/kg = 16.0185 ft³/lb", units.toDisplay(1, "v"), 16.018463);
chk("quality passthrough",    units.toDisplay(0.42, "x"), 0.42);

// round trips
for (const kind of ["T", "dT", "P", "h", "u", "s", "cp", "rho", "v"]) {
  chk(`roundtrip ${kind}`, units.fromInput(units.toDisplay(123.456, kind), kind), 123.456, 1e-9);
}

// null/NaN passthrough must not throw
chk("null passthrough", units.toDisplay(null, "T") === null ? 1 : 0, 1);

units.setSystem("SI");  // leave in default state

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${pass}/${pass + failures.length} unit conversion checks passed`);
if (failures.length) process.exitCode = 1;
