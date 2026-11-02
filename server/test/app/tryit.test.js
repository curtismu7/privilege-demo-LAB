// Try this: every button's printed expectation is checked against what the real app answers, for both packs, so a label can never lie.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERSONAS } from '../../src/auth/personas.js';
import { argProblems, createBackend } from '../../src/mcp/backend.js';
import { getPack } from '../../src/packs/index.js';
import { makeClaims, TEST_USERS } from '../../../web/src/claims.js';
import { examplesFor } from '../../../web/src/policyExamples.js';
import { mockApp, signedIn } from './helpers.js';

const webFile = (rel) => fileURLToPath(new URL(`../../../web/src/${rel}`, import.meta.url));
const json = (rel) => JSON.parse(fs.readFileSync(webFile(rel), 'utf8'));
const GENERIC = json('data/tryThis.generic.json');
const UTILITY = getPack('utility').web.tryThis;
const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;
const tokens = (s) => [...JSON.stringify(s).matchAll(TOKEN)].map((m) => m[1]);

// Every mismatch between what a scenario prints and what the app answers. [] means the label tells the truth.
async function mismatches(ctx, agents, s, pack) {
  const bad = [];
  const want = s.expect;
  if (s.exampleOnly) {
    const users = pack.id === 'generic' ? TEST_USERS : pack.web.testUsers;
    const u = users.find((x) => x.id === (s.testUser ?? s.as));
    const claims = makeClaims({ sub: u.id, groups: u.groups, paymentsWrite: u.paymentsWrite === true, dot: s.agent === true, agent: pack.agent.sub });
    const r = (await Object.values(agents)[0].post('/api/decide-test').send({ claims, tool: s.tool, args: s.args, approvalCount: s.approvalCount ?? 0, drift: s.drift === true, explain: true })).body;
    if (r.explanation.outcome !== want.outcome) bad.push(`outcome ${r.explanation.outcome} != ${want.outcome}`);
    if (r.explanation.decidedBy.id !== want.rule) bad.push(`rule ${r.explanation.decidedBy.id} != ${want.rule}`);
    return bad;
  }
  const r = (await agents[s.as].post('/api/tools/call?envelope=1').send({ tool: s.tool, args: s.args, ...(s.agent ? { asAgent: true } : {}) })).body;
  if (r.outcome !== want.outcome) bad.push(`outcome ${r.outcome} != ${want.outcome}`);
  if (r.rule !== want.rule) bad.push(`rule ${r.rule} != ${want.rule}`);
  if (want.approvers && JSON.stringify(r.approvers) !== JSON.stringify(want.approvers)) bad.push(`approvers ${r.approvers} != ${want.approvers}`);
  if (r.explanation.outcome !== r.outcome) bad.push('explanation.outcome differs from outcome');
  if (r.explanation.decidedBy.id !== want.rule) bad.push(`explanation names ${r.explanation.decidedBy.id}, not ${want.rule}`);
  void ctx;
  return bad;
}

const WORDS = { allow: /\ballowed\b/i, deny: /\b(denied|blocked)\b/i, hold: /\bheld\b/i };

describe.each([
  ['generic', GENERIC, () => mockApp(), ['mark', 'mary'], () => json('data/verticals/generic.json')],
  ['utility', UTILITY, () => mockApp({ pack: 'utility' }), ['eli', 'gwen', 'ben', 'cora'], () => json('data/packs/utility/vertical.json')],
])('Try this: %s pack', (name, list, makeCtx, personas, vertical) => {
  const pack = getPack(name);
  const backend = createBackend({ tools: pack.tools });
  async function world() {
    const ctx = makeCtx();
    const agents = {};
    for (const p of personas) agents[p] = await signedIn(ctx, p);
    return { ctx, agents };
  }

  it('is a non-empty list of scenarios with an id, label, persona, tool, arguments and an expectation', () => {
    expect(list.length).toBeGreaterThanOrEqual(name === 'generic' ? 5 : 12);
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
    for (const s of list) {
      expect(s).toMatchObject({ id: expect.any(String), label: expect.any(String), as: expect.any(String), tool: expect.any(String), note: expect.any(String), expect: { outcome: expect.stringMatching(/^(allow|deny|hold)$/), rule: expect.any(String) } });
    }
  });

  it('every printed expectation equals the real outcome, deciding rule, approver and explanation', { timeout: 300000 }, async () => {
    const { ctx, agents } = await world();
    for (const s of list) expect(await mismatches(ctx, agents, s, pack), s.id).toEqual([]);
  });

  it('the checker itself can fail: a deliberately wrong expectation is reported', async () => {
    const { ctx, agents } = await world();
    const s = list.find((x) => !x.exampleOnly);
    const other = s.expect.outcome === 'deny' ? 'allow' : 'deny';
    expect((await mismatches(ctx, agents, { ...s, expect: { ...s.expect, outcome: other } }, pack)).length).toBeGreaterThan(0);
    expect((await mismatches(ctx, agents, { ...s, expect: { ...s.expect, rule: 'not-a-rule' } }, pack)).length).toBeGreaterThan(0);
    const ex = list.find((x) => x.exampleOnly);
    expect((await mismatches(ctx, agents, { ...ex, expect: { ...ex.expect, rule: 'not-a-rule' } }, pack)).length).toBeGreaterThan(0);
  });

  it('lint: the words in each note agree with the outcome, tokens are defined, tools and arguments are valid, no claim jargon', () => {
    const v = vertical();
    for (const s of list) {
      for (const [outcome, re] of Object.entries(WORDS)) if (re.test(s.note)) expect(outcome, `${s.id}: "${s.note}"`).toBe(s.expect.outcome);
      for (const t of tokens(s)) {
        const defined = t.startsWith('vocab.') ? v.vocab?.[t.slice(6)] : v.cast?.[t]?.name;
        expect(defined, `${s.id} uses {{${t}}}`).toBeTruthy();
      }
      const def = backend.tool(s.tool);
      expect(def, `${s.id}: tool ${s.tool}`).toBeTruthy();
      expect(argProblems(def.inputSchema, s.args), s.id).toEqual([]);
      expect(JSON.stringify(s), s.id).not.toMatch(/claims|client_id|\bPEP\b|Cedar/);
      if (s.expect.outcome === 'hold') expect(s.expect.approvers?.length, s.id).toBeGreaterThan(0);
    }
    if (name === 'generic') {
      for (const verticalFile of fs.readdirSync(webFile('data/verticals'))) {
        const alt = json(`data/verticals/${verticalFile}`);
        for (const t of new Set(list.flatMap(tokens))) expect(alt.cast?.[t]?.name, `${verticalFile} lacks {{${t}}}`).toBeTruthy();
      }
    }
  });

  it('every shipped policy has at least one example computed from real Test a request answers', { timeout: 300000 }, async () => {
    const { agents } = await world();
    const users = name === 'generic' ? TEST_USERS : pack.web.testUsers;
    const pool = [];
    for (const s of list) {
      const u = users.find((x) => x.id === (s.testUser ?? s.as));
      const claims = makeClaims({ sub: u.id, groups: u.groups, paymentsWrite: u.paymentsWrite === true, dot: s.agent === true, agent: pack.agent.sub });
      const r = (await Object.values(agents)[0].post('/api/decide-test').send({ claims, tool: s.tool, args: s.args, approvalCount: s.approvalCount ?? 0, drift: s.drift === true })).body;
      pool.push({ label: s.label, outcome: r.outcome, rule: r.rule, overridden: r.overridden });
    }
    for (const id of Object.keys(pack.shippedPolicies())) expect(examplesFor(id, pool).length, `no example for ${id}`).toBeGreaterThan(0);
  });
});

describe('Try this: the generic story the notes tell', () => {
  it('nobody who can sign in is in the finance group, which the pay-invoice note relies on', () => {
    for (const p of Object.values(PERSONAS)) expect(p.claims.groups).not.toContain('finance');
  });
});
