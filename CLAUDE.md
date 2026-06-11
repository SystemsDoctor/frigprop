# FrigProp — Agent Guidance

In-browser refrigerant property lookup + vapor-compression cycle analysis.
Static site for GitHub Pages. **No build step, no bundler, no framework.**
Roadmap: `PLAN.md`. Data formats: `.claude/docs/data-schemas.md`.

## Architecture (keep it this way)

- Vanilla ES modules in `assets/js/`, loaded directly by `index.html`.
  Only external dependency: Chart.js via CDN. Do not add npm, package.json,
  TypeScript, or frameworks.
- Strict layering — preserve it:
  - `tables.js` — property backend (interpolation over precomputed JSON tables).
    Its exported interface (`init/getProps/getSatProps/getFluidMeta/getSatRows`)
    is a stable contract; change internals freely, signatures only with care.
  - `cycle.js` — pure thermodynamics, no DOM.
  - `ui.js` — pure DOM rendering, no thermodynamics.
  - `chart.js` — T-s / P-h diagrams only (pure rendering, no thermodynamics).
  - `app.js` — thin controller wiring the above.
- `tables/*.json` are **generated artifacts** — never hand-edit. Regenerate with
  `pip install coolprop orjson numpy && python3 scripts/generate_tables.py [FLUID...]`.
- Units everywhere: T °C, P kPa, h/u kJ/kg, s/cp kJ/kg·K, ρ kg/m³. Convert at
  the CoolProp boundary (scripts) only, never in the UI.

## Verification

- Truth source is CoolProp (`pip install coolprop` works in this container).
- Test the real pipeline headlessly: shim `fetch` in Node to read local files,
  import `tables.js`/`cycle.js` verbatim, compare to CoolProp values
  (see `/validate` command). Accuracy gates: COP ±1 %, h ±0.5 kJ/kg,
  s ±0.002 kJ/kg·K, T ±0.3 K.
- A correct-looking render is not verification — check numbers against CoolProp.

## Economy

- Never read `tables/*.json` into context (large, generated). Inspect via a
  short `python3 -c` / `node -e` snippet instead; schemas are documented in
  `.claude/docs/data-schemas.md`.
- Prefer the smallest correct change; this codebase is ~2.5k lines — no new
  abstraction layers, helpers only when used twice or more.
- Don't restate file contents or diffs in replies; report outcomes and numbers.

## Style

- Match existing code: 2-space indent, `_private` helpers, JSDoc on exports,
  section divider comments. CSS uses custom properties in `style.css` — reuse
  the existing `--accent*`/panel patterns rather than inventing new ones.
- When changing `style.css` or any `assets/js/*`, bump the `?v=` query on the
  stylesheet/script tags in `index.html` — GitHub Pages caches assets ~10 min
  and a stale-CSS/fresh-HTML mix breaks the layout for viewers.
- Errors thrown by the backend must state the value and the valid range;
  the UI must turn them into friendly messages, never raw exceptions.
