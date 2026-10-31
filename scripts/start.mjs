// npm start: the host-run launch. Mock sign-in is allowed here because this launch is loopback-only (server/src/config.js refuses a
// non-loopback bind with it on). A direct `node server/src/index.js` does not set it; Docker sets it in docker-compose.yml.
process.env.ALLOW_MOCK_SIGNIN ??= '1';
await import('../server/src/index.js');
