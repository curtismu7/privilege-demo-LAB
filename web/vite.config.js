import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 4510, npm run dev -w server) and Vite on VITE_PORT (default 4761, inside this app's test block
// 4760-4769); /api is proxied. Both listen on 127.0.0.1 only.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 4510}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 4761, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", css: false },
});
