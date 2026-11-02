// Rule 10: story text is written once with {{cast}} tokens ({{mark}}, {{vocab.org}}). Every token used by a story must be defined by
// every vertical that story can be shown with, or the page would print a missing-token marker. Shared by the doctor and the tests.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const jsonIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f)) : []);
const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;
const tokensOf = (value, found = new Set()) => {
  if (typeof value === 'string') for (const m of value.matchAll(TOKEN)) found.add(m[1]);
  else if (Array.isArray(value)) value.forEach((v) => tokensOf(v, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => tokensOf(v, found));
  return found;
};
const defined = (vertical, token) => Boolean(token.startsWith('vocab.') ? vertical.vocab?.[token.slice(6)] : vertical.cast?.[token]?.name);

/** { stories, tokens, missing: ["S01 uses {{x}} which airlines lacks"] } over the original stories and each pack's own. */
export function scanStories(root) {
  const data = path.join(root, 'web', 'src', 'data');
  const missing = [];
  let stories = 0;
  let tokens = 0;
  const check = (storyFiles, verticalFiles) => {
    const verticals = verticalFiles.map(readJson);
    for (const file of storyFiles) {
      const story = readJson(file);
      stories += 1;
      for (const token of tokensOf(story)) {
        tokens += 1;
        for (const v of verticals) if (!defined(v, token)) missing.push(`${story.id} uses {{${token}}} which ${v.id} lacks`);
      }
    }
  };
  check(jsonIn(path.join(data, 'stories')), jsonIn(path.join(data, 'verticals')));
  // Try-this scenarios (labels and notes carry {{cast}} tokens too): the generic list against every generic vertical, the utility pack's against its own.
  const tries = (name, list, verticalFiles) => {
    for (const v of verticalFiles.map(readJson)) for (const token of tokensOf(list)) { tokens += 1; if (!defined(v, token)) missing.push(`try-this ${name} uses {{${token}}} which ${v.id} lacks`); }
  };
  const genericTry = path.join(data, 'tryThis.generic.json');
  if (fs.existsSync(genericTry)) tries('generic', readJson(genericTry), jsonIn(path.join(data, 'verticals')));
  const utilityPack = path.join(root, 'server', 'src', 'packs', 'utility', 'pack.json');
  const utilityVertical = path.join(data, 'packs', 'utility', 'vertical.json');
  if (fs.existsSync(utilityPack) && fs.existsSync(utilityVertical)) tries('utility', readJson(utilityPack).tryThis ?? [], [utilityVertical]);
  const packs = path.join(data, 'packs');
  if (fs.existsSync(packs)) {
    for (const id of fs.readdirSync(packs).sort()) {
      check(jsonIn(path.join(packs, id, 'stories')), [path.join(packs, id, 'vertical.json')].filter(fs.existsSync));
    }
  }
  return { stories, tokens, missing };
}
