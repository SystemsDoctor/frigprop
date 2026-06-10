# FrigProp — Review Findings & Implementation Plan

> **Status:** Phase 1 (section B) and Phase 4.1 (harness) complete.
> Schema v2 ΔT-grids + `tables.js` rewrite fixed A1–A4. Harness:
> `scripts/gen_truth.py` → `tests/truth.json` (committed) → `node tests/e2e.mjs`
> runs 117 cycle+props cases without Python; all pass. `validate_tables.py`
> retired (A8). Additions beyond plan: log-P interpolation, geometric ρ
> interpolation, glide-aware bubble/dew pressures (`P_bub`/`P_dew`).
> Next: Phase 2 (cycle pane), then Phase 3 (lookup pane).

Goal: a GitHub-Pages-hosted interactive page where a user (1) selects a modern
refrigerant from a card gallery, (2) sees regulatory / applications /
availability info, (3) looks up thermodynamic properties (T, P, h, s, u, v, ρ, x)
from independent property entries, (4) sees a T-s diagram of a vapor compression
cycle built from entered state properties, and (5) reads basic cycle results
(q_in, q_out, w_net per unit mass, COP for refrigeration and heating).

Items (1), (2), (4-partial), (5) already exist. Item (3) does not exist yet, and
several verified correctness bugs make the existing cycle results untrustworthy
for some fluids/conditions. Everything below was verified by running the actual
JS pipeline in Node (fetch shimmed to local files) and comparing against
CoolProp 7.2.0 ground truth. CoolProp installs cleanly in the dev container
(`pip install coolprop`), so table regeneration can be run here.

---

## A. Verified bugs (ranked by severity)

### A1. Subcooled condenser exit is completely broken (blocker)
Any typical subcooling fails. Example: R134a, T3 = 35 °C, P3 = 1017 kPa
(5 K subcooling) → `Error: T=35°C, P=1017 kPa is not in subcooled region`.

Root cause: `subcool.json` uses a coarse absolute-T grid (10 °C steps,
`scripts/generate_tables.py:217`) with `null` cells wherever T ≥ Tsat(P) − 0.5
(~40 % of cells). `_bilinear()` in `assets/js/tables.js:445` requires all 4
corners non-null and there is no liquid-side near-saturation bridge, so almost
every realistic subcooled state (1–10 K below Tsat) hits a null corner and
throws.

### A2. PS (isentropic) lookup returns badly wrong state 2 for several fluids (blocker)
Measured vs CoolProp truth at Tevap = −10 °C, Tcond = 40 °C, ideal cycle:

| Fluid | Pipeline COP_c | Truth COP_c | Pipeline T2 | Truth T2 |
|-------|---------------|-------------|-------------|----------|
| R404A | 5.072 (+44 %) | 3.515       | 40.0 °C     | 46.5 °C  |
| R290  | 4.934 (+24 %) | 3.966       | 40.6 °C     | 46.3 °C  |

Root cause: `_findTFromS` / `_findTFromH` (`assets/js/tables.js:285,390`) use a
"single-column fallback" near the saturation boundary — when one of the two
bracketing pressure columns is null they silently substitute the other column's
value *as if it were at the target pressure*. Near saturation, s varies strongly
with P, so the T crossing is found at the wrong temperature; `_bridgeNearSat`
then anchors the state there. Side effect: spurious "State 2 entropy < State 1
entropy (non-physical compression)" warnings.

Note: R600a and R1234yf showing T2 = Tsat with x2 < 1 is *correct* (dry/retrograde
fluids genuinely have wet isentropic compression from saturated vapor — pipeline
matches CoolProp exactly: COP 4.113 / x2 0.976 for R600a). Don't "fix" that; see C4.

### A3. Near-critical accuracy collapse (major)
R134a, Tevap = −10 °C, Tcond = 95 °C: pipeline COP_c = 1.133 vs truth 0.630
(+80 %). Root cause: superheat P grid is very sparse up high (2500, 3000,
4000 kPa) combined with A2's fallback. Same mechanism degrades all fluids as
Tcond approaches T_crit.

### A4. R744 (CO₂) subcritical cycles fail above Tcond ≈ 21 °C (major)
Tcond = 22 °C → `s=1.898 kJ/kgK out of range at P=6003 kPa`. The superheat P
grid for R744 stops at 6000 kPa (next standard point 8000 exceeds the
0.99·P_crit cut at 7303 kPa, so it's dropped), leaving no coverage for
6000–7300 kPa. Psat(22 °C) = 6003 kPa lands just outside the grid.

### A5. No input-range validation in the UI (moderate)
E.g. R410A with Tcond = 65 °C throws the raw backend error
`Temperature 65°C out of saturation range [-60, 60]`. The manifest already
carries `T_min_C / T_max_C / T_crit_C / P_max_kPa` per fluid but the UI never
uses it to constrain inputs or pre-empt errors.

### A6. T-s diagram defects (minor)
- `assets/js/chart.js:211` — when state 3 is subcooled, the condensation shelf
  (dew→bubble horizontal) is drawn at T3 instead of Tsat(P_cond), and
  `_closestSatRow` (±2 °C tolerance) then fails entirely, collapsing 2→3 to a
  straight line.
- `assets/js/chart.js:299` — tooltip filter `ctx.datasetIndex >= 2` includes the
  cycle-path polyline (index 2), producing tooltips with no state number on path
  vertices. Should be `>= 3` (only the state-dot dataset).
- 3→4 expansion is drawn as a straight line in T-s; a constant-h contour would
  be more truthful (low priority, label it as approximate if kept).

### A7. Misleading input labels when superheat/subcool checked (moderate UX)
`getInputs()` (`assets/js/ui.js:188`) reuses the T1 field as "compressor inlet
temperature" when *Superheated inlet* is checked, but the label still reads
"Evaporator Temperature" (same pattern for T3 / subcooled). The user has no way
to know the field's meaning changed. See C2 for the recommended redesign
(enter ΔT superheat/subcool instead of T+P pairs).

### A8. Validation tooling misses the actual bug layer (process)
`scripts/validate_tables.py` spot-checks raw table *nodes* against CoolProp —
all of which pass — while every real bug lives in the JS interpolation layer,
which is never tested. Its fluid list also covers only 9 of 14 fluids.

### A9. Documentation / housekeeping (minor)
- `README.md` lists 9 refrigerants; 14 are shipped. No mention of the lookup
  tool or T-s diagram.
- `assets/js/coolprop.js` is an empty 0-byte placeholder (Plan A backend);
  either implement later or delete and fix the comment in `app.js:3`.
- `app.js:42` registers the refrigerant-change handler only after a successful
  init; harmless today but fragile.

---

## B. Phase 1 — Rebuild the property-table backend (fixes A1–A4 at the root)

The null-riddled absolute-T grids are the root cause of A1–A4. Rather than
patching more bridges, regenerate the tables in saturation-anchored
coordinates so the grid is fully dense:

1. **Superheat table**: index rows by superheat above saturation,
   ΔT_sh ∈ {0, 2, 5, 10, 15, 20, 30, 40, 60, 80, 100} K, columns by P. Each
   cell is evaluated at T = Tsat(P) + ΔT_sh → every cell valid, near-saturation
   resolution excellent (this is where every cycle lives).
2. **Subcool table**: same idea, ΔT_sc ∈ {0, 1, 2, 5, 10, 15, 20, 30, 40} K
   below Tsat(P).
3. **Add internal energy `u`** (kJ/kg) to all tables (sat: uf/ug; single-phase
   grids: u). Required by the end goal; CoolProp output `U`. (Identity
   u = h − P/ρ can serve as a cross-check.)
4. **Densify P columns near P_crit** per fluid: extend the P list with
   ~0.80·P_crit, 0.90·P_crit, 0.95·P_crit, 0.99·P_crit (esp. R744: adds
   ~5900, 6640, 7010, 7300 kPa → fixes A4). Keep absolute anchor points for
   round-number pressures.
5. **Rewrite `tables.js` lookups** for the new schema:
   - TP: compute ΔT = T − Tsat(P) (sat-table lookup), then bilinear in (ΔT, P).
     Dense grid → no null handling, delete `_bridgeNearSat` and the
     single-column fallbacks (A2's root).
   - PH / PS: phase-classify against sat hf/hg (sf/sg) at P, two-phase via
     quality mix (unchanged), single-phase via 1-D search in ΔT at fixed P.
     Return `h = h_target` / `s = s_target` exactly (they're the independent
     variable) — kills the spurious entropy warnings.
   - Keep the exported interface identical (`init/getProps/getSatProps/
     getFluidMeta/getSatRows`) so `cycle.js`, `app.js`, `chart.js` are untouched.
6. Bump a `schema_version` field in `manifest.json` and table files; make
   `tables.js` assert it so stale caches fail loudly.

Acceptance: end-to-end harness (Phase 4) shows COP within ±1 % and h/s state
values within ±0.5 kJ/kg / ±0.002 kJ/kg·K of CoolProp for the full test matrix,
including R404A/R290 (A2), R134a Tcond 95 °C (A3), R744 Tcond 22–28 °C (A4),
and 1–10 K subcool cases (A1).

## C. Phase 2 — Cycle pane correctness & UX

1. **Range validation (A5)**: before calculation, check inputs against manifest
   ranges; show friendly inline messages ("R410A data covers −60…60 °C") and
   show each fluid's valid range near the inputs.
2. **Replace T+P entry for modified states with ΔT entry (A7)**: when
   *Superheated inlet* is checked, ask for "Superheat ΔT (K)" (state 1 then is
   T = Tevap + ΔT at P = Psat(Tevap)); when *Subcooled exit* is checked, ask for
   "Subcooling ΔT (K)". This matches how practitioners specify cycles, removes
   the relabeling problem, removes the redundant/error-prone pressure entry, and
   maps 1:1 onto the new ΔT-indexed tables. Keep evaporator/condensing
   temperature as the two primary inputs.
3. **Results**: add `u` column to the state table; keep q_evap, q_cond, w_comp,
   COP_c, COP_h, energy balance (already present, `cycle.js` math is correct).
4. **Wet-compression note (A2 note)**: when state 2 lands two-phase (dry fluids
   like R600a/R1234yf), show an informational note ("isentropic compression
   from saturated vapor ends inside the dome for this fluid — real systems use
   suction superheat") instead of letting it look like an error. Drop/loosen the
   `s2 < s1` warning once PS returns s_target exactly.
5. **Transcritical R744**: currently the transcritical notice shows but the calc
   then throws a confusing range error. Either (a) block calculation with a
   clear "subcritical model only — choose Tcond < 31 °C" message (minimum), or
   (b) implement a basic transcritical gas-cooler cycle (gas-cooler pressure +
   exit temperature inputs). (a) for this milestone; (b) stretch goal.

## D. Phase 3 — Standalone property lookup pane (new feature, required by goal)

New pane "Property Lookup" (left column under Properties, or a tab):
1. Input-pair selector: T & P, P & h, P & s, T & x, P & x — all already
   supported by `backend.getProps` (`TP/PH/PS/TQ/PQ`).
2. Output: full state — T (°C), P (kPa), h (kJ/kg), s (kJ/kg·K), u (kJ/kg),
   v (m³/kg, = 1/ρ), ρ (kg/m³), x (or single-phase label: subcooled liquid /
   saturated mix / superheated vapor / supercritical), cp where available.
3. Show the selected fluid's valid T/P envelope (from manifest) and friendly
   out-of-range messages.
4. Sat-table convenience: given T alone (or P alone), show the saturation row
   (Psat/Tsat, hf/hg, sf/sg, uf/ug, vf/vg) — cheap to add, very useful.
5. Optional polish: plot the looked-up state as a marker on the T-s diagram.

## E. Phase 4 — Validation harness & deployment

1. **End-to-end accuracy harness** (this is what caught A1–A4):
   - `scripts/gen_truth.py`: CoolProp → `tests/truth.json` for a matrix of
     (fluid × Tevap × Tcond × {sat, superheat ΔT} × {sat, subcool ΔT}) cycle
     cases plus standalone getProps cases (incl. PH/PS/TP near saturation and
     near critical).
   - `tests/e2e.mjs` (Node, no framework needed): shim `fetch` to read local
     files, import `assets/js/tables.js` + `cycle.js` verbatim, compare against
     truth.json with tolerances (COP ±1 %, h ±0.5 kJ/kg, s ±0.002 kJ/kg·K,
     T ±0.3 K). Exit non-zero on failure.
   - Update `scripts/validate_tables.py` fluid list to all 14 (or fold into the
     above and retire it).
   - Optional: GitHub Actions workflow running `node tests/e2e.mjs` on PRs
     (truth.json is committed, so CI needs no CoolProp).
2. **GitHub Pages deployment**: the site is already static-root,
   relative-pathed, with `.nojekyll`. Confirm Pages is enabled
   (Settings → Pages → Deploy from branch → `main` / root) or add a
   `actions/deploy-pages` workflow for explicit deploys. Verify the live URL in
   README works after merge.
3. **README refresh (A9)**: all 14 refrigerants, property-lookup feature, T-s
   diagram, table regeneration + validation instructions, accuracy notes
   (table-interpolation tool, not a certified reference; zeotropic blends
   R407C/R454B/R452B treated with Tsat at Q=0.5 mid-glide — document the
   approximation).
4. Housekeeping: delete or implement `assets/js/coolprop.js`; fix the chart
   tooltip filter and subcooled condensation shelf (A6).

---

## Suggested execution order for the coding agent

1. Phase 1 (tables schema + tables.js rewrite) — everything else depends on it.
   Regenerate with `pip install coolprop orjson numpy && python scripts/generate_tables.py`.
2. Phase 4.1 harness immediately after — prove A1–A4 are fixed before touching UI.
3. Phase 2 (cycle pane), then Phase 3 (lookup pane), then Phase 4.2–4.4.

Definition of done:
- All harness cases pass at stated tolerances.
- Subcooling 1–10 K works for every fluid; R744 subcritical works to ~28 °C;
  R404A/R290 COP within 1 % of CoolProp.
- Property lookup pane returns full states (incl. u and v) for all 5 input pairs.
- T-s diagram renders dome + cycle correctly for sat/superheated/subcooled cases.
- Site deploys on GitHub Pages from a clean clone with no build step.
