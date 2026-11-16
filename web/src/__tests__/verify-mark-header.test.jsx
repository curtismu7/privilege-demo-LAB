import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AppShell from "../AppShell";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function withShelf(payload) {
  globalThis.fetch = (url, init) => (url === "/api/shelf" ? Promise.resolve(new Response(JSON.stringify(payload))) : real ? real(url, init) : Promise.resolve(new Response("{}")));
}

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "privilege-demo", verification: mark("verified", "Verified", { note: "Every call checked on the mock" }) }] });
    render(<AppShell><p>hello</p></AppShell>);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify").length).toBe(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every call checked on the mock"));
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "privilege-demo", verification: null }] }]) {
      withShelf(payload);
      const { unmount } = render(<AppShell><p>hello</p></AppShell>);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });

  it("the header renders the badge for the shelf id of this lab (removing the line fails this test)", () => {
    const src = readFileSync(path.join(process.cwd(), "src", "AppShell.jsx"), "utf8");
    expect(src).toMatch(/<VerifyMark id="privilege-demo" \/>/);
    expect(JSON.parse(readFileSync(path.join(process.cwd(), "..", "docs", "shelf-entry.json"), "utf8")).id).toBe("privilege-demo");
  });
});
