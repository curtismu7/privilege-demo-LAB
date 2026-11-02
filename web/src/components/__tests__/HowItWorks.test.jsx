import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HowItWorks, { HOWTO_KEY } from "../HowItWorks";

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.restoreAllMocks(); });

describe("How this works", () => {
  it("shows three steps, hides, and can be re-opened", () => {
    render(<HowItWorks />);
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/A person, or their agent, asks to use a tool/)).toBeInTheDocument();
    expect(screen.getByText(/Allow \(the tool runs\), Deny \(it does not\) or Hold/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("heading", { name: "How this works" })).toBeNull();
    const reopen = screen.getByRole("button", { name: "How this works" });
    expect(reopen).toHaveAttribute("aria-expanded", "false");
    expect(reopen).not.toHaveAttribute("aria-controls"); // nothing with that id is on the page while it is hidden
    fireEvent.click(reopen);
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
  });

  it("remembers the choice for the next visit", () => {
    const first = render(<HowItWorks />);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(localStorage.getItem(HOWTO_KEY)).toBe("hidden");
    first.unmount();
    render(<HowItWorks />);
    expect(screen.queryByRole("heading", { name: "How this works" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How this works" }));
    expect(localStorage.getItem(HOWTO_KEY)).toBeNull();
  });

  it("with storage that throws on read and write it still renders expanded and still hides for the session", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<HowItWorks />);
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("heading", { name: "How this works" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How this works" }));
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
  });
});
