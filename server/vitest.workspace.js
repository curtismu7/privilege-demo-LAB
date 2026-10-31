import { defineWorkspace } from 'vitest/config';

// The Cedar module's tests run behind a guard that throws on any socket, DNS or fetch (proves it is offline).
// The app tests start the Express app on loopback, so they run in their own project without the guard.
// testTimeout: the first Cedar wasm import and the spawned-process tests are slow on a loaded machine (5 s flaked).
export default defineWorkspace([
  { test: { name: 'cedar', include: ['test/cedar/**/*.test.js'], setupFiles: ['./test/cedar/no-network.js'], testTimeout: 30000 } },
  { test: { name: 'app', include: ['test/app/**/*.test.js'], testTimeout: 30000 } },
]);
