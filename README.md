# FrigProp

Interactive refrigerant property lookup and vapor-compression refrigeration
cycle (VCRC) analysis. Runs entirely in-browser — static files, no server,
no build step.

**Live tool:** https://www.frigprop.com · **Version 2.0**

## What's new in 2.0

- **R-449A** joins the gallery (28 refrigerants), and gallery filter chips.
- **Advanced Tools** — a new section, closed by default, for everything
  beyond the basic lookup and cycle: internal heat exchanger, capacity
  sizing, volumetric and Carnot metrics, sensitivity sweeps, superheated
  vapor tables and recent cycles (the two-fluid comparison moved here).
- **Glide-aware coil temperatures** for zeotropic blends, with a more
  accurate two-phase temperature across the glide.
- **Diagrams**: faint labeled isobars / isotherms, and click-to-look-up.
- **Saturation table CSV** export.
- **Offline** use and installable web app.

## Features

The main page stays a straightforward property lookup and cycle diagram;
everything else lives in the collapsed **Advanced Tools** section.

- **Refrigerant gallery** — 28 modern and legacy refrigerants, clustered by
  family (natural → HFO → HFC → HCFC → CFC), with safety class, GWP (AR4/AR5),
  ODP, regulatory status, typical applications, and replacement lineage.
  Filter chips (All, Natural, HFO, HFC, Legacy, GWP < 150, A1 only).
  Keyboard navigable (arrow keys + Enter).
- **Property lookup** — full thermodynamic state (T, P, h, s, u, v, ρ, x, cp)
  from any supported input pair: T&P, P&h, P&s, T&quality, P&quality, plus
  saturation-row views at a given T or P (bubble/dew shown separately for
  zeotropic blends). The Properties pane copies the whole saturation table
  (T, P, h, s, ρ for liquid and vapor) as CSV.
- **VCRC cycle analysis** — four-state cycle from evaporator and condensing
  temperatures, with optional superheat/subcooling (specified as ΔT from
  saturation or as a pressure) and compressor isentropic efficiency.
  Outputs state table, q_evap, q_cond, w_comp, COP for cooling and heating,
  pressure ratio, and discharge temperature. For zeotropic blends it also
  shows each coil's temperature glide: evaporator inlet → dew point,
  condenser dew point → bubble point, and the mean temperatures.
- **T-s and P-h diagrams** — saturation dome, cycle overlay with the true
  constant-h expansion curve, lookup-state marker; faint labeled isobars
  (T-s) / isotherms (P-h) at round values; click any point to look it up in
  Property Lookup; pan/zoom with recenter, PNG download.
- **Export & sharing** — copy results as CSV, copy a URL that reproduces the
  configured cycle (fluid, inputs, units, diagram, and any comparison, heat
  exchanger or capacity).
- **Advanced Tools** — collapsed by default below the diagram. Options that
  change the main cycle (the comparison and the heat exchanger) flag the
  results and diagram with an orange "Advanced: …" marker; the others show
  their output inside the section.
  - **Side-by-side comparison** — run the same cycle on a second
    refrigerant: overlaid saturation domes and cycles in distinct colors,
    metrics table.
  - **Internal heat exchanger** — suction-line IHX with effectiveness ε:
    the main cycle gains states 1′ (compressor inlet) and 3′ (valve inlet),
    and Q_IHX is reported.
  - **System capacity** — optional cooling capacity (kW or TR) scales the
    cycle to refrigerant mass flow, compressor power, condenser heat
    rejection and compressor displacement.
  - **Cycle metrics** — volumetric cooling capacity and specific
    displacement, Carnot COP between the mean evaporating/condensing
    temperatures, and second-law efficiency (for both fluids when comparing).
  - **Sensitivity sweep** — re-run the cycle over a range of evaporating or
    condensing temperatures; COP and discharge-temperature charts (both
    fluids when comparing), a table view and CSV.
  - **Superheated vapor table** — h, s, ρ, u or cp on a regular (T, P)
    grid for the selected refrigerant; CSV of all properties.
  - **Recent cycles** — the cycles calculated in this tab, with pinning
    (kept across reloads) and one-click recall.
- **Offline / installable** — a service worker caches the app and every
  refrigerant table (~1.6 MB) on the first visit, so everything works
  offline afterwards; the web manifest lets browsers install it as an app.

## Refrigerants (28)

- **Modern / lower-GWP:** R-32, R-1234yf, R-1234ze(E), R-1233zd(E), R-454B,
  R-452B, R-449A, R-513A, R-152a
- **Legacy HFC / HCFC / CFC:** R-134a, R-410A, R-407C, R-404A, R-507A, R-23,
  R-22, R-123, R-12, R-11
- **Natural & other-purpose fluids:** R-744 (CO₂), R-717 (ammonia),
  R-290 (propane), R-1270 (propylene), R-600a (isobutane), R-600 (n-butane),
  R-170 (ethane), R-718 (water), R-E170 (dimethyl ether)

## How it works

Properties are bilinearly interpolated in the browser from precomputed
CoolProp tables (`tables/`). Single-phase grids are indexed by distance from
saturation (ΔT, P) with log-P interpolation, which keeps accuracy high where
cycles actually live. The end-to-end pipeline is held to ±1 % COP,
±0.5 kJ/kg enthalpy, ±0.002 kJ/kg·K entropy, and ±0.3 K temperature against
CoolProp across ~2,400 checks (`tests/`) spanning the cycle condition
range, η < 1 compression, pressure-specified superheat/subcool, two-phase
qualities, deep superheat/subcool, near-critical interpolation, glide-aware
coil temperatures, internal-heat-exchanger cycles, the Advanced Tools
metrics, sensitivity sweeps, superheated tables and diagram picks.

### Accuracy notes

- This is a table-interpolation teaching/engineering tool, not a certified
  property reference. The truth source is CoolProp 7.2.0.
- Zeotropic blends (R-407C, R-454B, R-452B, R-449A) use bubble/dew lines per
  side; two-phase temperatures follow a quadratic in quality through the
  bubble, mid-glide (Q = 0.5) and dew points, held to the ±0.3 K gate against
  CoolProp's equilibrium temperature (worst case ~0.12 K, R-449A).
- The cycle model is single-stage and subcritical; transcritical operation
  (e.g. R-744 above 31 °C) is detected and blocked with an explanation.
  A transcritical gas-cooler cycle and two-stage / cascade cycles are
  planned for a future release (`PLAN.md`).
- Internal heat exchanger: the tables cover liquid within 40 K of
  saturation, so where the liquid side's maximum cooling lies beyond that,
  the vapor side (lower cp) is taken as limiting — true for normal fluids
  and checked against CoolProp in the harness.
- Compression is isentropic by default (η adjustable); dry fluids (R-600a,
  R-1234yf) legitimately end two-phase from a saturated-vapor inlet — the
  tool notes this rather than flagging an error.

## Development

No build step — serve the repo root over HTTP and open it:

```bash
python3 -m http.server   # then http://localhost:8000
```

### Regenerating property tables

Requires Python 3.10+ with CoolProp:

```bash
pip install -r scripts/requirements.txt
python3 scripts/generate_tables.py            # all fluids
python3 scripts/generate_tables.py R134a      # one fluid
```

### Validation

```bash
python3 scripts/gen_truth.py   # regenerate tests/truth.json (needs CoolProp)
node tests/e2e.mjs             # run the accuracy harness (no Python needed)
node tests/units.mjs           # unit-conversion checks
```

CI runs the harness on every push/PR; deploys to GitHub Pages go through the
same gate (`.github/workflows/`). Pages must be enabled once in repo settings
(Settings → Pages → Source: GitHub Actions).

## License

MIT License. See LICENSE.
