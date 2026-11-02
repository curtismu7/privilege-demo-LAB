// The plain-English explanation of a decision, checked against Cedar itself. Runs behind the no-network guard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { engine } from '../../src/cedar/engine.js';
import { validatePolicies } from '../../src/cedar/index.js';
import { MAX_CLAUSES } from '../../src/explain/decision.js';
import { BASE, makeWorld, person, withAgent } from './explain-helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLD = path.join(here, 'golden');
const FIXTURE = path.join(here, '../../../web/src/components/__tests__/fixtures/explanations.json');
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const fare = (amount) => ({ flightId: 'FL200', amount });
const rule = (e, id) => e.rules.find((r) => r.id === id);

const W = makeWorld('generic');
const mark = person('mark', ['travel-agents']);
const mary = person('mary', ['analysts']);
const dot = (c) => withAgent(c, 'dot');

describe('the explanation agrees with Cedar (agreement matrix)', () => {
  const groupSets = [[], ['analysts'], ['finance'], ['travel-agents'], ['finance', 'travel-agents']];
  const amounts = [undefined, 1000, 1001, 10000, 10001];
  const cases = [];
  for (const groups of groupSets) {
    for (const tool of ['search_flights', 'create_ticket', 'pay_invoice', 'book_fare']) {
      for (const agent of [false, true]) {
        for (const approvalCount of [0, 1]) {
          for (const drift of approvalCount === 0 ? [false, true] : [false]) {
            const hasAmount = tool === 'pay_invoice' || tool === 'book_fare';
            for (const amount of hasAmount ? amounts : [undefined]) {
              const base = tool === 'search_flights' ? { query: 'q' } : tool === 'create_ticket' ? { subject: 's' } : tool === 'pay_invoice' ? { invoiceId: 'i' } : { flightId: 'f' };
              const args = amount === undefined ? base : { ...base, amount };
              const claims = person('u1', groups, groups.includes('finance') ? { scope: 'tools:invoke payments:write' } : {});
              cases.push({ claims: agent ? dot(claims) : claims, tool, args, over: { approvalCount, drift } });
            }
          }
        }
      }
    }
  }

  it(`for ${cases.length} requests: checks.agreed, the outcome equals the PEP's, and every rule status equals a one-rule decide()`, { timeout: 600000 }, () => {
    for (const c of cases) {
      const e = W.explain(c.claims, c.tool, c.args, c.over);
      const label = JSON.stringify({ g: c.claims.groups, a: Boolean(c.claims.act), t: c.tool, args: c.args, ...c.over });
      expect(e.checks.agreed, label).toBe(true);
      expect(e.outcome, label).toBe(W.pepOutcome(c.claims, c.tool, c.args, c.over));
      for (const r of e.rules) {
        const applied = ['allowed', 'overridden', 'blocked', 'held', 'hold-moot'].includes(r.status);
        expect(applied, `${label} ${r.id}`).toBe(W.appliedAlone(r.id, c.claims, c.tool, c.args, c.over));
        if (r.status === 'not-applied' || r.status === 'not-about-tool') expect(r.because.length, `${label} ${r.id}`).toBeGreaterThan(0);
      }
      expect(e.rules.filter((r) => r.deciding).length, label).toBeLessThanOrEqual(1);
    }
  });
});

describe('did-not-apply reasons are true: change the input and the reason changes', () => {
  it('amount: 800 is not over 1000; 1001 is, and the rule holds', () => {
    const low = W.explain(dot(mark), 'book_fare', fare(800));
    expect(rule(low, 's01-hold-large-fare').because.join(' ')).toContain('the amount 800 is not over 1000');
    const high = W.explain(dot(mark), 'book_fare', fare(1001));
    expect(rule(high, 's01-hold-large-fare').status).toBe('held');
    expect(rule(high, 's01-hold-large-fare').because.join(' ')).toContain('the amount 1001 is over 1000');
  });
  it('group and scope: Mark is not in finance and lacks the scope; a finance token with the scope is allowed', () => {
    const no = W.explain(mark, 'pay_invoice', { invoiceId: 'i', amount: 250 });
    expect(rule(no, 's04-payments-finance-only').because).toEqual(['Mark is not in the finance group', 'the token does not have the payments:write scope']);
    const yes = W.explain(person('fin', ['finance'], { scope: 'tools:invoke payments:write' }), 'pay_invoice', { invoiceId: 'i', amount: 250 });
    expect(yes.kind).toBe('allowed');
    expect(rule(yes, 's04-payments-finance-only').status).toBe('allowed');
    const noScope = W.explain(person('fin', ['finance']), 'pay_invoice', { invoiceId: 'i', amount: 250 });
    expect(rule(noScope, 's04-payments-finance-only').because).toEqual(['the token does not have the payments:write scope']);
  });
  it('attended or unattended: s01 does not cover an attended call, and covers an agent call', () => {
    expect(rule(W.explain(mark, 'book_fare', fare(2400)), 's01-hold-large-fare').because[0]).toMatch(/only covers unattended calls/);
    expect(rule(W.explain(dot(mark), 'book_fare', fare(2400)), 's01-hold-large-fare').status).toBe('held');
  });
  it('the tool and the app: a rule about book_fare is "not about this tool" for pay_invoice and says why', () => {
    const e = W.explain(mark, 'pay_invoice', { invoiceId: 'i', amount: 1 });
    expect(rule(e, 's23-forbid-over-cap')).toMatchObject({ status: 'not-about-tool', because: ['this rule is about the book_fare tool, not pay_invoice'] });
    expect(rule(e, 's23-permit-travel-agents')).toMatchObject({ status: 'not-about-tool', because: ['this rule is about the booking app, not the payments app'] });
  });
  it('approvals so far change the hold rule: with one approval it no longer applies', () => {
    const e = W.explain(dot(mark), 'book_fare', fare(2400), { approvalCount: 1 });
    expect(e.kind).toBe('allowed');
    expect(rule(e, 's01-hold-large-fare').because.join(' ')).toContain('someone has approved this call, which is an exception to this rule');
  });
});

describe('golden explanations (wording is the spec)', () => {
  const CASES = {
    'A-allow': () => W.explain(mark, 'book_fare', fare(800)),
    'B-default-deny': () => W.explain(mark, 'pay_invoice', { invoiceId: 'INV-1001', amount: 250 }),
    'C-block-overrides-allow': () => W.explain(mark, 'book_fare', fare(12000)),
    'D-hold': () => W.explain(dot(mark), 'book_fare', fare(2400)),
    'D2-hold-no-way-through': () => W.explain(dot(mary), 'book_fare', fare(2400)),
    'E-schema-pin': () => W.explain(mark, 'book_fare', fare(500), { drift: true }),
    'F-before-rules': () => W.ex.forBefore({ code: 'unknown-tool', claims: mark, tool: 'nope', source: 'session' }),
  };
  const MEANINGS = ['s23-permit-travel-agents', 's04-payments-finance-only', 's04-analysts-search-ticketing', 's01-hold-large-fare', 's23-forbid-over-cap', 's05-rugpull-pin']
    .map((id) => [id, W.ex.meaning({ id, state: 'active', text: W.ps.staticPolicies[id] }).does]);

  function check(name, value) {
    const file = path.join(GOLD, `${name}.json`);
    if (UPDATE) fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    expect(value).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  for (const [name, make] of Object.entries(CASES)) it(`explanation ${name}`, () => check(`explanation-${name}`, make()));
  it('policy meanings (generic)', () => check('meanings-generic', Object.fromEntries(MEANINGS)));
  it('the shipped meanings read the way the owner reads them', () => {
    const m = Object.fromEntries(MEANINGS);
    expect(m['s23-permit-travel-agents']).toBe('Lets people in the travel-agents group make calls (attended or unattended) to tools in the booking app.');
    expect(m['s04-payments-finance-only']).toBe('Lets people in the finance group make attended calls to tools in the payments app when the token has the payments:write scope.');
    expect(m['s01-hold-large-fare']).toBe('Holds unattended calls to the book_fare tool when an amount is given and the amount is over 1000, until Priya approves. It stops applying once someone has approved the call.');
    expect(m['s05-rugpull-pin']).toBe("Blocks any call to any tool when the tool's description or schema has changed since it was approved.");
  });
  it('writes the web fixture (UPDATE_GOLDEN=1) and keeps it equal to the golden files', () => {
    const fixture = Object.fromEntries(Object.entries(CASES).map(([k, make]) => [k, make()]));
    if (UPDATE) { fs.mkdirSync(path.dirname(FIXTURE), { recursive: true }); fs.writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`); }
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(fixture);
  });
  it('named cast and live mode: persona names only in mock mode', () => {
    const cast = makeWorld('generic', { cast: { mark: 'Maria', agent: 'Robo', priya: 'Pat' } });
    const e = cast.explain(dot(mark), 'book_fare', fare(2400));
    expect(e.who.name).toBe('Maria');
    expect(e.who.agent.name).toBe('Robo');
    expect(e.headline).toBe('Held. Pat must approve this before book_fare runs.');
    const live = makeWorld('generic', { mode: 'live', cast: { mark: 'Maria' } });
    const l = live.explain(dot(mark), 'book_fare', fare(2400), { source: 'bearer' });
    expect(l.who.name).toBe('mark');
    expect(l.who.via).toBe('a PingFederate access token');
    expect(l.headline).toBe('Held. priya must approve this before book_fare runs.');
    expect(l.change.text).toBe('priya approves it on the Approvals page.');
    expect(l.approval.text).toContain("with an approver's token");
  });
});

describe('an edit changes the explanation (nothing is typed per scenario)', () => {
  const edited = (id, from, to) => {
    const text = W.ps.staticPolicies[id].replace(from, to);
    expect(text).not.toBe(W.ps.staticPolicies[id]);
    return { ...W.ps.staticPolicies, [id]: text };
  };
  it('amount > 1000 becomes > 500: an unattended 800 call is now held and the text says 500', () => {
    const w = makeWorld('generic', { policies: edited('s01-hold-large-fare', 'amount > 1000', 'amount > 500') });
    const e = w.explain(dot(mark), 'book_fare', fare(800));
    expect(e.kind).toBe('held');
    expect(rule(e, 's01-hold-large-fare').because.join(' ')).toContain('the amount 800 is over 500');
    expect(w.ex.meaning({ id: 's01-hold-large-fare', state: 'active', text: w.ps.staticPolicies['s01-hold-large-fare'] }).does).toContain('over 500');
  });
  it('deleting the travel-agents permit makes Mark\'s 800 booking a default deny, and says no allow rule covers book_fare', () => {
    const { 's23-permit-travel-agents': _gone, ...rest } = W.ps.staticPolicies;
    const w = makeWorld('generic', { policies: rest });
    const e = w.explain(mark, 'book_fare', fare(800));
    expect(e.kind).toBe('default-deny');
    expect(e.change.text).toBe('No allow rule is about book_fare yet. An admin would have to add one.');
  });
  it('a new permit for analysts on book_fare appears in Mary\'s "what would change" line', () => {
    const extra = `@id("t-analysts-book")\n@reason("Analysts may book")\npermit (principal in Group::"analysts", action == Action::"mcp:Invoke", resource)\nwhen { context.app == "booking" && context.token.scopes.contains("book:write") };`;
    const w = makeWorld('generic', { policies: { ...W.ps.staticPolicies, 't-analysts-book': extra } });
    const e = w.explain(mary, 'book_fare', fare(800));
    expect(e.kind).toBe('default-deny');
    expect(e.change.items).toContainEqual({ ruleId: 't-analysts-book', text: 'the token had the book:write scope' });
    expect(e.change.text).toContain('t-analysts-book');
  });
  it('removing the unattended-only scope from s01 makes it cover attended calls too', () => {
    const w = makeWorld('generic', { policies: edited('s01-hold-large-fare', 'action == Action::"mcp:InvokeUnattended"', 'action') });
    expect(w.explain(mark, 'book_fare', fare(2400)).kind).toBe('held');
  });
  it('an unless clause is understood: u41-style exception names the group', () => {
    const text = `@id("t-restrict")\n@reason("Only finance may pay")\nforbid (principal, action, resource == Tool::"pay_invoice")\nunless { principal in Group::"finance" };`;
    const w = makeWorld('generic', { policies: { ...W.ps.staticPolicies, 't-restrict': text } });
    const e = w.explain(person('fin', ['finance'], { scope: 'tools:invoke payments:write' }), 'pay_invoice', { invoiceId: 'i', amount: 1 });
    expect(rule(e, 't-restrict').because.join(' ')).toContain('fin is in the finance group, which is an exception to this rule');
    const blocked = w.explain(mark, 'pay_invoice', { invoiceId: 'i', amount: 1 });
    expect(blocked.change.text).toContain('Mark were in the finance group');
  });
});

describe('a policy shape we cannot put into words is explained from its text', () => {
  const odd = `@id("t-odd")\n@reason("Double the fare must stay small")\nforbid (principal, action == Action::"mcp:Invoke", resource == Tool::"book_fare")\nwhen { context.args has amount && context.args.amount * 2 > 100 };`;
  const w = makeWorld('generic', { policies: { ...W.ps.staticPolicies, 't-odd': odd } });
  it('the meaning says so, shows the raw clause and the reason, and invents no claim', () => {
    const m = w.ex.meaning({ id: 't-odd', state: 'active', text: odd });
    expect(m.explainedFrom).toBe('text');
    expect(m.does).toBe('Explained from its text: “Double the fare must stay small”.');
    expect(m.unexplained).toEqual(['(context.args.amount * 2) > 100']);
    expect(m.conditions).toEqual([]);
    expect(m.source).toBe(odd);
  });
  it('in Rules checked its reason is only the raw text, its status still comes from Cedar, and it is never "not about this tool"', () => {
    const hit = w.explain(mark, 'book_fare', fare(800));
    expect(hit.checks.agreed).toBe(true);
    expect(rule(hit, 't-odd')).toMatchObject({ status: 'blocked', explainedFrom: 'text', because: [] });
    expect(hit.kind).toBe('blocked');
    const miss = w.explain(mark, 'book_fare', fare(10));
    expect(rule(miss, 't-odd')).toMatchObject({ status: 'not-applied', explainedFrom: 'text', because: ['a condition written in Cedar was not met: (context.args.amount * 2) > 100'] });
    const other = w.explain(mark, 'pay_invoice', { invoiceId: 'i', amount: 1 });
    expect(rule(other, 't-odd').status).toBe('not-applied');
    expect(rule(other, 't-odd').status).not.toBe('not-about-tool');
  });
  it('a policy with no @reason and an unknown shape says it could not be put into words', () => {
    const text = `@id("t-odd2")\npermit (principal, action, resource) when { context.approval_count * 2 > 100 };`;
    const m = w.ex.meaning({ id: 't-odd2', state: 'active', text });
    expect(m.does).toBe('This rule could not be put into words. Its Cedar text is shown below.');
  });
  it('text that does not parse is never explained as anything', () => {
    expect(w.ex.meaning({ id: 'x', state: 'active', text: 'permit (' })).toMatchObject({ explainedFrom: 'text', kind: null });
  });
});

describe('the verifier: when the per-rule reading disagrees with Cedar, say so and keep Cedar\'s facts', () => {
  function withStub(stub, fn) {
    const { cedar } = engine();
    const real = cedar.isAuthorized;
    cedar.isAuthorized = (req) => {
      const out = real(req);
      return Object.keys(req.policies.staticPolicies).some((k) => k.includes('|')) ? stub(out) : out;
    };
    try { return fn(); } finally { cedar.isAuthorized = real; }
  }
  const everything = (out) => ({ ...out, response: { ...out.response, diagnostics: { ...out.response.diagnostics, reason: Object.keys(W.ps.staticPolicies).flatMap((id) => [`${id}|whole`]) } } });
  const flipped = (out) => ({ ...out, response: { ...out.response, diagnostics: { ...out.response.diagnostics, reason: out.response.diagnostics.reason.filter((r) => !r.endsWith('|whole')) } } });
  const real = W.explain(mark, 'book_fare', fare(12000));

  for (const [name, stub] of [['every piece reported satisfied', everything], ['the applied rules removed', flipped]]) {
    it(`${name}: agreed=false, no per-rule reasons, a note, and the decision fields untouched`, () => {
      const e = withStub(stub, () => W.explain(mark, 'book_fare', fare(12000)));
      expect(e.checks.agreed).toBe(false);
      expect(e.rules.every((r) => r.because.length === 0 && r.explainedFrom === 'text')).toBe(true);
      expect(e.notes).toContain("Per-rule detail could not be checked for this request. The decision above is Cedar's own answer.");
      expect(e.outcome).toBe(real.outcome);
      expect(e.kind).toBe(real.kind);
      expect(e.technical).toEqual(real.technical);
      expect(e.decidedBy.id).toBe(real.decidedBy.id);
    });
  }
});

describe('safety of what the explanation shows', () => {
  it('credential-looking values are withheld, long values cut, long lists cut', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';
    const hex = 'a'.repeat(20) + '0123456789abcdef0123456789abcdef';
    const groups = [jwt, hex, 'g'.repeat(250), ...Array.from({ length: 60 }, (_, i) => `grp-${i}`)];
    const e = W.explain(person('mark', groups), 'search_flights', { query: 'q' });
    expect(e.who.groups.slice(0, 2)).toEqual(['[withheld]', '[withheld]']);
    expect(e.who.groups[2].length).toBeLessThanOrEqual(60);
    expect(e.who.groups).toHaveLength(20);
    expect(e.who.groupsMore).toBe(43);
    expect(e.who.text).toContain('and 43 more');
    expect(JSON.stringify(e)).not.toContain(jwt);
    expect(JSON.stringify(e)).not.toContain(hex);
    const sub = W.explain(person(jwt, ['analysts']), 'search_flights', { query: 'q' });
    expect(sub.who.name).toBe('[withheld]');
    expect(JSON.stringify(sub)).not.toContain('eyJhbGci');
  });
  it('control and bidi characters are stripped from names', () => {
    const e = W.explain(person('ma‮rk\u0007x', ['analysts']), 'search_flights', { query: 'q' });
    expect(e.who.name).toBe('markx');
  });
  it('free-text arguments are never shown, only values some rule reads', () => {
    const e = W.explain(mary, 'create_ticket', { subject: 'my password is hunter2' });
    expect(JSON.stringify(e)).not.toContain('hunter2');
    expect(e.asked.details).toEqual([]);
    const f = W.explain(mark, 'book_fare', { flightId: 'FL-secret-9', amount: 5 });
    expect(JSON.stringify(f)).not.toContain('FL-secret-9');
    expect(f.asked.details).toEqual([{ label: 'amount', value: '5' }]);
  });
  it('requests that are refused before any rule are explained as such', () => {
    const e = W.explain({ sub: 'x', groups: 'nope' }, 'search_flights', { query: 'q' });
    expect(e).toMatchObject({ kind: 'before-rules', outcome: 'deny', rules: [] });
    expect(e.before.code).toBe('invalid-claims');
    expect(W.ex.forBefore({ code: 'invalid-arguments', problems: ['missing argument amount'], claims: mark, tool: 'book_fare', app: 'booking' }).why).toContain('Arguments are checked first');
  });
});

describe('scope of the explanation', () => {
  it('a Candidate (staged) policy is not part of Rules checked: only the active set is explained', () => {
    const e = W.explain(mark, 'book_fare', fare(800));
    expect(e.rules.map((r) => r.id).sort()).toEqual(Object.keys(W.ps.staticPolicies).sort());
  });
  it('more than MAX_CLAUSES pieces degrade to whole-rule explanations, still agreeing with Cedar', () => {
    const many = {};
    for (let i = 0; i < 44; i += 1) {
      many[`t-many-${i}`] = `@id("t-many-${i}")\n@reason("Filler ${i}")\npermit (principal in Group::"g${i}", action == Action::"mcp:Invoke", resource == Tool::"book_fare")\nwhen { context.app == "booking" && context.args has amount && context.args.amount > ${i} && context.token.scopes.contains("s${i}") && context.pinnedHash == context.observedHash };`;
    }
    const w = makeWorld('generic', { policies: { ...W.ps.staticPolicies, ...many } });
    const e = w.explain(mark, 'book_fare', fare(800));
    expect(e.checks.clauses).toBeGreaterThan(MAX_CLAUSES);
    expect(e.checks.agreed).toBe(true);
    expect(e.rules.every((r) => r.explainedFrom === 'text' && r.because.length === 0)).toBe(true);
    expect(e.notes.join(' ')).toContain('too many rules to explain one by one');
    expect(e.kind).toBe('allowed');
  });
  it('every policy edit is a new policy set, so the cache cannot serve a stale explanation', () => {
    const a = validatePolicies(W.pack.shippedPolicies()).policySet;
    const b = validatePolicies({ ...W.pack.shippedPolicies(), 's23-forbid-over-cap': W.ps.staticPolicies['s23-forbid-over-cap'].replace('amount > 10000', 'amount > 100') }).policySet;
    const ea = W.ex.forCall({ ...W.input(mark, 'book_fare', fare(800)), policySet: a });
    const eb = W.ex.forCall({ ...W.input(mark, 'book_fare', fare(800)), policySet: b });
    expect(ea.kind).toBe('allowed');
    expect(eb.kind).toBe('blocked');
  });
  it('BASE claims are the demo\'s own', () => { expect(BASE.client_id).toBe('privilege-demo-web'); });
});

describe('"what would change the answer" is only said after Cedar agreed (the request is run again with that one change)', () => {
  it('a block that is not the only obstacle says the call would still be denied, and a re-run with that change really is denied', () => {
    const e = W.explain(mary, 'book_fare', fare(10001));
    expect(e.kind).toBe('blocked');
    expect(e.change.text).toContain('would stop applying if the amount were 10000 or less, but the call would still be denied');
    expect(e.change.text).not.toContain('would then be allowed');
    expect(W.pepOutcome(mary, 'book_fare', fare(10000))).toBe('deny'); // what the line promises, checked independently
  });
  it('a block whose lifting leads to a hold says so (an unattended call over the cap)', () => {
    const e = W.explain(dot(mark), 'book_fare', fare(12000));
    expect(e.kind).toBe('blocked');
    expect(e.change.text).toContain('and the call would then be held for Priya to approve');
    expect(W.pepOutcome(dot(mark), 'book_fare', fare(10000))).toBe('hold');
  });
  it('a block whose lifting really allows the call still says so', () => {
    expect(W.explain(mark, 'book_fare', fare(12000)).change.text).toContain('10000 or less, and the call would then be allowed');
  });
  it('an allow rule that is missing a group is not promised as enough when another rule would then deny (utility-style repo scope)', () => {
    const permit = `@id("t-ta")\n@reason("Travel agents may pay")\npermit (principal in Group::"travel-agents", action, resource == Tool::"pay_invoice");`;
    const forbid = `@id("t-fin-only")\n@reason("Travel agents never pay")\nforbid (principal in Group::"travel-agents", action, resource == Tool::"pay_invoice");`;
    const w = makeWorld('generic', { policies: { ...W.ps.staticPolicies, 't-ta': permit, 't-fin-only': forbid } });
    const e = w.explain(mary, 'pay_invoice', { invoiceId: 'i', amount: 1 });
    const line = e.change.text;
    expect(line).toContain('(t-ta) would cover it if Mary were in the travel-agents group, but the call would still be denied');
    expect(line).not.toContain('(t-ta) would allow it');
    expect(w.pepOutcome(person('mary', ['analysts', 'travel-agents']), 'pay_invoice', { invoiceId: 'i', amount: 1 })).toBe('deny');
  });
});

describe('the approver is not told to approve their own request', () => {
  const priya = person('priya', ['travel-agents']);
  it('Priya asking for a large fare as an agent: another approver or an admin is named, never Priya', () => {
    const e = W.explain(dot(priya), 'book_fare', fare(1500));
    expect(e.kind).toBe('held');
    expect(e.headline).toBe('Held. An admin must approve this before book_fare runs.');
    expect(e.change.text).toBe('An admin approves it on the Approvals page.');
    expect(e.approval.text).toContain('An admin can approve it');
    expect(e.approval.text).toContain('Priya cannot approve their own request, so another approver or an admin must.');
    expect(e.approval.text).not.toContain('sign in as Priya');
  });
});

describe('a hold rule an approval does not clear', () => {
  const noClear = W.ps.staticPolicies['s01-hold-large-fare'].replace(/\nunless \{ context\.approval_count >= 1 \}/, '');
  it('does not claim that no allow rule covers the request', () => {
    expect(noClear).not.toContain('approval_count');
    const w = makeWorld('generic', { policies: { ...W.ps.staticPolicies, 's01-hold-large-fare': noClear } });
    const e = w.explain(dot(mark), 'book_fare', fare(2000));
    expect(e.kind).toBe('hold-no-way-through');
    expect(rule(e, 's23-permit-travel-agents').status).toBe('overridden'); // an allow rule does cover Mark
    expect(e.headline).toBe('Denied. A hold rule applies, and an approval would not lift it.');
    expect(e.why).toContain('still applies once an approval is recorded');
    expect(e.why).not.toContain('no allow rule covers');
    expect(e.change.text).toContain('Approving would not be enough');
    expect(e.change.text).not.toContain('Some conditions could not be put in words');
  });
  it('the policy card does not say the rules are checked again after an approval', () => {
    const m = W.ex.meaning({ id: 's01-hold-large-fare', state: 'active', text: noClear });
    expect(m.does).toContain('An approval does not clear this rule.');
    expect(m.combines).toContain('still applies after an approval');
    expect(m.combines).not.toContain('Then the rules are checked again');
    const shipped = W.ex.meaning({ id: 's01-hold-large-fare', state: 'active', text: W.ps.staticPolicies['s01-hold-large-fare'] });
    expect(shipped.combines).toContain('Then the rules are checked again');
  });
});

describe('an `unless` on the tool or the app is an exception, not what the rule is about', () => {
  const text = `@id("t1")\n@reason("Only the booking app is open")\nforbid (principal, action, resource)\nunless { context.app == "booking" };`;
  const w = makeWorld('generic', { policies: { ...W.ps.staticPolicies, t1: text } });
  it('the meaning is "any tool unless the tool is in the booking app", not "tools in the booking app"', () => {
    const m = w.ex.meaning({ id: 't1', state: 'active', text });
    expect(m.does).toBe('Blocks any call to any tool unless the tool is in the booking app.');
    expect(m.what.text).toBe('any tool');
  });
  it('on a booking call the rule does not apply because the tool IS in the exception, and is not called "about" a different app', () => {
    const e = w.explain(mark, 'book_fare', fare(800));
    expect(rule(e, 't1').status).toBe('not-applied');
    expect(rule(e, 't1').because).toEqual(['the tool is in the booking app, which is an exception to this rule']);
    const blocked = w.explain(mary, 'search_flights', { query: 'q' });
    expect(rule(blocked, 't1').status).toBe('blocked');
  });
});

describe('an approval exception on an allow or block rule is shown', () => {
  it('permit ... unless approved lists the exception instead of "None"', () => {
    const text = `@id("t2")\npermit (principal in Group::"analysts", action, resource)\nunless { context.approval_count >= 1 };`;
    const m = W.ex.meaning({ id: 't2', state: 'active', text });
    expect(m.conditions).toEqual([{ kind: 'unless', text: 'someone has approved the call' }]);
    expect(m.does).toContain('unless someone has approved the call');
  });
});
