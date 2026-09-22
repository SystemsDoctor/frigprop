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

## Design principle — two tiers

The initial face of FrigProp stays a **straightforward property lookup +
single-cycle analysis with its diagram**. Everything beyond that lives in an
**Advanced Tools** section below the cycle results, **collapsed by default**
(`<details>` with a rotating disclosure arrow, reusing the existing
`.about-details` summary/`::before` rotate pattern and `--accent*`/panel
styles). Opening it never changes the basic cycle's numbers unless an
advanced option (e.g. IHX) is explicitly enabled, and the open/closed state
is remembered per viewer (`localStorage`, try/catch-guarded).

- **Basic improvements** — refine what the face already does (fluids,
  lookup, diagram, presentation). No new cycle calculations.
- **Advanced operations** — any additional cycle calculation, multi-cycle
  tool, or bulk-data generator. Controls and outputs live inside Advanced
  Tools; thermodynamics goes in `cycle.js` (pure), rendering in `ui.js`.

Each advanced calculation ships with CoolProp-truth cases in
`scripts/gen_truth.py` / `tests/e2e.mjs` under the standard gates.

## Basic improvements (main face)

B1. **Add R-449A — 28th gallery card** (fills the last grid cell: 28 cards
    tile evenly at 2/4/7/14 columns). Scope in the section below.
B2. **Glide-aware coil profiles** — for zeotropes, show dew/bubble
    entry/exit temperatures in the existing results (bubble/dew columns
    already in `sat.json`). Directly useful for R-449A, R-407C, R-454B.
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
    diagram and results show the IHX cycle, with a visible "IHX on" tag.
A8. **Transcritical R-744 gas-cooler cycle** — gas-cooler pressure +
    exit-temperature inputs, optimum-pressure hint; needs supercritical
    table columns above P_crit (schema-compatible addition). Transcritical
    operation stays detected and blocked on the face.
A9. **Two-stage / cascade cycle builder** — intercooler pressure
    optimization, cascade pairs (R-744/R-717, R-23/R-134a); larger
    `cycle.js` rework. Last because it depends on A0 plumbing and A8-style
    multi-state rendering.

Suggested order: B1 → A0 → B2 → A1–A3 (small, shared UI) → B3–B6 →
A4–A6 → A7 → B7 → A8 → A9.

## B1 scope — R-449A (Opteon™ XP40 class)

**Why this fluid.** The gallery has the high-GWP supermarket/commercial
refrigerants R-404A and R-507A but none of their lower-GWP A1 retrofit
replacements; R-449A is the most widely deployed one (R-404A/R-507A/R-22
retrofit, GWP AR4 1397 / AR5 1282, A1, ODP 0). It is also a ~5 K-glide
four-component zeotrope, which exercises the bubble/dew handling and gives
B2 a realistic test case. Alternatives checked against CoolProp 7.2.0:
R-448A fails (missing R-125/R-1234ze(E) binary pair — same failure mode as
R-466A, recorded in `ad0f7cd`); R-454C and R-1336mzz(Z) are not available.

**Verified in CoolProp 7.2.0** (`R449A.mix` / explicit mixture string):
composition 24.3/24.7/25.3/25.7 wt% R-32/R-125/R-1234yf/R-134a =
mole fractions 0.4074/0.1795/0.1935/0.2197; M = 87.21 g/mol; saturation
converges bubble/dew from −60 to 70 °C (fails ≥ 75 °C); glide 5.9 K at
−60 °C → 3.4 K at 60 °C; NBP bubble −45.7 °C / dew −39.9 °C;
`T_critical()` raises (two roots) — `all_critical_points()` gives
82.14 °C / 4502.6 kPa (the −162.9 °C root is spurious); superheat
flashes converge to 3500 kPa. At 0 °C sat. liquid: h ≈ 203.7 kJ/kg,
s ≈ 1.133 kJ/kg·K.

**Steps** (follows the R-454B/R-452B/R-513A workflow in `ad0f7cd`,
`4ec3526`):
1. `scripts/generate_tables.py` — add to the modern-blends group:
   `"R449A": {"cp_name": "R32[0.4074]&R125[0.1795]&R1234yf[0.1935]&R134a[0.2197]",
   "T_min_C": -60, "T_max_C": 60, "P_max_kPa": 3000,
   "T_crit_C": 82.14, "P_crit_kPa": 4502.6}` with a comment citing
   `all_critical_points()` (R-513A precedent).
2. Generate only the new fluid: `python3 scripts/generate_tables.py R449A`
   (partial runs merge into `manifest.json`). Inspect via `python3 -c`:
   no `null`s inside cycle territory, bubble/dew columns differ,
   `schema_version` 2.
3. `data/refrigerants.json` — full metadata entry (ASHRAE R-449A,
   components with wt%, `refrigerant_type` "HFO/HFC blend", T_glide ≈ 5
   K at typical conditions, replaces R-404A/R-507A/R-22, applications:
   supermarket and commercial refrigeration, cold storage, transport;
   `reference_state` "Mixture model (IIR components) — h_f ≈ 203.7 kJ/kg,
   s_f ≈ 1.133 kJ/kg·K at 0 °C"). Confirm it clusters with the HFO blends.
4. Truth + validation: `python3 scripts/gen_truth.py` (picks up `FLUIDS`
   automatically), then `node tests/e2e.mjs` — all gates must pass for
   R-449A and no regressions elsewhere. Spot-check a supermarket
   condition (−10/40 °C, 10 K SH, 5 K SC) against CoolProp directly.
5. Count 27 → 28 in `index.html` (meta/OG/Twitter descriptions, JSON-LD,
   About list), `README.md`, `.claude/docs/data-schemas.md` fluid list,
   and this file's status line. Bump `?v=` if any asset changes.
6. Visual check: the gallery's last row is full at desktop width and the
   R-449A card, lookup, cycle and both diagrams render.

## Working notes for contributors

- Truth source is CoolProp; regenerate cases with `scripts/gen_truth.py`
  and validate with `node tests/e2e.mjs` (no Python needed at test time).
- Table schemas are documented in `.claude/docs/data-schemas.md`; bump
  `schema_version` everywhere when changing them.
- Architecture and layering rules: see `CLAUDE.md`.
