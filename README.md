# FrigProp

Interactive refrigerant property lookup and vapor-compression refrigeration
cycle (VCRC) analysis. Runs entirely in-browser — static files, no server,
no build step.

**Live tool:** https://www.frigprop.com

## Features

- **Refrigerant gallery** — 27 modern and legacy refrigerants, clustered by
  family (natural → HFO → HFC → HCFC → CFC), with safety class, GWP (AR4/AR5),
  ODP, regulatory status, typical applications, and replacement lineage.
  Keyboard navigable (arrow keys + Enter).
- **Property lookup** — full thermodynamic state (T, P, h, s, u, v, ρ, x, cp)
  from any supported input pair: T&P, P&h, P&s, T&quality, P&quality, plus
  saturation-row views at a given T or P (bubble/dew shown separately for
  zeotropic blends).
- **VCRC cycle analysis** — four-state cycle from evaporator and condensing
  temperatures, with optional superheat/subcooling (specified as ΔT from
  saturation or as a pressure) and compressor isentropic efficiency.
  Outputs state table, q_evap, q_cond, w_comp, COP for cooling and heating,
  pressure ratio, and discharge temperature.
- **Side-by-side comparison** — run the same cycle on a second refrigerant:
  overlaid saturation domes and cycles in distinct colors, metrics table.
- **T-s and P-h diagrams** — saturation dome, cycle overlay with the true
  constant-h expansion curve, lookup-state marker; pan/zoom with recenter,
  PNG download.
- **Export & sharing** — copy results as CSV, copy a URL that reproduces the
  configured cycle (fluid, comparison, inputs, units, diagram).

## Refrigerants (27)

- **Modern / low-GWP:** R-32, R-1234yf, R-1234ze(E), R-1233zd(E), R-454B,
  R-452B, R-513A, R-152a
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
CoolProp across a ~1600-case matrix (`tests/`) spanning the cycle condition
range, η < 1 compression, pressure-specified superheat/subcool, two-phase
qualities, deep superheat/subcool, and near-critical interpolation.

### Accuracy notes

- This is a table-interpolation teaching/engineering tool, not a certified
  property reference. The truth source is CoolProp 7.2.0.
- Zeotropic blends (R-407C, R-454B, R-452B) use bubble/dew lines per side;
  two-phase temperatures lerp across the glide.
- The cycle model is subcritical only; transcritical operation (e.g. R-744
  above 31 °C) is detected and blocked with an explanation.
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
node tests/e2e.mjs             # run the harness (no Python needed)
```

CI runs the harness on every push/PR; deploys to GitHub Pages go through the
same gate (`.github/workflows/`). Pages must be enabled once in repo settings
(Settings → Pages → Source: GitHub Actions).

## License

MIT License. See LICENSE.
