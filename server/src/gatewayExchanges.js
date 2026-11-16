// "What Privilege did" for this lab (Rule 25). Two sources, never mixed:
//  - pepTrace: a console tool call through the lab's own simulated gateway (the Cedar PEP, pep.js). The PEP computed every decision, so each
//    is 'checked'. They are read from the outcome it returned, in the order enforce() runs them: tool known, arguments valid, policy, tool ran.
//  - gatewayCheckExchanges: the real hop (gatewayReal.js, capture on) through traceFromDoor. A real gateway reports no per-check detail,
//    so those decisions are inferred or observed, never checked.
// Nothing secret goes in: the console's sign-in cookie is shown as a placeholder, and the real hop redacts the agent key at capture.
import { mockTrace, traceFromDoor } from './gatewayTrace.js';

const decision = (id, label, outcome, evidence) => ({ id, label, outcome, evidence });
const problemText = (p) => (typeof p === 'string' ? p : p?.message || JSON.stringify(p));

export function pepDecisions(out, sub) {
  const unknown = out.rule === 'unknown-tool';
  const badArgs = out.rule === 'invalid-arguments';
  const stopped = unknown || badArgs;
  const policyEvidence = `${out.rule}: ${out.reason}${out.overridden?.length ? `. Overridden: ${out.overridden.join(', ')}` : ''}`;
  return [
    decision('signed-in', 'Signed in', 'pass', `the request carried a valid sign-in for ${sub}`),
    unknown ? decision('tool', 'Tool exists', 'fail', 'no such tool on this server') : decision('tool', 'Tool exists', 'pass', 'the tool is on the server'),
    unknown ? decision('arguments', 'Arguments valid', 'skipped', 'not reached: the tool is unknown')
      : badArgs ? decision('arguments', 'Arguments valid', 'fail', (out.problems || []).map(problemText).join('; ') || 'the arguments do not match the tool schema')
        : decision('arguments', 'Arguments valid', 'pass', 'the arguments match the tool schema'),
    stopped ? decision('policy', 'Policy (Cedar)', 'skipped', 'not reached: the call was refused before the policy ran')
      : out.outcome === 'allow' ? decision('policy', 'Policy (Cedar)', 'pass', policyEvidence)
        : out.outcome === 'hold' ? decision('policy', 'Policy (Cedar)', 'info', `held for approval by ${(out.approvers || []).join(', ') || 'an approver'}. ${policyEvidence}`)
          : decision('policy', 'Policy (Cedar)', 'fail', policyEvidence),
    out.outcome === 'allow' ? decision('ran', 'Tool ran', 'pass', 'the PEP ran the tool')
      : decision('ran', 'Tool ran', 'skipped', out.outcome === 'hold' ? 'not run: it waits for an approval' : 'not run: the call was refused'),
  ];
}

// body: what the console sent (as the server received it). out: the outcome returned (public shape, no trace).
export function pepTrace({ body, out, sub, workspace }) {
  return mockTrace({
    url: 'https://pep.privilege-demo.invalid/api/tools/call?envelope=1',
    authorization: null,
    requestHeaders: { authorization: null, accept: null, 'x-workspace': workspace, cookie: '<sign-in session cookie, kept on the server>' },
    rpc: body ?? null,
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', traceparent: out.traceparent },
    body: (({ traceparent, ...rest }) => rest)(out),
    decisions: pepDecisions(out, sub),
    record: `Trace page, trace ${out.trace_id}: the pep hop, and the audit row kind=tool_call. The console asks for ?envelope=1, so a refusal is HTTP 200 with the outcome in the body; without it a deny is 403 and a hold is 202.`,
  });
}

const stripWire = ({ wire, ...rest }) => rest;
const exchange = (step, title, result, opts) => { const trace = traceFromDoor(result, opts); return { step, title, status: trace.response?.status ?? null, trace }; };

// listing = door.list(...) and refusal = door.call(...) (or undefined when the listing failed), both from a door with capture: true.
export function gatewayCheckExchanges(listing, refusal) {
  return [
    exchange(1, 'Gateway check: tools/list', listing, { rpcMethod: 'tools/list' }),
    ...(refusal ? [exchange(2, 'Refusal probe: tools/call a tool nothing grants', refusal, { rpcMethod: 'tools/call' })] : []),
  ];
}
export { stripWire };
