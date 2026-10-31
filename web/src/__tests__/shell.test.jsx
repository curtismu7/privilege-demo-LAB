import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppShell from "../AppShell";

describe("AppShell", () => {
  it("renders the brand bar, nav and children", () => {
    render(<AppShell><p>hello</p></AppShell>);
    expect(screen.getByText("Privilege demo LAB")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Site" })).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("the theme picker only sets data-theme; Auto removes it", () => {
    render(<AppShell />);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "light" } });
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "auto" } });
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
