// Vertical packs. A pack is the data a demo needs: personas, the unattended agent, the tool list, and (for a pack that needs more
// than the original vocabulary) its own Cedar schema and shipped policies. PACK=<id> picks one at startup; the default is the
// original demo, unchanged. Adding a pack = a folder here and one line below.
import generic from './generic.js';
import utility from './utility/index.js';

export const PACKS = { generic, utility };
export const DEFAULT_PACK = 'generic';
export const getPack = (id) => (Object.hasOwn(PACKS, id ?? DEFAULT_PACK) ? PACKS[id ?? DEFAULT_PACK] : null);

// What the web page may know about a pack (no functions, nothing secret). Generic sends only its id: the page already has the original wording.
export const publicPack = (pack) => (pack.web ? { id: pack.id, label: pack.label, ...pack.web, agent: pack.agent } : { id: pack.id, label: pack.label });
