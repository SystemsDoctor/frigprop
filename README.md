# FrigProp

Interactive refrigerant thermodynamic properties and vapor compression 
cycle analysis tool. Runs entirely in-browser — no server required.

**Live tool:** https://SystemsDoctor.github.io/frigprop

## Features
- Refrigerant chemical, physical, and regulatory properties
- Vapor compression refrigeration cycle state point analysis
- Isentropic cycle performance: COP, capacities, net work

## Refrigerants Supported
R-134a, R-410A, R-32, R-1234yf, R-22, R-404A, R-407C, R-744 (CO₂), R-717 (Ammonia)

## Development

### Property Table Generation (Plan B backend)
Requires Python 3.10+ and CoolProp.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt
python scripts/generate_tables.py
```

Tables are written to `tables/` and committed to the repo.

## License
MIT License. See LICENSE.