// JsonPane tests (vitest + Testing Library + jsdom). Run where the file is vendored
// (web/src/components/, next to web/src/safeText.js) — see shared/gateway-trace/gateway-trace.test.jsx.
import { render, screen, within, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Json, setJsonView, decodedTokensIn, decodeSegment } from "./JsonPane";

// JWT-shaped strings assembled at run time (never a real token in the repo).
const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwtOf = (header, claims, sig = "c2lnbmF0dXJl") => [b64(header), b64(claims), sig].join(".");

afterEach(cleanup);

beforeEach(() => setJsonView("form"));

describe("JsonPane Form view: single-href link objects collapse", () => {
  test("a one-key { href } object shows the parent key with the URL as its value, no nested href row", () => {
    render(<Json value={{ _links: { branding: { href: "https://api.pingone.com/v1/branding" } } }} testId="links" />);
    const row = screen.getByText("branding").closest(".jform__row");
    expect(row).not.toBeNull();
    expect(screen.queryByText("href")).toBeNull();
    const url = row.querySelector(".jform__v--url");
    expect(url).not.toBeNull();
    expect(url).toHaveTextContent("https://api.pingone.com/v1/branding");
  });

  test("a multi-key object and an array of href objects stay nested as before", () => {
    render(
      <Json
        value={{
          _links: {
            multi: { href: "https://api.pingone.com/v1/x", method: "GET" },
            list: [{ href: "https://api.pingone.com/v1/a" }],
          },
        }}
        testId="links2"
      />
    );
    expect(screen.getByText("multi")).toBeInTheDocument();
    expect(screen.getByText("href")).toBeInTheDocument();
    expect(screen.getByText("method")).toBeInTheDocument();
    expect(screen.getByText("list")).toBeInTheDocument();
  });
});

describe("decoded tokens (Rule 24b)", () => {
  test("a PingOne-shaped token in a body: raw in its field, then Header, Payload and Signature under the pane, named by the field", () => {
    const token = jwtOf(
      { alg: "RS256", kid: "mock-key-1", typ: "JWT" },
      { sub: "u-123", client_id: "bank-app", iss: "https://auth.ping-devops.com/as", aud: ["gateway"], scope: "openid transfer", iat: 1769000000, exp: 1769003600, may_act: JSON.stringify({ sub: "agent-1" }) }
    );
    render(<Json label="Token response" value={{ access_token: token, token_type: "Bearer", expires_in: 3600 }} />);
    const box = screen.getByTestId("decoded-tokens");
    const card = within(box).getByTestId("decoded-token");
    expect(card.textContent).toMatch(/access_token/);
    for (const h of ["Header", "Payload", "Signature"]) expect(within(card).getByText(h)).toBeTruthy();
    expect(card.textContent).toMatch(/RS256/);
    expect(card.textContent).toMatch(/u-123/);
    expect(card.textContent).toMatch(/transfer/);
    expect(card.textContent).toMatch(/gateway/);
    expect(card.textContent).toMatch(/agent-1/);
  });

  test("a Bearer authorization header, a nested act chain, and JSON that arrived as text are all decoded", () => {
    const inner = jwtOf({ alg: "ES256", kid: "mock-key-1" }, { sub: "agent-1", client_id: "agent-1", scope: "trips:read" });
    const outer = jwtOf({ alg: "RS256", kid: "k2" }, { sub: "u-123", act: { sub: "agent-1" } });
    render(<Json label="Exchange request" value={{ headers: { authorization: `Bearer ${outer}` }, body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: inner } }} />);
    const names = screen.getAllByTestId("decoded-token").map((e) => e.querySelector(".jdec__name").textContent);
    expect(names).toEqual(["headers.authorization", "body.subject_token"]);
    cleanup();
    render(<Json label="text body" value={JSON.stringify({ access_token: outer })} />);
    expect(screen.getByTestId("decoded-token").textContent).toMatch(/access_token/);
  });

  test("decode={false} skips decoding; the same token is shown once; caps hold (6 tokens, depth 8)", () => {
    const token = jwtOf({ alg: "none" }, { sub: "s" }, "");
    render(<Json label="raw" value={{ access_token: token }} decode={false} />);
    expect(screen.queryByTestId("decoded-tokens")).toBeNull();
    cleanup();
    const found = decodedTokensIn({ a: token, b: { c: token } });
    expect(found).toHaveLength(1);
    expect(decodedTokensIn(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`t${i}`, jwtOf({ alg: "none" }, { sub: `s${i}` })])))).toHaveLength(6);
    expect(decodedTokensIn({ a: { b: { c: { d: { e: { f: { g: { h: { i: { j: token } } } } } } } } } })).toHaveLength(0);
  });

  test("an unsigned token says so; a cut-short or non-JWT is skipped; decoded text is rendered as text, never as markup", () => {
    const token = jwtOf({ alg: "none" }, { sub: "<img src=x onerror=alert(1)>" }, "");
    render(<Json label="unsigned" value={{ access_token: token, short: `${token.slice(0, 40)}...`, note: "eyJ not a token" }} />);
    const card = screen.getByTestId("decoded-token");
    expect(card.textContent).toMatch(/no signature segment/);
    expect(card.querySelector("img, script")).toBeNull();
    expect(card.textContent).toMatch(/<img src=x onerror=alert\(1\)>/);
    expect(screen.getAllByTestId("decoded-token")).toHaveLength(1);
  });

  test("decodeSegment handles base64url with and without padding and returns null for non-objects", () => {
    expect(decodeSegment(b64({ alg: "RS256" }))).toEqual({ alg: "RS256" });
    expect(decodeSegment(btoa(JSON.stringify({ alg: "ES256" })))).toEqual({ alg: "ES256" });
    expect(() => decodeSegment("!!!")).toThrow();
  });
});

// ---- Deep payloads stay compact (a gateway's MCP tools/list: result > tools > tool > inputSchema > properties > property) ----
const prop = (type, description) => ({ type, description });
const toolsList = (n = 4) => ({
  jsonrpc: "2.0",
  id: 2,
  result: {
    tools: Array.from({ length: n }, (_, i) => ({
      name: `banking-mcp__get_investment_accounts_${i}`,
      description: "List the investment accounts the signed-in customer owns, with the current balance and the date of the last statement.",
      inputSchema: { type: "object", properties: { customer_id: prop("string", "Who."), currency: { ...prop("string", "Which."), enum: ["USD", "EUR"] } }, required: ["customer_id"], additionalProperties: false },
    })),
  },
});
const rowOf = (key) => screen.getAllByText(key).map((e) => e.closest(".jform__row")).find(Boolean);

describe("JsonPane Form view: deep nesting", () => {
  test("a row whose value nests further stacks under its label; a scalar row does not", () => {
    render(<Json value={toolsList(1)} label="tools" />);
    for (const key of ["result", "tools", "inputSchema", "properties"]) expect(rowOf(key)).toHaveAttribute("data-nested", "true");
    for (const key of ["jsonrpc", "id", "name", "required", "additionalProperties"]) expect(rowOf(key)).not.toHaveAttribute("data-nested");
  });

  test("from the third level a flat object (every entry a scalar or chip list) sits beside its label; a shallow one still stacks", () => {
    render(<Json value={{ act: { sub: "agent-1" }, ...toolsList(1) }} label="tools" />);
    expect(rowOf("act")).toHaveAttribute("data-nested", "true"); // level 1: stays stacked
    expect(rowOf("customer_id")).not.toHaveAttribute("data-nested"); // a property of inputSchema.properties: flat and deep
    expect(rowOf("currency")).not.toHaveAttribute("data-nested");
    expect(screen.getAllByText("enum").length).toBeGreaterThan(0);
  });

  test("indentation is capped: no group reports a depth above 3, and every level keeps its text", () => {
    let deep = { leaf: "bottom" };
    for (let i = 0; i < 12; i += 1) deep = { [`level${i}`]: deep };
    const { container } = render(<Json value={deep} label="deep" />);
    const depths = [...container.querySelectorAll(".jform")].map((e) => Number(e.getAttribute("data-depth")));
    expect(depths.length).toBe(13);
    expect(Math.max(...depths)).toBe(3);
    expect(screen.getByText("bottom")).toBeInTheDocument();
    for (let i = 0; i < 12; i += 1) expect(screen.getByText(`level${i}`)).toBeInTheDocument();
  });

  test("a long string stays whole in ONE value box (no truncation, no splitting into pieces), including an unbroken run", () => {
    const sentence = "Return the most recent transactions of one account, newest first, with merchant name, category and running balance. ".repeat(6).trim();
    const unbroken = "x".repeat(600);
    render(<Json value={{ result: { tool: { inputSchema: { properties: { memo: { description: sentence, token_like: unbroken } } } } } }} label="long" />);
    const box = screen.getByText(sentence);
    expect(box).toHaveClass("jform__v");
    expect(box.textContent).toBe(sentence);
    expect(screen.getByText(unbroken)).toHaveClass("jform__v");
  });

  test("an array of objects is a numbered list, one item per object, each with its own fields", () => {
    const { container } = render(<Json value={toolsList(4)} label="tools" />);
    const items = container.querySelectorAll(".jform__list > .jform__item");
    expect(items).toHaveLength(4);
    expect([...items].map((li) => li.querySelector(".jform__idx").textContent)).toEqual(["1", "2", "3", "4"]);
    items.forEach((li, i) => expect(li).toHaveTextContent(`banking-mcp__get_investment_accounts_${i}`));
  });

  test("the pane keeps its roles and labels with deep data (group role, label, Form | JSON toggle)", () => {
    render(<Json value={toolsList(2)} label="Response from the gateway" testId="resp" />);
    expect(screen.getByRole("group", { name: "Response from the gateway" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Response from the gateway view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Form" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "false");
  });
});

// jsdom does no layout, so the layout rules are pinned in the stylesheet text. This is the bug that made the Form view 9,000px tall:
// a `.jform[data-depth] .jform__row` rule gave every row of every level a 40% label column and beat the stacking rule on specificity.
describe("JsonPane.css: the Form layout rules", () => {
  const css = readFileSync(join(import.meta.dirname, "JsonPane.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
  const specificity = (sel) => (sel.match(/[.[:]/g) || []).length;

  test("no rule out-specifies the stacking rule for a row's columns", () => {
    const nested = rules.find((r) => r.sel === '.jform__row[data-nested="true"]');
    expect(nested).toBeDefined();
    const colsRules = rules.filter((r) => /grid-template-columns/.test(r.body) && /\.jform__row/.test(r.sel));
    expect(colsRules.length).toBeGreaterThan(1);
    for (const r of colsRules) expect(specificity(r.sel), r.sel).toBeLessThanOrEqual(specificity(nested.sel));
  });

  test("the scalar label column is capped, and the stylesheet keeps the family CSS rules (tokens, no !important, no italics, 600px breakpoint)", () => {
    expect(css).toMatch(/\.jform__row \{[^}]*grid-template-columns: minmax\(0, clamp\(96px, 24%, 220px\)\) minmax\(0, 1fr\)/);
    expect(css).not.toMatch(/!important|italic|#[0-9a-f]{3,8}\b|rgba?\(|hsl\(/i);
    expect(css).not.toMatch(/@media[^{]*\b(480|500|520)px/);
  });
});
