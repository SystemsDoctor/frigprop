---
description: Run the FrigProp accuracy validation (JS pipeline vs CoolProp truth)
---

Validate the real JS property pipeline end-to-end. Do not eyeball the UI for
this — compare numbers.

1. If `tests/e2e.mjs` exists, run `node tests/e2e.mjs` and report pass/fail
   counts and any out-of-tolerance cases. Stop here if it passes.
2. If the harness does not exist yet (pre-Phase-4), run an inline smoke test:
   write a temp Node script that shims `fetch` to read local files, imports
   `assets/js/tables.js` and `assets/js/cycle.js` verbatim, and computes cycles
   for every fluid in `tables/manifest.json` at Tevap −10 °C / Tcond 40 °C
   (clamp Tcond to T_crit − 8 K and Tevap to T_min + 5 where needed), plus
   subcooled-exit and superheated-inlet variants for R134a, and R744 at
   Tcond 22 °C.
3. Where CoolProp is available (`pip install coolprop`), compute ground truth
   for the same cases and compare. Tolerances: COP ±1 %, h ±0.5 kJ/kg,
   s ±0.002 kJ/kg·K, T ±0.3 K.
4. Report a compact table: fluid, case, pipeline vs truth, pass/fail. List any
   thrown errors verbatim — errors on in-range inputs are failures, not skips.
