import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import StoryPanel, { PageStories } from "../StoryPanel";
import { reloadStoryPrefs } from "../useStoryPrefs";

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } act(() => reloadStoryPrefs()); });

describe("StoryPanel", () => {
  it("renders nothing for an unknown story", () => {
    const { container } = render(<StoryPanel id="S99" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the generic S04 with the first step open and the proof", () => {
    render(<StoryPanel id="S04" />);
    expect(screen.getByRole("heading", { name: "Mary gets 2 of 3 tools" })).toBeInTheDocument();
    expect(screen.getByText(/Pick Mary on the sign-in page/)).toBeInTheDocument();
    expect(screen.getByText(/The result card for pay_invoice as the finance user/)).toBeInTheDocument();
    expect(screen.queryByText(/⟨missing/)).toBeNull();
  });

  it("re-skins nouns when a vertical is picked, and remembers it", () => {
    const { unmount } = render(<StoryPanel id="S04" />);
    fireEvent.change(screen.getByLabelText("Vertical"), { target: { value: "banking" } });
    expect(screen.getByText(/Research, Service Cases and Payments at the bank/)).toBeInTheDocument();
    expect(screen.getByText("Story S04 · Bank")).toBeInTheDocument();
    unmount();
    render(<StoryPanel id="S04" />);
    expect(screen.getByLabelText("Vertical")).toHaveValue("banking");
  });

  it("switches to the blocked wording only on steps that have it", () => {
    render(<StoryPanel id="S04" />);
    fireEvent.click(screen.getByRole("button", { name: "Blocked" }));
    expect(screen.getByRole("button", { name: "Blocked" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Payments/ }));
    expect(screen.getByText(/says deny: no permit covers her/)).toBeInTheDocument();
    expect(screen.getByText(/The result card for pay_invoice as Mary: deny/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Search is allowed/ }));
    expect(screen.getByText(/Search works, and the card names the rule/)).toBeInTheDocument();
    expect(screen.getAllByText("blocked")).toHaveLength(1);
  });

  it("hides and shows the talk track", () => {
    render(<StoryPanel id="S05" />);
    const btn = screen.getByRole("button", { name: "Hide talk track" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(btn);
    expect(screen.queryByText(/Goal/)).toBeNull();
    expect(screen.getByRole("button", { name: "Show talk track" })).toHaveAttribute("aria-expanded", "false");
  });

  it("PageStories renders every story that names the page", () => {
    render(<PageStories page="console" defaultOpen />);
    expect(screen.getAllByTestId(/^story-/).map((n) => n.dataset.testid)).toEqual(["story-S01", "story-S04", "story-S05"]);
  });

  it("two panels share the vertical choice", () => {
    render(<PageStories page="policies" defaultOpen />);
    fireEvent.change(screen.getAllByLabelText("Vertical")[0], { target: { value: "airlines" } });
    expect(screen.getAllByLabelText("Vertical").map((s) => s.value)).toEqual(["airlines", "airlines"]);
  });

  // The steps are a selector, not actions: the current one carries the shared selected state (aria-pressed, UI patterns section 9),
  // not aria-current. A native <button> is activated by Enter and Space in a browser (jsdom does not synthesize that click).
  it("the steps are a named group of native buttons; aria-pressed marks the current step and moves on click", () => {
    render(<StoryPanel id="S05" />);
    const group = screen.getByRole("group", { name: "Talk track steps" });
    expect(within(group).getByRole("list")).toBeInTheDocument();
    const steps = within(group).getAllByRole("button");
    expect(steps.length).toBeGreaterThan(2);
    steps.forEach((b) => { expect(b.tagName).toBe("BUTTON"); expect(b).not.toHaveAttribute("aria-current"); });
    expect(steps.map((b) => b.getAttribute("aria-pressed"))).toEqual(steps.map((_, i) => (i === 0 ? "true" : "false")));
    fireEvent.click(steps[2]);
    expect(steps.map((b) => b.getAttribute("aria-pressed"))).toEqual(steps.map((_, i) => (i === 2 ? "true" : "false")));
    expect(steps.some((b) => b.classList.contains("primary"))).toBe(false);
  });

  it("the Allowed and Blocked switch is a separate named group", () => {
    render(<StoryPanel id="S05" />);
    expect(within(screen.getByRole("group", { name: "Story path" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Allowed", "Blocked"]);
  });
});
