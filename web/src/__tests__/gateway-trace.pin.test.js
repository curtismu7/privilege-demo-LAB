// The vendored shared/gateway-trace files (Rule 25) match gateway-trace.sha256 byte for byte, and the pins equal the canonical hashes. They come
// from curtismu7/AI-DEMO-Standalone shared/gateway-trace: change them there, re-pin, re-vendor; never edit them here. The pin file lists the
// server copy as plain gatewayTrace.js, so it is mapped to server/src/gatewayTrace.js here.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const CANON = {
  "GatewayTrace.jsx": "3f6f76d6c621afcb264da335cbea7ca9b70fb51f060d3d99bbd6810022db5b52",
  "gateway-trace.css": "945c779062e2e4bcbfd9a1f225b9f506fa2eb7ac28af61b6f5e110c44f5aa4d8",
  "gateway-trace.test.jsx": "8821f7a2d508ab01a9aa2ab2012b5d33534e33a35e7035dd8aedfa5e32ef1519",
  "gatewayTrace.js": "c3178e7c5158adc248dc3e5e741b2df7cc38faab7f7141a4cce9514f85ffc42d",
};
const WEB = path.join(process.cwd(), "src", "gateway-trace");
const WHERE = { "GatewayTrace.jsx": WEB, "gateway-trace.css": WEB, "gateway-trace.test.jsx": WEB, "gatewayTrace.js": path.join(process.cwd(), "..", "server", "src") };
const sha = (file) => createHash("sha256").update(fs.readFileSync(path.join(WHERE[file], file))).digest("hex");

describe("vendored gateway-trace", () => {
  const pins = fs.readFileSync(path.join(WEB, "gateway-trace.sha256"), "utf8").split("\n").filter((l) => /^[0-9a-f]{64}\s/.test(l)).map((l) => l.split(/\s+/));
  it("pins all four files, each pin equals the file and the canonical hash", () => {
    expect(pins.map(([, f]) => f).sort()).toEqual(Object.keys(WHERE).sort());
    for (const [hash, file] of pins) {
      expect(sha(file), `${file} differs from gateway-trace.sha256 (hand-edited, or re-vendored without re-pinning)`).toBe(hash);
      expect(hash, `${file} canonical`).toBe(CANON[file]);
    }
  });
  it("keeps the server copy as gatewayTrace.js, not trace.js (the W3C traceparent helper)", () => {
    expect(fs.existsSync(path.join(WHERE["gatewayTrace.js"], "gatewayTrace.js"))).toBe(true);
    expect(fs.existsSync(path.join(WHERE["gatewayTrace.js"], "trace.js"))).toBe(false);
  });
});
