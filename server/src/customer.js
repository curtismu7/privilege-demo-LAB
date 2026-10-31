// customer.config: branding and vocabulary a customer-facing run can change without touching code (rule 12).
// customer.config.json (or CUSTOMER_CONFIG) in the repo root is read once at start. It is optional and gitignored: real customer
// names never go in the repo. Everything is validated; a bad field falls back to its default and the reason is reported, never thrown.
// The story text is written once with {{cast}} tokens ({{mark}}, {{vocab.org}}); `cast` renames the people, `vocabulary` the nouns.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_CONFIG_PATH = path.join(ROOT, 'customer.config.json');
const MAX_FILE_BYTES = 8 * 1024;

export const VERTICALS = ['generic', 'airlines', 'banking', 'utility'];
// The cast ids and vocabulary names the shipped verticals define (a web test pins that these match web/src/data).
export const CAST_KEYS = ['mark', 'mary', 'priya', 'dana', 'eli', 'gwen', 'ben', 'cora', 'agent'];
export const VOCAB_KEYS = ['org', 'bookItem', 'searchItem', 'ticketItem', 'payItem', 'toolsThree', 'approverRole', 'repoTeam', 'otherRepo', 'restrictedItem', 'mockNote'];
const LIMITS = { name: 40, tagline: 120, cast: 40, vocab: 80 };
const TOP_KEYS = new Set(['name', 'tagline', 'vertical', 'cast', 'vocabulary']);

export const DEFAULTS = Object.freeze({ name: 'Privilege demo LAB', tagline: 'Policy on every tool call', vertical: 'generic', cast: {}, vocabulary: {} });

const hasMarkup = (text) => /[<>]/.test(text) || /\{\{|\}\}/.test(text);
// C0 controls and DEL, C1 controls, and Unicode format characters (bidi overrides, zero-width), which can make shown text differ from what it says.
// eslint-disable-next-line no-control-regex
const hasControl = (text) => /[\u0000-\u001f\u007f-\u009f\p{Cf}]/u.test(text);

function plainText(value, max) {
  if (typeof value !== 'string') return { error: 'must be a string' };
  const text = value.trim();
  if (!text) return { error: 'must not be empty' };
  if (text.length > max) return { error: `is longer than ${max} characters` };
  if (hasMarkup(text) || hasControl(text)) return { error: 'must be plain text (no < > {{ }} or control characters)' };
  return { text };
}
const safeKey = (k) => String(k).slice(0, 40).replace(/[^\w.-]/g, '?');

export function validateConfig(input) {
  const warnings = [];
  const out = { ...DEFAULTS, cast: {}, vocabulary: {} };
  const warn = (field, why) => warnings.push(`${field}: ${why}; the default is used`);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { config: out, warnings: ['config: must be a JSON object; the defaults are used'] };
  for (const key of Object.keys(input)) if (!TOP_KEYS.has(key)) warnings.push(`${safeKey(key)}: unknown key ignored`);
  for (const [field, max] of [['name', LIMITS.name], ['tagline', LIMITS.tagline]]) {
    if (!Object.hasOwn(input, field)) continue;
    const r = plainText(input[field], max);
    if (r.error) warn(field, r.error); else out[field] = r.text;
  }
  if (Object.hasOwn(input, 'vertical')) {
    if (VERTICALS.includes(input.vertical)) out.vertical = input.vertical;
    else warn('vertical', `must be one of ${VERTICALS.join(', ')}`);
  }
  for (const [field, keys, max] of [['cast', CAST_KEYS, LIMITS.cast], ['vocabulary', VOCAB_KEYS, LIMITS.vocab]]) {
    if (!Object.hasOwn(input, field)) continue;
    const obj = input[field];
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) { warn(field, 'must be an object'); continue; }
    for (const [key, value] of Object.entries(obj)) {
      if (!keys.includes(key)) { warnings.push(`${field}.${safeKey(key)}: unknown key ignored`); continue; }
      const r = plainText(value, max);
      if (r.error) warn(`${field}.${key}`, r.error); else out[field][key] = r.text;
    }
  }
  return { config: out, warnings };
}

// A missing file is normal (defaults); an unreadable or oversize one is reported.
export function loadCustomerConfig({ file, env = process.env } = {}) {
  const target = file ?? (env.CUSTOMER_CONFIG ? path.resolve(env.CUSTOMER_CONFIG) : DEFAULT_CONFIG_PATH);
  let text;
  try {
    const stat = fs.statSync(target);
    if (stat.size > MAX_FILE_BYTES) return { ...validateConfig(null), warnings: [`config file is larger than ${MAX_FILE_BYTES} bytes; the defaults are used`] };
    text = fs.readFileSync(target, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' && !env.CUSTOMER_CONFIG) return { config: validateConfig({}).config, warnings: [] };
    return { ...validateConfig(null), warnings: ['config file could not be read; the defaults are used'] };
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ...validateConfig(null), warnings: ['config file is not valid JSON; the defaults are used'] }; }
  return validateConfig(parsed);
}

// The safe subset exposed through the config route.
export const publicConfig = ({ config, warnings }) => ({
  name: config.name, tagline: config.tagline, vertical: config.vertical, cast: config.cast, vocabulary: config.vocabulary, warnings,
});
