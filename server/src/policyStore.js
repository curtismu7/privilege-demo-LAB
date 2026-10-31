// Policies as files under DATA_DIR/policies/{active,candidate}/<id>.cedar. Active decides; Candidate is shadow-evaluated only.
// Single tenant: one store per process. A set that fails validation is never installed; one that is broken on disk at startup
// leaves the engine with no policy set, which decide() treats as deny.
import fs from 'node:fs';
import path from 'node:path';
import { init, loadShippedPolicies, validatePolicies } from './cedar/index.js';

const ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const EMPTY = (schema) => ({ staticPolicies: {}, annotations: {}, effects: {}, ...(schema ? { schema } : {}) });

export const validId = (id) => typeof id === 'string' && ID_RE.test(id);

// `pack` (optional) supplies its own Cedar schema and shipped policies; a pack other than generic keeps its files in
// DATA_DIR/policies-<id>/ so switching PACK never feeds one pack's policies to another pack's schema.
export function createPolicyStore({ dataDir, pack = null }) {
  init();
  const schema = pack?.schema;
  const shipped = () => (pack ? pack.shippedPolicies() : loadShippedPolicies());
  const root = path.join(dataDir, !pack || pack.id === 'generic' ? 'policies' : `policies-${pack.id}`);
  const dirOf = (state) => path.join(root, state);
  const fileOf = (state, id) => path.join(dirOf(state), `${id}.cedar`);

  function readDir(state) {
    const d = dirOf(state);
    if (!fs.existsSync(d)) return {};
    const out = {};
    for (const f of fs.readdirSync(d).filter((n) => n.endsWith('.cedar')).sort()) {
      const id = f.slice(0, -'.cedar'.length);
      if (validId(id)) out[id] = fs.readFileSync(path.join(d, f), 'utf8');
    }
    return out;
  }
  const writeFile = (state, id, text) => {
    fs.mkdirSync(dirOf(state), { recursive: true });
    const tmp = `${fileOf(state, id)}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, fileOf(state, id));
  };
  const isEmptyObject = (m) => m !== null && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length === 0;
  const compile = (map) => (!isEmptyObject(map) ? validatePolicies(map, { schema }) : { ok: true, problems: [], policySet: EMPTY(schema) });

  let active = { policySet: null, error: null };
  let candidate = null; // { policySet, ids } when candidates exist and compile
  function load() {
    const a = compile(readDir('active'));
    active = a.ok ? { policySet: a.policySet, error: null } : { policySet: null, error: a.problems };
    const cands = readDir('candidate');
    candidate = null;
    if (Object.keys(cands).length && a.ok) {
      const c = compile({ ...readDir('active'), ...cands });
      if (c.ok) candidate = { policySet: c.policySet, ids: Object.keys(cands) };
    }
  }
  function seed() {
    fs.rmSync(root, { recursive: true, force: true });
    for (const [id, text] of Object.entries(shipped())) writeFile('active', id, text);
    load();
  }
  if (!fs.existsSync(dirOf('active'))) seed(); else load();

  return {
    validate: compile,
    activeSet: () => active.policySet,
    activeError: () => active.error,
    candidateSet: () => candidate,
    list() {
      const a = readDir('active');
      const c = readDir('candidate');
      const row = (state, id, text) => {
        const v = validatePolicies({ [id]: text }, { schema });
        const ps = v.policySet;
        return { id, state, text, effect: ps?.effects[id] ?? null, reason: ps?.annotations[id]?.reason ?? null, approvers: ps?.annotations[id]?.approvers ?? null };
      };
      return [...Object.entries(a).map(([id, t]) => row('active', id, t)), ...Object.entries(c).map(([id, t]) => row('candidate', id, t))];
    },
    // state "active" installs (and removes any candidate of the same id: that is promotion); "candidate" stages for shadow evaluation.
    put(id, text, state) {
      if (!validId(id)) return { ok: false, problems: [{ policyId: null, message: 'policy id must match [A-Za-z0-9._:-]{1,100}' }] };
      if (!['active', 'candidate'].includes(state)) return { ok: false, problems: [{ policyId: id, message: 'state must be active or candidate' }] };
      const next = state === 'active' ? { ...readDir('active'), [id]: text } : { ...readDir('active'), ...readDir('candidate'), [id]: text };
      const v = compile(next);
      if (!v.ok) return { ok: false, problems: v.problems };
      writeFile(state, id, text);
      if (state === 'active') fs.rmSync(fileOf('candidate', id), { force: true });
      load();
      return { ok: true, problems: [] };
    },
    remove(id, state) {
      if (!validId(id) || !['active', 'candidate'].includes(state) || !fs.existsSync(fileOf(state, id))) return { ok: false, notFound: true, problems: [] };
      if (state === 'active') {
        const rest = readDir('active');
        delete rest[id];
        const v = compile(rest);
        if (!v.ok) return { ok: false, problems: v.problems };
      }
      fs.rmSync(fileOf(state, id));
      load();
      return { ok: true, problems: [] };
    },
    reset: seed,
  };
}
