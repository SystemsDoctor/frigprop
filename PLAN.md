# FrigProp — Roadmap

In-browser refrigerant property lookup + vapor-compression cycle analysis.
This file tracks **future work only**; what's shipped is described in
`README.md`, and the development history lives in git.

## Status (v1.2)

All originally planned phases are complete: ΔT-indexed table backend
(schema v2), VCRC cycle pane with range validation, standalone property
lookup, T-s and P-h diagrams, SI ⇄ US units toggle, CI + GitHub Pages
deploys, and an end-to-end accuracy harness (`node tests/e2e.mjs`,
~1600 CoolProp-truth cases; gates: COP ±1 %, h ±0.5 kJ/kg,
s ±0.002 kJ/kg·K, T ±0.3 K). v1.2 added isentropic efficiency,
two-fluid comparison, cycle export/sharing, the true constant-h expansion
curve, and an accessibility pass.

## Stretch goals (roughly prioritized)

1. **Transcritical R-744 gas-cooler cycle** — gas-cooler pressure +
   exit-temperature inputs, optimum-pressure hint; needs supercritical
   table coverage above P_crit (schema supports adding P columns).
   Currently transcritical operation is detected and blocked with an
   explanation.
2. **Volumetric metrics** — volumetric cooling capacity (kJ/m³ from
   ρ₁·q_evap) and compressor displacement estimate per kW; needs only
   existing data.
3. **Internal heat exchanger (IHX/economizer) option** — suction-line HX
   effectiveness input coupling superheat and subcooling.
4. **Two-stage / cascade cycle builder** — intercooler pressure
   optimization, cascade pairs (e.g. R-744/R-717, R-23/R-134a); larger
   `cycle.js` rework.
5. **Glide-aware coil profiles** — for zeotropes, show dew/bubble
   entry/exit temperatures in the results (sensible next step from the
   existing bubble/dew table columns).
6. **PWA/offline support** — service worker caching tables; the app is
   fully static so this is mostly manifest + cache plumbing.

## Working notes for contributors

- Truth source is CoolProp; regenerate cases with `scripts/gen_truth.py`
  and validate with `node tests/e2e.mjs` (no Python needed at test time).
- Table schemas are documented in `.claude/docs/data-schemas.md`; bump
  `schema_version` everywhere when changing them.
- Architecture and layering rules: see `CLAUDE.md`.
