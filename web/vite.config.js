import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 8080, npm run dev -w server) and Vite on VITE_PORT (default 5173); /api is proxied.
const api = { target: `http://localhost:${Number(process.env.PORT) || 8080}` };

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.VITE_PORT) || 5173, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js" },
});
