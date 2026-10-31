// Local-only CLI: ask the running stub issuer (same machine) for an access token for a persona. Prints the token only.
//   node stub-issuer/mint.mjs mark
//   node stub-issuer/mint.mjs mark --act dot            (Dot acts for Mark: the call is unattended)
//   node stub-issuer/mint.mjs mary --groups finance --scope "tools:invoke payments:write"
//   PACK=utility node stub-issuer/mint.mjs --agent delivery-agent     (the agent itself is the subject: sub=delivery-agent, no act claim)
// In Docker: docker compose exec -T stub-issuer node stub-issuer/mint.mjs priya
import http from 'node:http';

const args = process.argv.slice(2);
const agent = args.indexOf('--agent') >= 0 ? args[args.indexOf('--agent') + 1] : undefined;
const persona = agent ? undefined : args[0];
const opt = (name) => { const i = args.indexOf(name); return i > 0 ? args[i + 1] : undefined; };
if (!agent && (!persona || persona.startsWith('--'))) { console.error('usage: mint.mjs <persona: mark|mary|priya|dana, or eli|gwen|ben|cora|priya|dana for PACK=utility> [--act dot] [--groups a,b] [--scope "..."]'); process.exit(2); }
const body = JSON.stringify({ ...(agent ? { agent } : { persona, act: opt('--act') }), groups: opt('--groups')?.split(','), scope: opt('--scope') });
const req = http.request({ host: '127.0.0.1', port: Number(process.env.STUB_PORT) || 9031, path: '/mint', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
  let out = '';
  res.on('data', (c) => { out += c; });
  res.on('end', () => {
    const j = JSON.parse(out || '{}');
    if (res.statusCode !== 200) { console.error(`mint failed: ${j.error || res.statusCode}`); process.exit(1); }
    console.log(j.access_token);
  });
});
req.on('error', () => { console.error('mint failed: the stub issuer is not running here (start it: node stub-issuer/server.mjs, or docker compose up)'); process.exit(1); });
req.end(body);
