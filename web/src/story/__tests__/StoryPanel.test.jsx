import { act, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText(/deny with the rule default-deny/)).toBeInTheDocument();
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
});
