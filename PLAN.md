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
config documented in `scripts/generate_tables.py`).

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

B2. **Glide-aware coil profiles** — for zeotropes, show dew/bubble
    entry/exit temperatures in the existing results (bubble/dew columns
    already in `sat.json`). Directly useful for R-449A (~5 K glide),
    R-407C, R-454B.
B3. **Faint isobar / isotherm grid lines on diagrams** — sparse
    constant-P lines on T-s and constant-T lines on P-h, thin low-opacity
    strokes behind the dome and cycle path, round values across the visible
    range, one edge label each. `chart.js` adds one `pointRadius: 0` line
    dataset per iso-line; points come from `tables.js` calls made by
    `app.js` and passed in (keep `chart.js` free of thermodynamics).
    Recompute on zoom/recenter so labels stay in view.
B4. **Interactive diagram state picker** — clicking the T-s or P-h canvas
    fills the Property Lookup pane with that state (TS/PH inversion
    already in `tables.js`).
B5. **Refrigerant gallery filter bar** — toggle chips above the gallery
    (All | Natural | HFO | HFC | Low-GWP | A1-only); pure DOM filter on
    existing card data.
B6. **Saturation table export** — button in the Properties pane that copies
    the saturation line (T, P_sat, h_f, h_g, s_f, s_g, ρ_f, ρ_g) as CSV
    from `getSatRows`.
B7. **PWA/offline support** — manifest + service worker caching the static
    assets and tables; no app-logic change.

## Advanced operations (Advanced Tools section, closed by default)

A0. **Advanced Tools scaffold** — prerequisite for everything below.
    Collapsed `<details>` under the cycle pane, rotating arrow, sub-panels
    per tool. **Relocate the existing two-fluid comparison** (the
    `compare-fluid` selector) into it so the face shows one cycle.
    Isentropic efficiency stays on the face (core cycle input); CSV/link
    export stays on the face. Share links must still restore a comparison
    and open the section when one is present.
A1. **Capacity + mass-flow** — optional capacity input (kW or tons of
    refrigeration) → mass flow (kg/s), compressor power (kW), condenser
    rejection (kW). Arithmetic on existing metrics.
A2. **Volumetric metrics** — volumetric cooling capacity (ρ₁·q_evap,
    kJ/m³) and displacement per kW; with A1, required displacement (m³/h).
A3. **Carnot / second-law efficiency** — ideal Carnot COP from the
    evaporator/condenser temperatures (dew/bubble means for blends) and
    exergetic efficiency COP/COP_Carnot.
A4. **Cycle sensitivity sweep** — vary evaporator or condensing T from X to
    Y in N steps; plot COP (and discharge T) vs the swept variable. Loops
    `computeVCRCStates`; skips out-of-range points with a friendly note.
A5. **History / pinned cycles** — last N computed cycles (`sessionStorage`)
    with one-click recall, for before/after comparisons.
A6. **Superheated property table generator** — regular (T, P) grid for the
    selected fluid, exported as CSV/HTML for hand checks and handouts.
A7. **Internal heat exchanger (IHX)** — effectiveness input coupling
    suction superheat to liquid subcooling. When enabled, the face's
    diagram and results show the IHX cycle, marked per the
    "Advanced: …" rule above.
A8. **Transcritical R-744 gas-cooler cycle** — gas-cooler pressure +
    exit-temperature inputs, optimum-pressure hint; needs supercritical
    table columns above P_crit (schema-compatible addition). Transcritical
    operation stays detected and blocked on the face.
A9. **Two-stage / cascade cycle builder** — intercooler pressure
    optimization, cascade pairs (R-744/R-717, R-23/R-134a); larger
    `cycle.js` rework. Last because it depends on A0 plumbing and A8-style
    multi-state rendering.

Suggested order: A0 → B2 → A1–A3 (small, shared UI) → B3–B6 →
A4–A6 → A7 → B7 → A8 → A9.

## Working notes for contributors

- Truth source is CoolProp; regenerate cases with `scripts/gen_truth.py`
  and validate with `node tests/e2e.mjs` (no Python needed at test time).
- Table schemas are documented in `.claude/docs/data-schemas.md`; bump
  `schema_version` everywhere when changing them.
- Architecture and layering rules: see `CLAUDE.md`.
