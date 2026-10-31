// Pattern from id-jag-standalone web/src/story/stories.js. All story files and vertical packs are loaded at build time.
// A story's "modes" are the pages it appears on.

const byFile = (mods) => Object.values(mods).map((m) => m.default ?? m);

export const PAGES_WITH_STORIES = ["policies", "console", "approvals", "trace", "learn"];
export const STORIES = byFile(import.meta.glob("../data/stories/*.json", { eager: true })).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
export const VERTICALS = byFile(import.meta.glob("../data/verticals/*.json", { eager: true }));

// Vertical packs that bring their own people, tools and stories (the server's PACK=<id>). Each lives in data/packs/<id>/:
// vertical.json (names and nouns) and stories/*.json. The original stories and the generic, airlines and banking packs above
// are the "generic" pack and are unchanged. A pack's stories name that pack's tools, so they show only when the server runs it.
const PACK_VERTICALS = byFile(import.meta.glob("../data/packs/*/vertical.json", { eager: true }));
const PACK_STORIES = import.meta.glob("../data/packs/*/stories/*.json", { eager: true });
const packOf = (path) => path.split("/")[3];
export const PACK_IDS = ["generic", ...PACK_VERTICALS.map((v) => v.id)];
const storiesOfPack = (id) => byFile(Object.fromEntries(Object.entries(PACK_STORIES).filter(([p]) => packOf(p) === id)))
  .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

export const DEFAULT_VERTICAL = "generic";
const ALL_VERTICALS = [...VERTICALS, ...PACK_VERTICALS];
export const verticalById = (id) => ALL_VERTICALS.find((v) => v.id === id) || VERTICALS.find((v) => v.id === DEFAULT_VERTICAL);
const ALL_STORIES = [...STORIES, ...PACK_IDS.filter((p) => p !== "generic").flatMap(storiesOfPack)];
export const storyById = (id) => ALL_STORIES.find((s) => s.id === id) || null;

/** The stories of a pack ("generic" = the original five), in id order. */
export const storiesOf = (pack = "generic") => (pack === "generic" ? STORIES : storiesOfPack(pack));
/** The vertical packs (name and noun sets) a pack offers in the story panel. */
export const verticalsOf = (pack = "generic") => (pack === "generic" ? VERTICALS : PACK_VERTICALS.filter((v) => v.id === pack));
/** The vertical to use for a stored choice: the choice if this pack offers it, else the pack's first. */
export const verticalFor = (pack, id) => { const list = verticalsOf(pack); return list.find((v) => v.id === id) || list.find((v) => v.id === DEFAULT_VERTICAL) || list[0]; };
/** The stories shown on a page, in id order. */
export const storiesForPage = (page, pack = "generic") => storiesOf(pack).filter((s) => s.modes.includes(page));
