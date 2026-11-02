// Names and safe text for the explanation. Everything that comes from a token (sub, groups, scopes, agent) is caller-controlled
// (in live mode PingFederate-controlled), so it is stripped of control and format characters, capped, and withheld if it looks
// like a credential. Persona names are used only in mock mode: a live user whose sub is "mark" is not the demo's Mark.
import { CAST_KEYS } from '../customer.js';
import { credentialProblem } from '../trace/redaction.js';

// C0/C1 controls and Unicode format characters (bidi overrides, zero-width), same set customer.js refuses.
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu;

/** Plain text of at most `max` characters, no control or format characters. For text the admin wrote (an @reason). */
export const clean = (value, max = 200) => {
  const s = String(value ?? '').replace(STRIP, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** clean() for text a caller controls: a value that looks like a credential is replaced by [withheld]. */
export const safe = (value, max = 60) => {
  const raw = String(value ?? '').replace(STRIP, '').slice(0, 4096);
  if (credentialProblem(raw, true)) return '[withheld]';
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
};

const titleCase = (s) => s.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** "Priya", "Priya or Sam", "Priya, Sam or Lee" */
export const orList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);
/** "a", "a and b", "a, b and c" */
export const andList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function createNamer({ pack, customer, mode }) {
  const cast = customer?.config?.cast ?? {};
  const mock = () => mode() === 'mock';
  const nameOfSub = (sub) => {
    if (mock() && typeof sub === 'string') {
      if (CAST_KEYS.includes(sub) && cast[sub]) return safe(cast[sub], 40);
      if (Object.hasOwn(pack.personas ?? {}, sub) && pack.personas[sub].name) return safe(pack.personas[sub].name, 40);
    }
    return safe(sub);
  };
  const agentName = (sub) => (mock() ? safe(cast.agent ?? titleCase(String(sub)), 40) : safe(sub));
  return { nameOfSub, agentName, mock };
}
