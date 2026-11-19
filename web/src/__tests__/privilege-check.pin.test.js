// The vendored shared/privilege-check files match the canonical hashes byte for byte. They come from curtismu7/AI-DEMO-Standalone
// shared/privilege-check: change them there, re-vendor; never edit them here. The trace panel is NOT patched into the card: the lab renders
// it from the card's own onResult (web/src/privilege-check/GatewayCheckCard.jsx).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const CANON = {
  "PrivilegeCheck.jsx": "0b022236251b56d1b96f853afeba1c0da96017c10eb591c622e80d071672b2a8",
  "privilege-check.css": "14b630f8da9c7a70a21628843084ec743966a261cb2aee65ac5ed3c92f5b93a4",
  "PrivilegeCheck.test.jsx": "10fac709932a9d2435f28e5ebc907cf6e73e3d3b3cee5d1d2ec4bd2201a9b764",
  "README.md": "0ed063091a65535a44645dea768775569497a8c0b98046380b328152223949d5",
};
const DIR = path.join(process.cwd(), "src", "privilege-check");

describe("vendored privilege-check", () => {
  for (const [file, hash] of Object.entries(CANON)) {
    it(`${file} equals the canonical card`, () => {
      expect(createHash("sha256").update(fs.readFileSync(path.join(DIR, file))).digest("hex"), `${file} differs from canonical (hand-edited, or an old copy)`).toBe(hash);
    });
  }
});
