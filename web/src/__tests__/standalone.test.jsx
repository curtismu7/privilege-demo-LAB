// The standalone-family rules in the page: Mock/Live toggle and banner on every page, presenter mode, workspace id, customer.config,
// the mock token, and the CSS standard. Server-side halves of each rule are tested in server/test/app.
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppShell, { PAGES } from "../AppShell";
import ConsolePage from "../pages/ConsolePage";
import LearnPage from "../pages/LearnPage";
import HomePage from "../pages/HomePage";
import { setPresenter } from "../presenter";
import { api } from "../api";
import { getWorkspace, setWorkspace, validWorkspace } from "../workspace";
import { mockApi, renderAs, PEOPLE, TOOLS, reply } from "../testUtils";
import { SessionContext } from "../session";
import { CAST_KEYS, VOCAB_KEYS } from "../../../server/src/customer.js";

const WEB = path.resolve(process.cwd(), "src");
const mock = { idp: "local-mock", mode: "mock", mockAvailable: true, bearer: true, liveReady: false };
const live = { idp: "pf", mode: "live", mockAvailable: false, bearer: true, liveReady: true };
const shell = (config, extra = {}) => renderAs(<AppShell><p>page</p></AppShell>, { config, ...extra });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { setPresenter(false); vi.unstubAllGlobals(); delete document.documentElement.dataset.theme; });

describe("Mock/Live toggle and banner, in the header of every page", () => {
  it("shows the current mode in the toggle and in the banner (mock)", () => {
    shell(mock);
    expect(screen.getByRole("button", { name: "Mock" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "false");
    const banner = screen.getByTestId("mode-banner");
    expect(banner).toHaveAttribute("data-state", "mock");
    expect(banner).toHaveTextContent(/Mock mode, simulated/);
    expect(banner).toHaveTextContent(/nothing leaves this machine/);
  });
  it("shows live in the toggle and in the banner (live), with the UNVERIFIED label", () => {
    shell(live);
    expect(screen.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-banner")).toHaveAttribute("data-state", "live");
    expect(screen.getByTestId("mode-banner")).toHaveTextContent(/UNVERIFIED/);
  });
  it("is there with no session at all (the default context is mock)", () => {
    render(<AppShell />);
    expect(screen.getByRole("group", { name: "Mode" })).toBeInTheDocument();
    expect(screen.getByTestId("mode-banner")).toHaveAttribute("data-state", "mock");
  });
  it("asks the server to switch, and shows the fix when live is refused", async () => {
    const setMode = vi.fn(async () => ({ ok: false, status: 409, data: { error: "live_not_configured", liveFix: "Set PF_URL and PF_AUDIENCE in ~/Development/.env, then restart." } }));
    const value = { status: "anon", me: null, config: mock, refresh: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), setMode };
    render(<SessionContext.Provider value={value}><AppShell /></SessionContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(setMode).toHaveBeenCalledWith("live");
    expect(await screen.findByRole("alert")).toHaveTextContent(/PF_URL and PF_AUDIENCE/);
    fireEvent.click(screen.getByRole("button", { name: "Mock" })); // already mock: no call
    expect(setMode).toHaveBeenCalledTimes(1);
  });
  it("every page in the nav is wrapped by the shell, so every page has the toggle (the shell is the only place it lives)", () => {
    const main = fs.readFileSync(path.join(WEB, "main.jsx"), "utf8");
    expect(main).toMatch(/<AppShell><Page \/><\/AppShell>/);
    expect(PAGES.length).toBeGreaterThanOrEqual(7);
  });
});

describe("presenter mode", () => {
  it("hides the nav, keeps the toggle and the banner, opens the talk track, and Esc leaves", () => {
    renderAs(<AppShell><LearnPage /></AppShell>, { config: mock });
    expect(screen.getByRole("navigation", { name: "Site" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Presenter" }));
    expect(document.documentElement.dataset.presenter).toBe("on");
    expect(screen.queryByRole("navigation", { name: "Site" })).toBeNull();
    expect(screen.getByRole("group", { name: "Mode" })).toBeInTheDocument();
    expect(screen.getByTestId("mode-banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Presenter" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.documentElement.dataset.presenter).toBeUndefined();
    expect(screen.getByRole("navigation", { name: "Site" })).toBeInTheDocument();
  });
});

describe("workspace id (rule 13)", () => {
  it("validates, remembers, and is sent as X-Workspace on every API call", async () => {
    expect(validWorkspace("acme-demo")).toBe(true);
    expect(validWorkspace("Bad Id")).toBe(false);
    expect(getWorkspace()).toBe("default");
    expect(setWorkspace("bad id")).toBe(false);
    expect(setWorkspace("acme-demo")).toBe(true);
    const calls = mockApi({ "GET /api/x": { ok: true } });
    await api("/api/x");
    expect(new Headers(globalThis.fetch.mock.calls[0][1].headers).get("x-workspace")).toBe("acme-demo");
    expect(calls).toHaveLength(1);
  });
  it("the header field refuses a bad id without reloading", () => {
    shell(mock);
    const input = screen.getByLabelText("Workspace");
    expect(input).toHaveValue("default");
    fireEvent.change(input, { target: { value: "Bad Id" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent(/lowercase letters/);
    expect(getWorkspace()).toBe("default");
  });
});

describe("customer.config on the page", () => {
  const customer = { name: "Harbor Agent Lab", tagline: "t", vertical: "banking", cast: { mark: "Alex", priya: "Sam" }, vocabulary: { bookItem: "a $9,999 charter flight" }, warnings: [] };
  it("brands the shell and renames the signed-in person", () => {
    renderAs(<AppShell><p>x</p></AppShell>, { config: { ...mock, customer }, me: PEOPLE.mark });
    expect(screen.getByText("Harbor Agent Lab")).toBeInTheDocument();
    expect(document.title).toBe("Harbor Agent Lab");
    expect(screen.getByTestId("shell-user")).toHaveTextContent("Signed in as Alex");
  });
  it("fills the story {{cast}} tokens with the customer's names and nouns, in the customer's default vertical", () => {
    renderAs(<LearnPage />, { config: { ...mock, customer } });
    const story = screen.getByTestId("story-S01");
    expect(story).toHaveTextContent("Alex's booking needs a second pair of eyes");
    expect(story).toHaveTextContent(/Sam/);
    expect(story).toHaveTextContent("a $9,999 charter flight");
    expect(story.textContent).not.toMatch(/⟨missing|\{\{/);
    expect(story).toHaveTextContent(/Story S01 · Bank/); // vertical banking from customer.config
  });
  it("renames the sign-in buttons", async () => {
    mockApi({ "GET /api/auth/mock/personas": { personas: [{ id: "mark", name: "Mark" }, { id: "priya", name: "Priya" }] }, "GET /api/preflight": { ok: true, checks: [] } });
    renderAs(<HomePage />, { config: { ...mock, customer } });
    expect(await screen.findByRole("button", { name: /Alex/ })).toBeInTheDocument();
  });
  it("the server's cast and vocabulary keys are exactly the ones the shipped verticals define", () => {
    const read = (p) => JSON.parse(fs.readFileSync(path.join(WEB, p), "utf8"));
    const files = [...fs.readdirSync(path.join(WEB, "data/verticals")).map((f) => `data/verticals/${f}`), "data/packs/utility/vertical.json"];
    const cast = new Set(); const vocab = new Set();
    for (const f of files) { const v = read(f); Object.keys(v.cast).forEach((k) => cast.add(k)); Object.keys(v.vocab).forEach((k) => vocab.add(k)); }
    expect([...cast].sort()).toEqual([...CAST_KEYS].sort());
    expect([...vocab].sort()).toEqual([...VOCAB_KEYS].sort());
  });
});

describe("the mock token card (mock mode, persona session only)", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
  it("gets a token, shows it whole and labelled mock, with an example call", async () => {
    mockApi({
      "GET /api/tools": { tools: TOOLS },
      "POST /api/mock/token": { mock: true, label: "mock token: signed by the in-process mock issuer, not by PingFederate", access_token: "aaa.bbb.ccc", expires_in: 600 },
    });
    renderAs(<ConsolePage />, { me: PEOPLE.mark, config: mock });
    fireEvent.click(await screen.findByRole("button", { name: "Get a mock token" }));
    expect(await screen.findByLabelText("Mock access token")).toHaveTextContent("aaa.bbb.ccc");
    expect(screen.getByText("MOCK TOKEN")).toBeInTheDocument();
    expect(screen.getByLabelText("Example call")).toHaveTextContent(/\/mcp/);
  });
  it("is not offered in live mode", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS } });
    renderAs(<ConsolePage />, { me: { ...PEOPLE.mark, source: "bearer" }, config: live });
    await screen.findByText("Tool console");
    expect(screen.queryByRole("button", { name: "Get a mock token" })).toBeNull();
  });
  it("says why the token was refused", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/mock/token": reply(403, { error: "mock_signin_refused", reason: "proxy_header" }) });
    renderAs(<ConsolePage />, { me: PEOPLE.mark, config: mock });
    fireEvent.click(await screen.findByRole("button", { name: "Get a mock token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/proxy_header/);
  });
});

describe("CSS standard (checked again by scripts/check-css.sh)", () => {
  const css = (f) => fs.readFileSync(path.join(WEB, f), "utf8");
  const appFiles = ["app.css", "DiagramView.css", "story/StoryPanel.css"];
  const canonical = path.join(process.env.HOME ?? "", "Development/AI-DEMO-Standalone/shared/standalone-ui.css");

  it("app CSS has no colour literal, prefers-color-scheme, !important or italics", () => {
    for (const f of appFiles) {
      const text = css(f);
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
      expect(text, f).not.toMatch(/prefers-color-scheme/);
      expect(text, f).not.toMatch(/!important/);
      expect(text, f).not.toMatch(/font-style:\s*italic/);
    }
  });
  it("uses only the two breakpoints 600px and 900px, and no id selectors or camelCase classes", () => {
    for (const f of appFiles) {
      const text = css(f);
      for (const m of text.matchAll(/@media[^{]*\((?:max|min)-width:\s*(\d+)px\)/g)) expect(["600", "900"], `${f} ${m[0]}`).toContain(m[1]);
      expect(text, f).not.toMatch(/(^|[\s,>+~])#[A-Za-z]/m);
      expect(text, f).not.toMatch(/\.[a-z]+[A-Z][A-Za-z0-9]*[\s,{:.>]/);
    }
  });
  it("every var(--token) the app CSS uses is defined by the shared stylesheet or by React Flow", () => {
    const shared = css("standalone-ui.css");
    const defined = new Set([...shared.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set(appFiles.flatMap((f) => [...css(f).matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])));
    const own = new Set(appFiles.flatMap((f) => [...css(f).matchAll(/(--xy-[a-z-]+)\s*:/g)].map((m) => m[1])));
    for (const token of used) expect(defined.has(token) || own.has(token), `${token} is not defined`).toBe(true);
  });
  it("the vendored shared stylesheet is byte-identical to the canonical copy (when the family checkout is present)", () => {
    if (!fs.existsSync(canonical)) return;
    expect(fs.readFileSync(path.join(WEB, "standalone-ui.css"))).toEqual(fs.readFileSync(canonical));
  });
  it("loads the shared stylesheet before the app stylesheet, and bundles its fonts (no outside request)", () => {
    const main = fs.readFileSync(path.join(WEB, "main.jsx"), "utf8");
    expect(main.indexOf("standalone-ui.css")).toBeGreaterThan(-1);
    expect(main.indexOf("standalone-ui.css")).toBeLessThan(main.indexOf('"./app.css"'));
    expect(main).toMatch(/@fontsource\/montserrat/);
    const html = fs.readFileSync(path.resolve(WEB, "../index.html"), "utf8");
    expect(html).not.toMatch(/https?:\/\//);
  });
  it("no JSX sets a style attribute, an inline colour or an italic element", () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "__tests__" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
    for (const f of walk(WEB).filter((x) => /\.jsx?$/.test(x) && !/\.test\./.test(x))) {
      const text = fs.readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/style=\{/);
      expect(text, f).not.toMatch(/<(em|i)[ >]/);
      expect(text, f).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
    }
  });
});
