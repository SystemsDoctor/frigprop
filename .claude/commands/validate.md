---
description: Run the FrigProp accuracy validation (JS pipeline vs CoolProp truth)
---

Validate the real JS property pipeline end-to-end. Do not eyeball the UI for
this — compare numbers.

1. Run `node tests/e2e.mjs` and report pass/fail counts and any
   out-of-tolerance cases. Stop here if it passes.
2. If failures look like stale truth data (e.g. after a table regeneration),
   regenerate with `pip install coolprop && python3 scripts/gen_truth.py`,
   then re-run the harness.
3. Tolerances: COP ±1 %, h ±0.5 kJ/kg, s ±0.002 kJ/kg·K, T ±0.3 K (state-2
   gates widen proportionally at extreme discharge superheat — see e2e.mjs).
4. Report a compact table: fluid, case, pipeline vs truth, pass/fail. List any
   thrown errors verbatim — errors on in-range inputs are failures, not skips.
