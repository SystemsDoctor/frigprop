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

## Additional proposed innovations (from code audit)

7. **Capacity + mass-flow inputs** — add an optional system capacity field
   (kW or tons of refrigeration) so the tool can output actual compressor
   power (kW), refrigerant mass-flow rate (kg/s), and pipe/component sizing
   hints. Requires no new table data; pure arithmetic on existing metrics.
8. **Carnot / second-law efficiency** — display COP relative to the ideal
   Carnot COP for the same temperature lift, and a second-law (exergetic)
   efficiency percentage. Needs only T1 and T3 in Kelvin.
9. **Refrigerant gallery filter bar** — a small row of toggle chips above
   the gallery (All | Natural | HFO | HFC | Low-GWP | A1-only) to narrow
   down the 27-card grid. Pure DOM filter on existing card attributes; no
   backend changes.
10. **Saturation property table export** — a button that tabulates the
    saturation line (T, P_sat, h_f, h_g, s_f, s_g, ρ_f, ρ_g) over the
    full temperature range and copies it as CSV. Backend data already exists
    in `sat.json`; only a small UI pane needed.
11. **Interactive diagram state picker** — clicking a point on the T-s or
    P-h canvas fires a property lookup at those coordinates (inverse
    interpolation already exists in `tables.js`). Makes the diagram a
    teaching tool as well as a display.
12. **History / pinned cycles** — a collapsible sidebar panel listing the
    last N calculated cycles (stored in `sessionStorage`) with quick-recall
    buttons. Allows fast before/after comparisons when tweaking inputs.
13. **Cycle sensitivity sweep** — "vary evaporator T from X to Y in Z steps"
    micro-mode that plots COP vs temperature as a sparkline. Runs existing
    `computeVCRCStates` in a loop; no new backend data needed.
14. **Mollier (P-h) table generator** — tabulate superheated vapor properties
    on a regular (T, P) grid for the selected refrigerant and export as CSV
    or formatted HTML. Useful for hand-checking interpolation or classroom
    handouts.
15. **Faint isobar / isotherm grid lines on diagrams** — draw a sparse set of
    constant-pressure lines (isobars) on the T-s diagram and constant-temperature
    lines (isotherms) on the P-h diagram, rendered as thin, low-opacity strokes
    behind the saturation dome and cycle path. Pressures/temperatures sampled
    at round values spanning the visible range; each line labeled at one edge.
    Implemented in `chart.js` as an additional dataset (type: "line", pointRadius: 0)
    per iso-line, using existing `getProps("TP", ...)` calls over a sweep of entropy
    or enthalpy values. Lines recomputed on zoom/recenter so labels stay in view.

## Working notes for contributors

- Truth source is CoolProp; regenerate cases with `scripts/gen_truth.py`
  and validate with `node tests/e2e.mjs` (no Python needed at test time).
- Table schemas are documented in `.claude/docs/data-schemas.md`; bump
  `schema_version` everywhere when changing them.
- Architecture and layering rules: see `CLAUDE.md`.
