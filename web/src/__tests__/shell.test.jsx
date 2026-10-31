import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppShell from "../AppShell";

describe("AppShell", () => {
  it("renders the brand bar, nav and children", () => {
    render(<AppShell><p>hello</p></AppShell>);
    expect(screen.getByText("Privilege demo LAB")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Site" })).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("flips the theme", () => {
    render(<AppShell />);
    act(() => screen.getByRole("button", { name: /switch to/i }).click());
    expect(["light", "dark"]).toContain(document.documentElement.dataset.theme);
  });
});
