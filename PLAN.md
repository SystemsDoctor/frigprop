# FrigProp — Roadmap

In-browser refrigerant property lookup + vapor-compression cycle analysis.
This file tracks **future work only**; what's shipped is described in
`README.md`, and the development history lives in git.

## Status (v2.0)

Shipped through v1.2: ΔT-indexed table backend (schema v2), VCRC cycle
pane with range validation, property lookup, T-s / P-h diagrams, SI ⇄ US
units, CI + GitHub Pages deploys, isentropic efficiency, cycle
export/sharing, and an accessibility pass.

v2.0 delivered every basic improvement (B1–B7) and advanced operations
A0–A7 — R-449A (28 fluids), gallery filters, glide-aware coil
temperatures, diagram iso-lines and click-to-lookup, saturation CSV,
offline/PWA, and the Advanced Tools section (comparison, IHX, capacity,
cycle metrics, sensitivity sweep, superheated table, recent cycles).
Accuracy harness: `node tests/e2e.mjs`, ~2,360 CoolProp-truth checks
(gates: COP ±1 %, h ±0.5 kJ/kg, s ±0.002 kJ/kg·K, T ±0.3 K), plus
`node tests/units.mjs`.

Code map for the v2.0 additions (for whoever picks up A8/A9):
- `cycle.js`: `coilProfiles()`, `advancedMetrics()`, `sweepCycle()`,
  `superheatTable()`, `isoLines()`, `lookupFromTS()`; an IHX rides on the
  state array as `states.ihx` = { suction 1′, liquid 3′, Q, eff }.
- Advanced markers: `setAdvancedMarkers()` in `ui.js`, labels built in
  `app.js _refreshAdvancedMarkers()` — add every new cycle-altering option
  there.
- Recent cycles are stored as share-link params and recalled through the
  share-link restore path; new inputs need a share param to round-trip.
- `sw.js` discovers the app shell from `index.html`'s `?v=` import graph;
  sweep chart series colors are `--series-1/2` (validated for the dark
  surface).

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

Deferred to a future release (after 2.0):

A8. **Transcritical R-744 gas-cooler cycle** — gas-cooler pressure +
    exit-temperature inputs, optimum-pressure hint; needs supercritical
    table columns above P_crit (schema-compatible addition). Transcritical
    operation stays detected and blocked on the face.
A9. **Two-stage / cascade cycle builder** — intercooler pressure
    optimization, cascade pairs (R-744/R-717, R-23/R-134a); larger
    `cycle.js` rework. Last because it depends on A8-style multi-state
    rendering.

Suggested order when resumed: A8 → A9.

## Working notes for contributors

- Truth source is CoolProp; regenerate cases with `scripts/gen_truth.py`
  and validate with `node tests/e2e.mjs` (no Python needed at test time).
- Table schemas are documented in `.claude/docs/data-schemas.md`; bump
  `schema_version` everywhere when changing them.
- Architecture and layering rules: see `CLAUDE.md`.
