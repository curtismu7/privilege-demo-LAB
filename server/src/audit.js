// One JSON line per decision at DATA_DIR/audit.jsonl. Never holds tokens, claims objects or free text from callers.
import fs from 'node:fs';
import path from 'node:path';
import { credentialProblem } from './trace/index.js';

// Id fields hold 32-hex trace ids by design; the trace envelope's own guard exempts them from the hex rule the same way.
const ID_FIELDS = new Set(['trace_id', 'span_id', 'parent_span_id']);

export function createAudit({ dataDir, now = () => Date.now() }) {
  const file = path.join(dataDir, 'audit.jsonl');
  return {
    file,
    write(entry) {
      // Caller-controlled strings (a token's sub, for one) are withheld if they look like a credential.
      const clean = Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, typeof v === 'string' && credentialProblem(v, !ID_FIELDS.has(k)) ? '[withheld]' : v]));
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify({ ts: new Date(now()).toISOString(), ...clean })}\n`);
      } catch { console.error('[privilege-demo] audit write failed'); } // class of error only; keep serving
    },
    read(limit = 200) {
      try { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l)); } catch { return []; }
    },
  };
}
