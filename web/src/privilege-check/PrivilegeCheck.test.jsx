// PrivilegeCheck tests (vitest + Testing Library + jsdom). Run where the folder is vendored
// (web/src/privilege-check/). fetch is stubbed: nothing here calls a network.
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import PrivilegeCheck from "./PrivilegeCheck";

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

const LISTED = {
  gateway: "https://gateway.example", app: "demo-door", caller: "demo_agent",
  listing: { ok: true, ms: 12, tools: [{ name: "whoami" }, { name: "echo" }], serverInfo: { name: "fake" } },
  refusal: { ok: false, refusal: { layer: "policy", status: 403, message: "not granted" } },
};
const REFUSED = {
  gateway: "https://gateway.example", app: "demo-door", caller: "demo_agent",
  listing: { ok: false, refusal: { layer: "key", status: 401, message: "bad key" } },
};

// A lab answers GET /api/info, then POST /api/gateway-check.
function stub({ info = { realAvailable: true }, check = json(LISTED), infoFails = false } = {}) {
  const fn = vi.fn(async (url) => {
    if (String(url).endsWith("/api/info")) { if (infoFails) throw new Error("network down"); return json(info); }
    return check;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PrivilegeCheck without onResult (default behaviour)", () => {
  test("renders the listing and the refusal probe, and makes the same two calls", async () => {
    const fn = stub();
    render(<PrivilegeCheck />);
    await screen.findByText(/2 tools in 12 ms/);
    expect(screen.getByText("demo_agent")).toBeInTheDocument();
    expect(fn.mock.calls.map((c) => c[0])).toEqual(["/api/info", "/api/gateway-check"]);
  });
});

describe("PrivilegeCheck onResult", () => {
  test("success: called once with the object the card renders", async () => {
    stub();
    const onResult = vi.fn();
    render(<PrivilegeCheck onResult={onResult} />);
    await screen.findByText(/2 tools in 12 ms/);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ phase: "done", ...LISTED });
  });

  test("refusal: a gateway refusal is a completed check and is passed on with its refusal shape", async () => {
    stub({ check: json(REFUSED) });
    const onResult = vi.fn();
    render(<PrivilegeCheck onResult={onResult} />);
    await screen.findByText(/was refused by the gateway/);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ phase: "done", ...REFUSED });
  });

  test("error: the lab answering with an error status is passed on with the reason the card shows", async () => {
    stub({ check: json({ message: "Real is not set up" }, 409) });
    const onResult = vi.fn();
    render(<PrivilegeCheck onResult={onResult} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Real is not set up");
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ phase: "error", reason: "Real is not set up" });
  });

  test("error: a thrown fetch is passed on too, once", async () => {
    stub({ infoFails: true });
    const onResult = vi.fn();
    render(<PrivilegeCheck onResult={onResult} />);
    await screen.findByRole("alert");
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ phase: "error", reason: "network down" });
  });

  test("not configured: passed on with the honest reason, and the gateway is never called", async () => {
    const fn = stub({ info: { realAvailable: false, realReason: "Set the gateway settings." } });
    const onResult = vi.fn();
    render(<PrivilegeCheck onResult={onResult} />);
    await screen.findByText("Set the gateway settings.");
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ phase: "not-configured", reason: "Set the gateway settings." });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("not called while the check is still running", async () => {
    let release;
    const fn = vi.fn(async (url) => {
      if (String(url).endsWith("/api/info")) return json({ realAvailable: true });
      await new Promise((r) => { release = r; });
      return json(LISTED);
    });
    vi.stubGlobal("fetch", fn);
    const onResult = vi.fn();
    render(<PrivilegeCheck onResult={onResult} />);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(onResult).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
  });

  test("Run the gateway check again: one more call per completed check, none extra on a re-render", async () => {
    stub();
    const onResult = vi.fn();
    const { rerender } = render(<PrivilegeCheck onResult={onResult} />);
    await screen.findByText(/2 tools in 12 ms/);
    const next = vi.fn();
    rerender(<PrivilegeCheck onResult={next} />);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run the gateway check" }));
    await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  test("a callback that throws does not change what the card shows or fire a second time", async () => {
    stub();
    const onResult = vi.fn(() => { throw new Error("lab bug"); });
    render(<PrivilegeCheck onResult={onResult} />);
    await screen.findByText(/2 tools in 12 ms/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});
