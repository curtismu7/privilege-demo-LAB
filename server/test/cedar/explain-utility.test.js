// The same explanation checks for the utility pack (invented groups, mock backends). Runs behind the no-network guard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeWorld, person, withAgent } from './explain-helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLD = path.join(here, 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const U = makeWorld('utility');
const D = U.pack.web.argDefaults;
const agent = (c) => withAgent(c, 'delivery-agent');
const P = Object.fromEntries(Object.entries(U.pack.personas).filter(([, p]) => !p.admin).map(([id, p]) => [id, { ...p.claims }]));
const rule = (e, id) => e.rules.find((r) => r.id === id);

const VARIANTS = (tool) => {
  const a = D[tool];
  if (tool.startsWith('github.') && a.repo) return ['grid-ops-portal', 'outage-notifier', 'meter-data-lake'].map((repo) => ({ ...a, repo }));
  if (tool === 'kb.search') return ['runbooks', 'audit-evidence'].map((collection) => ({ ...a, collection }));
  if (tool === 'cloudwatch.query_logs') return ['portal-app', 'security-events'].map((logGroup) => ({ ...a, logGroup }));
  return [a];
};

describe('utility pack: the explanation agrees with Cedar', () => {
  it('every persona x tool x repo/collection x agent x approvals x drift: agreed, PEP outcome, one-rule oracle', { timeout: 600000 }, () => {
    let n = 0;
    for (const [pid, claims] of Object.entries(P)) {
      for (const tool of U.be.names()) {
        for (const args of VARIANTS(tool)) {
          for (const withA of [false, true]) {
            for (const approvalCount of [0, 1]) {
              for (const drift of approvalCount === 0 ? [false, true] : [false]) {
                const c = withA ? agent(claims) : claims;
                const over = { approvalCount, drift };
                const e = U.explain(c, tool, args, over);
                const label = JSON.stringify({ pid, tool, args, withA, approvalCount, drift });
                expect(e.checks.agreed, label).toBe(true);
                expect(e.outcome, label).toBe(U.pepOutcome(c, tool, args, over));
                for (const r of (approvalCount === 0 && !drift ? e.rules : [])) { // the one-rule oracle costs a decide() per rule: base case only
                  const applied = ['allowed', 'overridden', 'blocked', 'held', 'hold-moot'].includes(r.status);
                  expect(applied, `${label} ${r.id}`).toBe(U.appliedAlone(r.id, c, tool, args, over));
                }
                n += 1;
              }
            }
          }
        }
      }
    }
    expect(n).toBeGreaterThan(500);
  });
});

describe('utility pack: the rules read the way the owner reads them', () => {
  it('meanings of the shipped rules', () => {
    const meaning = (id) => U.ex.meaning({ id, state: 'active', text: U.ps.staticPolicies[id] });
    const all = Object.fromEntries(Object.keys(U.ps.staticPolicies).map((id) => [id, meaning(id).does]));
    const file = path.join(GOLD, 'meanings-utility.json');
    if (UPDATE) fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
    expect(all).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(all['u22-never-deploy']).toBe('Blocks calls (attended or unattended) to any tool when the tool name starts with “deploy.”.');
    expect(all['u30-hold-story-update']).toBe('Holds calls (attended or unattended) to the backlog.update_story tool, until Priya approves. It stops applying once someone has approved the call.');
    expect(all['u40-repo-scope-engineers']).toBe('Blocks calls (attended or unattended) from people in the engineers group to any tool when the call names a repository, unless the repository is one of grid-ops-portal, outage-notifier.');
    expect(all['u41-restricted-evidence-compliance-only']).toBe('Blocks calls (attended or unattended) to any tool when the data is classified restricted, unless the person is in the compliance group.');
    expect(Object.values(all).every((d) => !d.startsWith('Explained from') && !d.startsWith('This rule could not'))).toBe(true);
  });
  it('u30: Ben\'s agent updating a story is held for Priya, and the card says where', () => {
    const e = U.explain(agent(P.ben), 'backlog.update_story', D['backlog.update_story']);
    expect(e).toMatchObject({ kind: 'held', outcome: 'hold', headline: 'Held. Priya must approve this before backlog.update_story runs.' });
    expect(rule(e, 'u30-hold-story-update')).toMatchObject({ status: 'held', deciding: true });
    expect(rule(e, 'u13-analysts-backlog').status).toBe('overridden');
    expect(e.approval).toMatchObject({ where: '/approvals', approvalWouldAllow: true, approvers: [{ sub: 'priya', name: 'Priya' }] });
  });
  it('u31: Priya asking for a requirement update is told she cannot approve her own request', () => {
    const e = U.explain(agent(P.priya), 'confluence.update_requirement', D['confluence.update_requirement']);
    expect(e.kind).toBe('held');
    expect(e.approval.text).toContain('Priya cannot approve their own request, so another approver or an admin must.');
    expect(e.approval.requesterMayApprove).toBe(false);
  });
  it('u40: an engineer reading another team\'s repo is blocked, and the card says which repos would pass', () => {
    const e = U.explain(P.eli, 'github.read_pr', { repo: 'meter-data-lake', pr: 7 });
    expect(e.kind).toBe('blocked');
    expect(e.decidedBy.id).toBe('u40-repo-scope-engineers');
    expect(rule(e, 'u40-repo-scope-engineers').because).toEqual(['Eli is in the engineers group', 'the call names a repository', 'the repository meter-data-lake is not one of grid-ops-portal, outage-notifier']);
    expect(e.asked.details).toEqual([{ label: 'repository', value: 'meter-data-lake' }, { label: 'data classification', value: 'internal' }]);
    expect(e.change.text).toContain('the repository were one of grid-ops-portal, outage-notifier');
    expect(rule(e, 'u10-engineers-pr-review').status).toBe('overridden');
  });
  it('u41: restricted evidence is blocked for engineers and allowed for compliance, with the exception named', () => {
    const args = { query: 'x', collection: 'audit-evidence' };
    const eli = U.explain(P.eli, 'kb.search', args);
    expect(eli.decidedBy.id).toBe('u41-restricted-evidence-compliance-only');
    expect(eli.asked.details).toEqual([{ label: 'data classification', value: 'restricted' }]);
    expect(eli.change.text).toContain('Eli were in the compliance group');
    expect(eli.rules.find((r) => r.id === 'u41-restricted-evidence-compliance-only').because).toEqual(['the data is classified restricted', 'Eli is not in the compliance group']);
    const cora = U.explain(P.cora, 'kb.search', args);
    expect(cora.kind).toBe('allowed');
    expect(rule(cora, 'u41-restricted-evidence-compliance-only').because.join(' ')).toContain('Cora is in the compliance group, which is an exception to this rule');
  });
  it('u40 and u41: every condition is put in words, so the card never says some could not be', () => {
    for (const e of [U.explain(P.eli, 'github.read_pr', { repo: 'meter-data-lake', pr: 7 }), U.explain(P.eli, 'kb.search', { query: 'x', collection: 'audit-evidence' })]) {
      expect(e.kind).toBe('blocked');
      expect(e.change.complete).toBe(true);
      expect(e.change.text).not.toContain('could not be put in words');
    }
  });
  it('u22, u20, u21: no approver is named, so an approval cannot lift them; the deploy pattern is explained', () => {
    const dep = U.explain(agent(P.gwen), 'deploy.production', D['deploy.production'], { approvalCount: 1 });
    expect(dep.kind).toBe('blocked');
    expect(dep.decidedBy.id).toBe('u22-never-deploy');
    expect(dep.change.text).toMatch(/No approver is named for “[^”]+” \(u22-never-deploy\), so an approval cannot lift it\./);
    expect(rule(dep, 'u20-never-merge-or-approve-pr')).toMatchObject({ status: 'not-about-tool', because: ['this rule is about the github.merge_pr and github.approve_pr tools, not deploy.production'] });
    const mer = U.explain(P.eli, 'github.merge_pr', D['github.merge_pr']);
    expect(mer.decidedBy.id).toBe('u20-never-merge-or-approve-pr');
    expect(U.explain(P.eli, 'policy.change', D['policy.change']).decidedBy.id).toBe('u21-never-change-policy');
  });
  it('a condition Cedar never reached is not reported as an exception (no repository, so u40 says so and stops)', () => {
    const e = U.explain(agent(P.eli), 'deploy.production', D['deploy.production']);
    expect(rule(e, 'u40-repo-scope-engineers').because).toEqual(['the call names no repository']);
  });
  it('the agent\'s name is the pack\'s agent, in words', () => {
    const e = U.explain(agent(P.eli), 'kb.search', D['kb.search']);
    expect(e.who.agent).toEqual({ sub: 'delivery-agent', name: 'Delivery Agent' });
    expect(e.asked.attendedText).toBe('unattended: Delivery Agent made the call for Eli (the token carries an agent)');
  });
});

describe('utility pack: "what would change the answer" is checked, not guessed', () => {
  it('a non-engineer asking for a pull request in a repo outside the engineers\' repos is not told the engineers rule would allow it', () => {
    const args = { ...D['github.read_pr'], repo: 'meter-data-lake' };
    const e = U.explain(P.ben, 'github.read_pr', args);
    expect(e.kind).toBe('default-deny');
    expect(e.change.text).not.toContain('(u10-engineers-pr-review) would allow it');
    expect(e.change.text).toMatch(/\(u10-engineers-pr-review\) would cover it if Ben were in the engineers group, but the call would still be denied by/);
    // the claim checked independently: with that group the request is still denied
    expect(U.pepOutcome({ ...P.ben, groups: [...P.ben.groups, 'engineers'] }, 'github.read_pr', args)).toBe('deny');
  });
  it('where the engineers rule really would allow it, it says so', () => {
    const args = { ...D['github.read_pr'], repo: 'grid-ops-portal' };
    const e = U.explain(P.ben, 'github.read_pr', args);
    expect(e.kind).toBe('default-deny');
    expect(U.pepOutcome({ ...P.ben, groups: [...P.ben.groups, 'engineers'] }, 'github.read_pr', args)).toBe('allow');
    expect(e.change.text).toContain('(u10-engineers-pr-review) would allow it if Ben were in the engineers group');
  });
});

describe('utility pack: a request made by the approver does not name her as the approver', () => {
  it('u31: the headline and the change line name an admin, not Priya', () => {
    const e = U.explain(agent(P.priya), 'confluence.update_requirement', D['confluence.update_requirement']);
    expect(e.headline).toBe('Held. An admin must approve this before confluence.update_requirement runs.');
    expect(e.change.text).toBe('An admin approves it on the Approvals page.');
  });
});
