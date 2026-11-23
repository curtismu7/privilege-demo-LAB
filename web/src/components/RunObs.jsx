// Rule 27: the shared run-observability panel for this lab, in two places: under the Tool console (RunObs: one tool-call run, asked for by its run
// id) and under the Privilege gateway card (GatewayRunObs: the record of the check, which came back with the check's own answer).
// The shared panel is vendored and never edited; this file only asks for the record and says what the lab adds to it.
import { useEffect, useState } from "react";
import { api } from "../api";
import RunObservability from "../run-observability/RunObservability";

const POLL_MS = 3000; // a held call keeps its run open: ask again until the approver's answer (or the expiry) closes it
const TITLE = "What each layer logged for this run";

// Where this lab's own log lives and where it can stream (the README says the same).
export const RUN_OBS_STREAMS = [
  { product: "Privilege demo LAB (this lab)", lives: "the container's stdout: one line per decision (layer, step, actor, agent, tool, result, mode, run id; never a token or a password), and audit.jsonl in the data volume", streams: "nowhere today: the family log collector does not read this container. If it did, the SIEM time would be Docker's wall-clock time per line; the lab's own time stays inside the line" },
  { product: "PingFederate (Live mode: sign-in and tokens)", lives: "its own container or host: server.log reaches stdout, audit.log does not", streams: "the collector ships PingFederate's stdout to ping-logs-pingfederate; audit.log is not shipped, and this lab reads none of it" },
  { product: "Privilege gateway (the Real gateway check)", lives: "cyonproxy.log in its log volume (local), or the SIEM index ping-siem-events-v2 and the console Activity Logs (hosted)", streams: "the collector's file source to ping-logs-privilege-gateway (local), or the Privilege SIEM export (hosted). This lab reads none of it, so the check shows only the replies it received" },
];

// One line under the panel for what a lane holds that is not its product (rule 27, ADDING step 3.6).
const LAB_NOTE = {
  mock: "Under Privilege sits this lab's own Cedar PEP (a Privilege-style simulation), not Privilege itself, and Authorize is not used: the policy engine is Cedar inside the lab. Every row was computed by the lab's mock; none was read from a product log. Time is when the lab recorded the decision.",
  real: "Live mode: the lab checks the sign-in or Bearer credential itself and decides with its own Cedar PEP (not Privilege, not Authorize). Neither is a log line or a reply from a product, so no row is shown for them; the decision is on the Tool console result and the Trace page, and the lab writes one stdout line for it.",
};
const GATEWAY_NOTE = "Every row under Agent gateway is a reply this lab received from the Privilege gateway, not a log line. Where the lab reads a status (for example 403 as a refusal) the row says it is the lab's reading. The lab reads no gateway log, so nothing here is marked logged. Time is when the lab received the reply.";

const Note = ({ testId, role = "status", children }) => (
  <section className="ro" data-testid={testId} aria-label={TITLE}>
    <h2>{TITLE}</h2>
    <p className="ro-muted" role={role}>{children}</p>
  </section>
);

// res: the console's last answer (null before a call). source: "mock" or "real", the page's current mode.
export default function RunObs({ res, source }) {
  const runId = res?.runId || null;
  const key = runId ? `${runId}|${source}` : null;
  const [got, setGot] = useState(null); // { key, answer }: the answer is only ever shown for the run and mode it was asked for
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    let timer = null;
    const load = async () => {
      const answer = await api(`/api/run-observability?runId=${encodeURIComponent(runId)}`);
      if (!live) return;
      setGot({ key, answer });
      if (answer.ok && answer.data?.run?.open) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => { live = false; clearTimeout(timer); };
  }, [key]);

  if (!res) return <><RunObservability record={null} source={source} streams={RUN_OBS_STREAMS} /><p className="ro-muted" data-testid="ro-lab-note">{LAB_NOTE[source]}</p></>;
  if (!runId) return <Note testId="ro-no-run">This attempt began no run, so there is no record for it.</Note>;
  const answer = got?.key === key ? got.answer : null;
  if (!answer) return <Note testId="ro-loading">Collecting this run's logs…</Note>;
  const d = answer.data;
  if (!answer.ok) return <Note testId="ro-error" role="alert">{d?.message || d?.error || `The record could not be read (HTTP ${answer.status}).`}</Note>;
  if (!d?.record) return <Note testId="ro-not-shown" role="alert">{d?.message || "There is no record for this run."}</Note>;
  return (
    <>
      <RunObservability record={d.record} source={source} streams={RUN_OBS_STREAMS} />
      <p className="ro-muted" data-testid="ro-lab-note">{LAB_NOTE[source]}</p>
    </>
  );
}

// The record of one gateway check, as the check's answer carried it (a record, or { error, message }). noReply: the calls that got no reply.
export function GatewayRunObs({ record, noReply = [] }) {
  return (
    <>
      <RunObservability record={record} source="real" streams={RUN_OBS_STREAMS} />
      <p className="ro-muted" data-testid="ro-lab-note">{GATEWAY_NOTE}</p>
      {noReply.length > 0 && <p className="ro-muted" data-testid="ro-no-reply">No reply came back to {noReply.join("; ")}. A call with no reply has no row.</p>}
    </>
  );
}
