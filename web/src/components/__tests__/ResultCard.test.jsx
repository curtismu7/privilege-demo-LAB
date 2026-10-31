import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ResultCard from "../ResultCard";

const deny = { outcome: "deny", rule: "s23-forbid-over-cap", reason: "Hard cap: no booking over 10000 for anyone", rules: ["s23-forbid-over-cap", "s01-hold-large-fare"], overridden: ["s23-permit-travel-agents"] };

describe("ResultCard", () => {
  it("headlines the deciding policy, lists every forbid that fired, and lists the overridden policies", () => {
    render(<ResultCard title="PEP decision" res={deny} />);
    const card = screen.getByRole("region", { name: "PEP decision" });
    expect(within(card).getByText("Deciding policy").nextSibling).toHaveTextContent("s23-forbid-over-cap");
    expect(within(card).getByText("All forbids that fired").nextSibling).toHaveTextContent("s01-hold-large-fare");
    expect(within(card).getByText("Overridden policies").nextSibling).toHaveTextContent("s23-permit-travel-agents");
  });
  it("says none when nothing was overridden", () => {
    render(<ResultCard title="PEP decision" res={{ ...deny, rules: [], overridden: [] }} />);
    expect(screen.getByText("Overridden policies").nextSibling).toHaveTextContent("none");
  });
});
