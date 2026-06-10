/**
 * e2e.mjs — End-to-end accuracy harness for the FrigProp JS pipeline.
 *
 * Imports tables.js + cycle.js verbatim (fetch shimmed to local files) and
 * compares against committed CoolProp truth (tests/truth.json, regenerate
 * with scripts/gen_truth.py). No Python or CoolProp needed at run time:
 *
 *   node tests/e2e.mjs
 *
 * Exits non-zero on any out-of-tolerance result.
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Tolerances (PLAN.md acceptance gates)
const TOL = { COP_rel: 0.01, h: 0.5, s: 0.002, u: 0.5, T: 0.3, rho_rel: 0.005, P_rel: 0.005 };

globalThis.fetch = async (url) => {
  const p = path.join(ROOT, url.replace('./', ''));
  try {
    const txt = await readFile(p, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt) };
  } catch {
    return { ok: false, status: 404 };
  }
};

const backend = (await import(path.join(ROOT, 'assets/js/tables.js'))).default;
const { computeVCRCStates, analyzeVCRC } = await import(path.join(ROOT, 'assets/js/cycle.js'));
const truth = JSON.parse(await readFile(path.join(ROOT, 'tests/truth.json'), 'utf8'));

let pass = 0;
const failures = [];

function check(label, errs) {
  if (errs.length) failures.push(`${label}: ${errs.join('; ')}`);
  else pass++;
}

function diff(errs, name, got, want, tol, rel = false) {
  if (got === null || got === undefined || Number.isNaN(got)) {
    errs.push(`${name} missing (want ${want.toFixed(3)})`);
    return;
  }
  const d = rel ? Math.abs(got / want - 1) : Math.abs(got - want);
  if (d > tol) errs.push(`${name} ${got.toFixed(4)} vs ${want.toFixed(4)}`);
}

// --- Cycle cases -----------------------------------------------------------

for (const c of truth.cycles) {
  const w = c.want;
  const label = `cycle ${c.fluid} Te=${c.Te} Tc=${c.Tc} sh=${c.sh} sc=${c.sc}`;
  try {
    await backend.init(c.fluid);
    const inputs = {
      T1_C: c.Te, T3_C: c.Tc,
      superheat: c.sh > 0, dT_sh_K: c.sh,
      subcool: c.sc > 0, dT_sc_K: c.sc,
    };
    const states = await computeVCRCStates(backend, inputs);
    const m = analyzeVCRC(states);
    const errs = [];
    diff(errs, 'COP', m.COP_c, w.COP, TOL.COP_rel, true);
    diff(errs, 'h1', states[0].h, w.h1, TOL.h);
    diff(errs, 's1', states[0].s, w.s1, TOL.s);
    diff(errs, 'h2', states[1].h, w.h2, TOL.h);
    diff(errs, 'T2', states[1].T_C, w.T2, TOL.T);
    diff(errs, 'h3', states[2].h, w.h3, TOL.h);
    diff(errs, 'P1', states[0].P_kPa, w.P1_kPa, TOL.P_rel, true);
    diff(errs, 'P2', states[1].P_kPa, w.P2_kPa, TOL.P_rel, true);
    check(label, errs);
  } catch (e) {
    failures.push(`${label}: threw ${e.message}`);
  }
}

// --- Standalone getProps cases ----------------------------------------------

for (const c of truth.props) {
  const w = c.want;
  const label = `props ${c.fluid} ${c.pair}(${c.v1.toFixed(2)}, ${c.v2.toFixed(3)})`;
  try {
    await backend.init(c.fluid);
    const st = await backend.getProps(c.pair, c.v1, c.v2);
    const errs = [];
    diff(errs, 'T', st.T_C, w.T_C, TOL.T);
    diff(errs, 'h', st.h, w.h, TOL.h);
    diff(errs, 's', st.s, w.s, TOL.s);
    diff(errs, 'u', st.u, w.u, TOL.u);
    diff(errs, 'rho', st.rho, w.rho, TOL.rho_rel, true);
    check(label, errs);
  } catch (e) {
    failures.push(`${label}: threw ${e.message}`);
  }
}

// --- Report ------------------------------------------------------------------

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`\n${pass}/${pass + failures.length} passed` +
            ` (truth: CoolProp ${truth.coolprop_version})`);
if (failures.length) process.exitCode = 1;
