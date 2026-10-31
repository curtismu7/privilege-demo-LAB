// The whole mapping layer: verified PF claims -> Cedar principal, group parents and token context.
// Cedar never sees the JWT. The caller has already verified signature, iss, aud and exp.
export const MAX_GROUPS = 100;
export const MAX_SCOPES = 100;
export const MAX_STRING = 256;
const MAX_DEPTH = 4;
const MAX_KEYS = 200;

// Plain JSON only: strings, finite numbers, booleans, null, arrays, and plain objects (Object.prototype or null).
export function plainJsonProblem(v, path, depth = 0) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} is not a finite number`;
  if (depth >= MAX_DEPTH) return `${path} is nested too deeply`;
  if (Array.isArray(v)) {
    if (v.length > 10000) return `${path} is too long`;
    for (let i = 0; i < v.length; i++) {
      const p = plainJsonProblem(v[i], `${path}[${i}]`, depth + 1);
      if (p) return p;
    }
    return null;
  }
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return `${path} is not a plain object`;
    const keys = Object.keys(v);
    if (keys.length > MAX_KEYS) return `${path} has too many keys`;
    for (const k of keys) {
      const p = plainJsonProblem(v[k], `${path}.${k}`, depth + 1);
      if (p) return p;
    }
    return null;
  }
  return `${path} is not JSON (${typeof v})`;
}

const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const goodString = (s) => typeof s === 'string' && s.length > 0 && s.length <= MAX_STRING;

export function mapClaims(claims) {
  const fail = (problems) => ({ ok: false, problems, principal: null, entities: [], token: null, truncated: false });
  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) return fail(['claims must be an object']);
  const json = plainJsonProblem(claims, 'claims');
  if (json) return fail([json]);

  const problems = [];
  const sub = own(claims, 'sub');
  if (!goodString(sub)) problems.push('sub must be a non-empty string');
  const clientId = own(claims, 'client_id');
  if (!goodString(clientId)) problems.push('client_id must be a non-empty string');

  const scope = own(claims, 'scope');
  let scopes = [];
  if (scope === undefined) scopes = [];
  else if (typeof scope !== 'string') problems.push('scope must be a space-separated string');
  else {
    scopes = [...new Set(scope.split(' ').filter(Boolean))];
    if (scopes.length > MAX_SCOPES || scopes.some((s) => s.length > MAX_STRING)) problems.push('scope has too many or too long values');
  }

  const rawGroups = own(claims, 'groups');
  let groups = [];
  let truncated = false;
  if (rawGroups !== undefined) {
    if (!Array.isArray(rawGroups) || rawGroups.some((g) => !goodString(g))) problems.push('groups must be an array of non-empty strings');
    else {
      groups = [...new Set(rawGroups)];
      if (groups.length > MAX_GROUPS) {
        groups = groups.slice(0, MAX_GROUPS);
        truncated = true;
      }
    }
  }

  const act = own(claims, 'act');
  let actor;
  if (act !== undefined) {
    // PF emits act as an object only with server-wide OGNL on; otherwise a string. A string act is rejected, not guessed at.
    if (act === null || typeof act !== 'object' || Array.isArray(act) || !goodString(own(act, 'sub'))) problems.push('act must be an object with a string sub');
    else actor = act.sub;
  }

  if (problems.length) return fail(problems);
  const uid = (type, id) => ({ type, id });
  return {
    ok: true,
    problems: [],
    truncated,
    principal: uid('User', sub),
    entities: [
      { uid: uid('User', sub), attrs: {}, parents: groups.map((g) => uid('Group', g)) },
      ...groups.map((g) => ({ uid: uid('Group', g), attrs: {}, parents: [] })),
    ],
    token: { scopes, client_id: clientId, ...(actor ? { actor } : {}) },
  };
}
