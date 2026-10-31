// The utility / NERC CIP-style pack, decided by its own twelve-plus policies. Group names are INVENTED. Every backend is a mock.
// Expectations are written out by hand from docs/group-to-tool-mapping.md (utility section), not computed from the policies.
// The last describe is a mutation check: weaken or delete one policy and some row of the table must change.
import { describe, it, expect } from 'vitest';
import { init, decide, validatePolicies } from '../../src/cedar/index.js';
import { getPack } from '../../src/packs/index.js';
import { createBackend } from '../../src/mcp/backend.js';

init();
const pack = getPack('utility');
const backend = createBackend({ tools: pack.tools });
const compile = (policies) => {
  const v = validatePolicies(policies, { schema: pack.schema });
  if (!v.ok) throw new Error(`utility policies invalid: ${JSON.stringify(v.problems)}`);
  return v.policySet;
};
const shipped = pack.shippedPolicies();
const policySet = compile(shipped);

const claim = (sub, groups, act) => ({ sub, groups, scope: 'tools:invoke', client_id: 'privilege-demo-web', ...(act ? { act: { sub: act } } : {}) });
const WHO = {
  eng: claim('eli', ['engineers']), gov: claim('gwen', ['governance-reviewers']), ba: claim('ben', ['business-analysts']), comp: claim('cora', ['compliance']),
  admin: claim('dana', ['admins']), nobody: claim('nina', []),
};
const AGENT = 'delivery-agent';

const ask = (who, tool, args, { ps = policySet, approvalCount = 0, drift = false, agent = false } = {}) => {
  const claims = agent ? { ...WHO[who], act: { sub: AGENT } } : WHO[who];
  const d = decide({ policySet: ps, claims, toolCall: { tool, app: backend.tool(tool)?.app ?? 'unknown', action: agent ? 'mcp:InvokeUnattended' : 'mcp:Invoke', args: {}, approvalCount,
    pinnedHash: 'h', observedHash: drift ? 'changed' : 'h', resource: backend.resourceAttrs(tool, args) } });
  return d;
};
// "hold" = a forbid that names approvers fired and no final forbid did.
const outcome = (d, ps = policySet) => {
  if (d.decision === 'allow') return 'allow';
  const approvable = (id) => String(ps.annotations[id]?.approvers ?? '').trim() !== '';
  return d.rules.length && d.rules.every(approvable) ? 'hold' : 'deny';
};

const OPS = { repo: 'grid-ops-portal', pr: 42 };
const OTHER = { repo: 'meter-data-lake', pr: 7 };
const READ = ['github.read_pr', OPS];
const COMMENT = ['github.post_review_comment', { ...OPS, body: 'nit' }];
const KB = ['kb.search', { query: 'q', collection: 'runbooks' }];
const KB_RESTRICTED = ['kb.search', { query: 'q', collection: 'audit-evidence' }];
const LOGS = ['cloudwatch.query_logs', { logGroup: 'portal-app', query: 'x' }];
const LOGS_RESTRICTED = ['cloudwatch.query_logs', { logGroup: 'security-events', query: 'x' }];
const DRAFT = ['backlog.create_story_draft', { title: 't' }];
const UPDATE = ['backlog.update_story', { storyId: 'ST-1', change: 'c' }];
const REQ = ['confluence.update_requirement', { requirementId: 'REQ-1', change: 'c' }];

const D = 'default-deny';
// [who, [tool, args], extras, outcome, deciding rule]
const TABLE = [
  // ALLOW
  ['eng', READ, {}, 'allow', 'u10-engineers-pr-review'],
  ['eng', COMMENT, {}, 'allow', 'u10-engineers-pr-review'],
  ['eng', KB, {}, 'allow', 'u11-engineers-research'],
  ['eng', LOGS, {}, 'allow', 'u11-engineers-research'],
  ['gov', READ, {}, 'allow', 'u12-governance-review'],
  ['gov', ['github.read_pr', OTHER], {}, 'allow', 'u12-governance-review'], // governance is not repo-scoped
  ['gov', COMMENT, {}, 'allow', 'u12-governance-review'],
  ['gov', KB, {}, 'allow', 'u12-governance-review'],
  ['ba', KB, {}, 'allow', 'u13-analysts-backlog'],
  ['ba', DRAFT, {}, 'allow', 'u13-analysts-backlog'],
  ['comp', READ, {}, 'allow', 'u14-compliance-evidence'],
  ['comp', KB, {}, 'allow', 'u14-compliance-evidence'],
  ['comp', LOGS, {}, 'allow', 'u14-compliance-evidence'],
  // agent acting for the user changes nothing for the allow list
  ['eng', READ, { agent: true }, 'allow', 'u10-engineers-pr-review'],
  // not in the group: default deny
  ['ba', READ, {}, 'deny', D],
  ['ba', COMMENT, {}, 'deny', D],
  ['ba', LOGS, {}, 'deny', D],
  ['eng', DRAFT, {}, 'deny', D],
  ['gov', LOGS, {}, 'deny', D],
  ['gov', DRAFT, {}, 'deny', D],
  ['comp', COMMENT, {}, 'deny', D], // compliance reads; it does not comment
  ['comp', DRAFT, {}, 'deny', D],
  ['admin', READ, {}, 'deny', D],
  ['nobody', KB, {}, 'deny', D],
  // HOLD for approval, then allow after one approval
  ['ba', UPDATE, {}, 'hold', 'u30-hold-story-update'],
  ['ba', UPDATE, { agent: true }, 'hold', 'u30-hold-story-update'],
  ['ba', UPDATE, { approvalCount: 1 }, 'allow', 'u13-analysts-backlog'],
  ['ba', REQ, {}, 'hold', 'u31-hold-requirement-update'],
  ['ba', REQ, { approvalCount: 1 }, 'allow', 'u13-analysts-backlog'],
  ['gov', REQ, {}, 'hold', 'u31-hold-requirement-update'],
  ['gov', REQ, { approvalCount: 1 }, 'allow', 'u12-governance-review'],
  // a hold is only real if an approval could end in allow: no permit, so the forbid's hold is a plain deny after the re-check (pep.js)
  ['eng', UPDATE, { approvalCount: 1 }, 'deny', D],
  ['eng', REQ, { approvalCount: 1 }, 'deny', D],
  // DENY always, no approval overrides
  ...['eng', 'gov', 'ba', 'comp', 'admin'].flatMap((w) => [
    [w, ['github.merge_pr', OPS], {}, 'deny', 'u20-never-merge-or-approve-pr'],
    [w, ['github.merge_pr', OPS], { approvalCount: 1 }, 'deny', 'u20-never-merge-or-approve-pr'],
    [w, ['github.approve_pr', OPS], { approvalCount: 3, agent: true }, 'deny', 'u20-never-merge-or-approve-pr'],
    [w, ['policy.change', { policyId: 'p', change: 'c' }], { approvalCount: 1 }, 'deny', 'u21-never-change-policy'],
    [w, ['deploy.staging', { service: 's' }], { approvalCount: 1 }, 'deny', 'u22-never-deploy'],
    [w, ['deploy.production', { service: 's' }], { approvalCount: 1 }, 'deny', 'u22-never-deploy'],
    [w, ['deploy.rollback', { service: 's' }], { approvalCount: 1, agent: true }, 'deny', 'u22-never-deploy'],
  ]),
  // restricted evidence: compliance only (classification, not the tool, decides)
  ['eng', KB_RESTRICTED, {}, 'deny', 'u41-restricted-evidence-compliance-only'],
  ['gov', KB_RESTRICTED, {}, 'deny', 'u41-restricted-evidence-compliance-only'],
  ['ba', KB_RESTRICTED, {}, 'deny', 'u41-restricted-evidence-compliance-only'],
  ['eng', KB_RESTRICTED, { approvalCount: 1 }, 'deny', 'u41-restricted-evidence-compliance-only'],
  ['eng', LOGS_RESTRICTED, {}, 'deny', 'u41-restricted-evidence-compliance-only'],
  ['comp', KB_RESTRICTED, {}, 'allow', 'u14-compliance-evidence'],
  ['comp', LOGS_RESTRICTED, {}, 'allow', 'u14-compliance-evidence'],
  ['comp', KB_RESTRICTED, { agent: true }, 'allow', 'u14-compliance-evidence'],
  // per-repo scoping for engineers; read-only by default (no merge, no approve above)
  ['eng', ['github.read_pr', OTHER], {}, 'deny', 'u40-repo-scope-engineers'],
  ['eng', ['github.post_review_comment', { ...OTHER, body: 'x' }], {}, 'deny', 'u40-repo-scope-engineers'],
  ['eng', ['github.read_pr', OTHER], { approvalCount: 1 }, 'deny', 'u40-repo-scope-engineers'],
  ['eng', ['github.read_pr', { repo: 'outage-notifier', pr: 1 }], {}, 'allow', 'u10-engineers-pr-review'],
  ['comp', ['github.read_pr', OTHER], {}, 'allow', 'u14-compliance-evidence'],
  // the rug-pull pin still applies to every pack tool
  ['eng', READ, { drift: true }, 'deny', 's05-rugpull-pin'],
  ['comp', KB_RESTRICTED, { drift: true }, 'deny', 's05-rugpull-pin'],
];

const run = ([who, [tool, args], extra]) => ask(who, tool, args, extra);

describe('utility pack decision table', () => {
  it.each(TABLE.map((r, i) => [`${i} ${r[0]} ${r[1][0]} ${JSON.stringify(r[2])}`, r]))('%s', (_n, row) => {
    const d = run(row);
    expect([outcome(d), d.rule]).toEqual([row[3], row[4]]);
  });

  it('a hold names priya as the approver, and nothing else', () => {
    expect(policySet.annotations['u30-hold-story-update'].approvers).toBe('priya');
    expect(policySet.annotations['u31-hold-requirement-update'].approvers).toBe('priya');
    const withApprovers = Object.keys(policySet.annotations).filter((id) => policySet.annotations[id].approvers);
    expect(withApprovers.sort()).toEqual(['u30-hold-story-update', 'u31-hold-requirement-update']);
  });

  it('every deny-always policy is a forbid with no approvers (so no approval can override it)', () => {
    for (const id of ['u20-never-merge-or-approve-pr', 'u21-never-change-policy', 'u22-never-deploy', 'u40-repo-scope-engineers', 'u41-restricted-evidence-compliance-only', 's05-rugpull-pin']) {
      expect(policySet.effects[id], id).toBe('forbid');
      expect(policySet.annotations[id].approvers, id).toBeUndefined();
    }
  });

  it('every policy has an @reason and the invented-groups note', () => {
    for (const [id, text] of Object.entries(shipped)) {
      expect(policySet.annotations[id].reason, id).toBeTruthy();
      if (id.startsWith('u')) expect(text, id).toMatch(/INVENTED/);
    }
  });

  it('forbid beats permit: the overridden permit is reported', () => {
    expect(ask('eng', 'github.read_pr', OTHER).overridden).toEqual(['u10-engineers-pr-review']);
    expect(ask('comp', 'github.read_pr', OPS).overridden).toEqual([]);
  });

  it('the deploy rule is a pattern: a deploy.* tool the pack does not list is still denied (and a lookalike is not)', () => {
    const unknown = decide({ policySet, claims: WHO.gov, toolCall: { tool: 'deploy.canary', app: 'deploy', args: {}, pinnedHash: 'h', observedHash: 'h', approvalCount: 2,
      resource: { toolName: 'deploy.canary', classification: 'internal' } } });
    expect([unknown.decision, unknown.rule]).toEqual(['deny', 'u22-never-deploy']);
    const lookalike = decide({ policySet, claims: WHO.gov, toolCall: { tool: 'redeploy.x', app: 'deploy', args: {}, pinnedHash: 'h', observedHash: 'h',
      resource: { toolName: 'redeploy.x', classification: 'internal' } } });
    expect(lookalike.rule).toBe('default-deny');
  });

  it('classification comes from the server catalog: an unknown collection or log group is treated as restricted', () => {
    expect(backend.resourceAttrs('kb.search', { query: 'q', collection: 'nope' }).classification).toBe('restricted');
    expect(backend.resourceAttrs('cloudwatch.query_logs', { logGroup: 'nope', query: 'q' }).classification).toBe('restricted');
    expect(backend.resourceAttrs('kb.search', null).classification).toBe('restricted');
    expect(backend.resourceAttrs('kb.search', { query: 'q', collection: 'runbooks', classification: 'public' }).classification).toBe('internal'); // a caller cannot label its own request
  });

  it('the same policy set is a schema error against the generic schema (the packs are not interchangeable)', () => {
    expect(validatePolicies(shipped).ok).toBe(false);
  });
});

describe('every pack scenario shown on screen is true', () => {
  const { scenarios } = pack.web;
  it('has scenarios for allow, hold, deny-no-override, restricted evidence and repo scoping', () => {
    expect(scenarios.map((s) => s.id)).toEqual(expect.arrayContaining(['pr-comment', 'cross-repo', 'story-hold', 'story-held-approved', 'merge-no-override', 'deploy-no-override', 'evidence-denied', 'evidence-compliance']));
  });
  it.each(scenarios.map((s) => [s.id, s]))('%s', (_id, s) => {
    const claims = { sub: s.sub, groups: s.groups, scope: 'tools:invoke', client_id: 'privilege-demo-web', ...(s.agent ? { act: { sub: AGENT } } : {}) };
    const d = decide({ policySet, claims, toolCall: { tool: s.tool, app: backend.tool(s.tool).app, action: s.agent ? 'mcp:InvokeUnattended' : 'mcp:Invoke', args: {}, approvalCount: s.approvalCount ?? 0,
      pinnedHash: 'h', observedHash: 'h', resource: backend.resourceAttrs(s.tool, s.args) } });
    expect([outcome(d), d.rule]).toEqual([s.expect.outcome, s.expect.rule]);
  });
});

describe('mutation check: each policy is load-bearing, and weakening it changes a decision', () => {
  const baseline = TABLE.map((r) => [outcome(run(r)), run(r).rule]);
  const withPolicies = (policies) => compile(policies);
  const changedRows = (ps) => TABLE.filter((r, i) => {
    const d = ask(r[0], r[1][0], r[1][1], { ...r[2], ps });
    return outcome(d, ps) !== baseline[i][0] || d.rule !== baseline[i][1];
  });

  it.each(Object.keys(shipped).map((id) => [id]))('deleting %s changes at least one row', (id) => {
    const { [id]: _gone, ...rest } = shipped;
    // some policy sets stay valid without one policy; an empty set is not a case here
    expect(changedRows(withPolicies(rest)).length, `no row depends on ${id}`).toBeGreaterThan(0);
  });

  // [policy, text to find, replacement]: each is a plausible weakening or typo
  const MUTATIONS = [
    ['u40-repo-scope-engineers', '"outage-notifier"]', '"outage-notifier", "meter-data-lake"]'],
    ['u40-repo-scope-engineers', 'principal in Group::"engineers"', 'principal in Group::"compliance"'],
    ['u41-restricted-evidence-compliance-only', 'Group::"compliance"', 'Group::"governance-reviewers"'],
    ['u41-restricted-evidence-compliance-only', '== "restricted"', '== "secret"'],
    ['u22-never-deploy', 'like "deploy.*"', 'like "deploy.prod*"'],
    ['u22-never-deploy', 'like "deploy.*"', 'like "deploy"'],
    ['u20-never-merge-or-approve-pr', ', Tool::"github.approve_pr"', ''],
    ['u20-never-merge-or-approve-pr', 'Tool::"github.merge_pr", ', ''],
    ['u20-never-merge-or-approve-pr', 'action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"]', 'action == Action::"mcp:Invoke"'],
    ['u21-never-change-policy', 'Tool::"policy.change"', 'Tool::"policy.read"'],
    ['u30-hold-story-update', 'unless { context.approval_count >= 1 }', 'unless { context.approval_count >= 0 }'],
    ['u30-hold-story-update', '@approvers("priya")', '@approvers("")'],
    ['u30-hold-story-update', 'action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"]', 'action == Action::"mcp:InvokeUnattended"'],
    ['u31-hold-requirement-update', 'Tool::"confluence.update_requirement"', 'Tool::"confluence.read_requirement"'],
    ['u31-hold-requirement-update', 'unless { context.approval_count >= 1 }', 'unless { context.approval_count >= 5 }'],
    ['u10-engineers-pr-review', ', Tool::"github.post_review_comment"', ''],
    ['u11-engineers-research', 'Tool::"cloudwatch.query_logs"', 'Tool::"cloudwatch.write_logs"'],
    ['u12-governance-review', ', Tool::"confluence.update_requirement"', ''],
    ['u13-analysts-backlog', 'Tool::"backlog.update_story", ', ''],
    ['u14-compliance-evidence', ', Tool::"cloudwatch.query_logs"', ''],
    ['s05-rugpull-pin', 'context.pinnedHash != context.observedHash', 'context.pinnedHash == "x"'],
  ];
  it.each(MUTATIONS.map((m) => [`${m[0]}: ${m[1]} -> ${m[2] || '(removed)'}`, m]))('%s', (_n, [id, find, replace]) => {
    expect(shipped[id], `${id} no longer contains the text this mutation targets`).toContain(find);
    const mutated = { ...shipped, [id]: shipped[id].replace(find, replace) };
    expect(changedRows(withPolicies(mutated)).length, `no row notices this change to ${id}`).toBeGreaterThan(0);
  });
});

describe('forbid beats permit', () => {
  it('a permit added for github.merge_pr still loses to u20-never-merge-or-approve-pr', () => {
    const extra = { ...shipped, 'u12-governance-review': shipped['u12-governance-review'].replace('Tool::"github.read_pr"', 'Tool::"github.read_pr", Tool::"github.merge_pr"') };
    expect(extra['u12-governance-review']).toContain('github.merge_pr');
    const d = ask('gov', 'github.merge_pr', OPS, { ps: compile(extra), approvalCount: 1 });
    expect(d.decision).toBe('deny');
    expect(d.rules).toContain('u20-never-merge-or-approve-pr');
  });
});
