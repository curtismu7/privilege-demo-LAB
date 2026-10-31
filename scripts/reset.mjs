// npm run reset [workspace]: clears the run state of one workspace on the running app: policies back to the shipped set, held approvals,
// tool drift and the trace. Sign-ins and settings stay. Workspace: first argument, or WORKSPACE, or "default".
// The app must be running (its run state is in memory). APP_URL points at another loopback address (default http://127.0.0.1:$PORT).
import http from 'node:http';

const workspace = process.argv[2] || process.env.WORKSPACE || 'default';
const port = Number(process.env.PORT || 4510);
const base = process.env.APP_URL ? new URL(process.env.APP_URL) : null;
if (base && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) { console.error('APP_URL must be a loopback address'); process.exit(1); }
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(workspace)) { console.error('The workspace id is lowercase letters, digits and hyphens (1 to 32 characters)'); process.exit(1); }

const host = base?.hostname.replace(/^\[|\]$/g, '') || '127.0.0.1';
const targetPort = base ? Number(base.port) || 80 : port;
const answer = await new Promise((resolve) => {
  const req = http.request({ host, port: targetPort, method: 'POST', path: `/api/workspaces/${encodeURIComponent(workspace)}/reset`, timeout: 6000, headers: { 'content-type': 'application/json' } }, (res) => {
    let text = '';
    res.on('data', (d) => { text += d; });
    res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch { resolve(null); } });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => req.destroy());
  req.end('{}');
});
if (!answer) { console.log(`no app answers on ${host}:${targetPort}; its approvals, drift and trace live in memory, so there is nothing to reset (delete the workspace folder under DATA_DIR to restore the shipped policies)`); process.exit(0); }
if (answer.status !== 200) { console.error(`reset refused: ${answer.body?.error || answer.status}${answer.body?.fix ? ` (${answer.body.fix})` : ''}`); process.exit(1); }
const c = answer.body.cleared || {};
console.log(`reset workspace "${answer.body.workspace}": ${c.approvals ?? 0} approval(s), ${c.traceEvents ?? 0} trace event(s), ${c.driftedTools ?? 0} drifted tool(s) cleared; policies back to the shipped set; sign-ins kept`);
