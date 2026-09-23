# FrigProp — Roadmap

In-browser refrigerant property lookup + vapor-compression cycle analysis.
This file tracks **future work only**; what's shipped is described in
`README.md`, and the development history lives in git.

## Status (v1.2)

All originally planned phases are complete: ΔT-indexed table backend
(schema v2), VCRC cycle pane with range validation, standalone property
lookup, T-s and P-h diagrams, SI ⇄ US units toggle, CI + GitHub Pages
deploys, and an end-to-end accuracy harness (`node tests/e2e.mjs`,
~1670 CoolProp-truth cases; gates: COP ±1 %, h ±0.5 kJ/kg,
s ±0.002 kJ/kg·K, T ±0.3 K). v1.2 added isentropic efficiency,
two-fluid comparison, cycle export/sharing, the true constant-h expansion
curve, and an accessibility pass. v1.3 (in progress) adds R-449A as the
28th fluid (R-404A/R-507A retrofit blend; composition, critical point and
config documented in `scripts/generate_tables.py`) and the Advanced Tools
section (collapsed `<details id="advanced-tools">` below the diagram,
open state in `localStorage`) with the two-fluid comparison moved into it.
Active advanced options flag the results, diagram and section headers via
`setAdvancedMarkers()` in `ui.js` (labels built in `app.js
_refreshAdvancedMarkers()` — add each new cycle-altering option there).
Glide-aware coil profiles (`coilProfiles()` in `cycle.js`) show evaporator
inlet → dew and condenser dew → bubble temperatures, glides and means for
zeotropes; two-phase T across a glide is now quadratic through the
mid-glide point (R-449A evaporator-inlet error 0.47 K → 0.12 K vs CoolProp
equilibrium), with truth cases for all four coil temperatures. Advanced
Tools now also has System Capacity (kW/TR → mass flow, compressor power,
heat rejection, displacement) and Cycle Metrics (volumetric capacity,
specific displacement, Carnot COPs, second-law efficiency) from
`advancedMetrics()` in `cycle.js`; they don't alter the cycle, so no marker.
Diagrams carry faint isobars (T-s) / isotherms (P-h) at display-unit round
values (`isoLines()` in `cycle.js`, labels kept in view by a Chart.js
plugin), and a click on the plot fills and runs Property Lookup (P-h: PH;
T-s: `lookupFromTS()` → TQ or TP with P solved by bisection). The gallery
has filter chips (family partition + GWP < 150 + A1 only), and the
Properties pane copies the full saturation table as CSV (bubble/dew P for
zeotropes). Advanced Tools also hosts a sensitivity sweep (`sweepCycle()`,
inline-SVG charts in `ui.js` with series colors `--series-1/2` validated for
the dark surface), a superheated vapor table (`superheatTable()`) and a
recent/pinned cycle list (sessionStorage / localStorage, stored as share
params and recalled through the share-link path). The internal heat
exchanger (A7) is the first option that alters the main cycle: states 1′/3′
ride on the state array as `states.ihx`, Q = ε·min(vapor-side, liquid-side)
enthalpy span, and the results/diagram carry the "Advanced: IHX ε …" marker.
Offline/PWA (B7): `sw.js` (network-first same-origin, cache-first CDN;
install caches the shell found via index.html's `?v=` import graph plus all
85 table files) and `manifest.webmanifest` with 192/512/maskable icons.

## Design principle — two tiers

The initial face of FrigProp stays a **straightforward property lookup +
single-cycle analysis with its diagram**. Everything beyond that lives in an
**Advanced Tools** section below the cycle results, **collapsed by default**
(`<details>` with a rotating disclosure arrow, reusing the existing
`.about-details` summary/`::before` rotate pattern and `--accent*`/panel
styles). Opening it never changes the basic cycle's numbers unless an
advanced option (e.g. IHX) is explicitly enabled, and the open/closed state
is remembered per viewer (`localStorage`, try/catch-guarded).

**The main cycle results + diagram are the single primary results
surface.** Advanced options that change the cycle (IHX, and any future
option that alters states, results or the diagram) apply to that same
surface rather than a separate one — and whenever one is active, both the
results panel and the diagram carry a clear "Advanced: …" marker naming
the active option(s), so a modified cycle is never mistaken for the base
cycle. Advanced outputs that don't alter the cycle (capacity, Carnot,
sweeps, tables) render inside Advanced Tools. Isentropic efficiency is
part of the basic cycle and stays on the face.

- **Basic improvements** — refine what the face already does (fluids,
  lookup, diagram, presentation). No new cycle calculations.
- **Advanced operations** — any additional cycle calculation, multi-cycle
  tool, or bulk-data generator. Controls and outputs live inside Advanced
  Tools; thermodynamics goes in `cycle.js` (pure), rendering in `ui.js`.

Each advanced calculation ships with CoolProp-truth cases in
`scripts/gen_truth.py` / `tests/e2e.mjs` under the standard gates.

## Basic improvements (main face)

All planned basic improvements (B1–B7) have shipped — see Status above.
New ones go here.

## Advanced operations (Advanced Tools section, closed by default)

A8. **Transcritical R-744 gas-cooler cycle** — gas-cooler pressure +
    exit-temperature inputs, optimum-pressure hint; needs supercritical
    table columns above P_crit (schema-compatible addition). Transcritical
    operation stays detected and blocked on the face.
A9. **Two-stage / cascade cycle builder** — intercooler pressure
    optimization, cascade pairs (R-744/R-717, R-23/R-134a); larger
    `cycle.js` rework. Last because it depends on A8-style multi-state
    rendering.

Suggested order: A8 → A9.

## Working notes for contributors

- Truth source is CoolProp; regenerate cases with `scripts/gen_truth.py`
  and validate with `node tests/e2e.mjs` (no Python needed at test time).
- Table schemas are documented in `.claude/docs/data-schemas.md`; bump
  `schema_version` everywhere when changing them.
- Architecture and layering rules: see `CLAUDE.md`.
