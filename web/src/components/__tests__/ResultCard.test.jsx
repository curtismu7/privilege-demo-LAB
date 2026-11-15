import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ResultCard from "../ResultCard";
import { setJsonView } from "../JsonPane";

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

describe("ResultCard tool result (Rule 24: the shared JsonPane)", () => {
  const allow = { outcome: "allow", rule: "s23-permit-travel-agents", reason: "ok", rules: [], overridden: [], result: { confirmation: "BK-ABC123", flightId: "FL200", amount: 2400, status: "booked" } };
  afterEach(() => setJsonView("form"));

  it("shows the exact JSON, in full, with a Form | JSON toggle and this lab's keys marked", () => {
    setJsonView("raw");
    render(<ResultCard title="PEP decision" res={allow} />);
    const pane = screen.getByLabelText("Tool result");
    expect(pane.tagName).toBe("PRE");
    expect(pane.textContent).toBe(JSON.stringify(allow.result, null, 2));
    expect(within(pane).getByText('"status"')).toHaveClass("jtok--hot");
    expect(within(pane).getByText('"confirmation"')).toHaveClass("jtok--key");
    expect(screen.getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Form" })).toHaveAttribute("aria-pressed", "false");
  });

  it("the Form view is a label and a value per field, and the toggle switches to the JSON text", () => {
    setJsonView("form");
    render(<ResultCard title="PEP decision" res={allow} />);
    const form = screen.getByLabelText("Tool result");
    expect(form.tagName).toBe("DIV");
    const hot = [...form.querySelectorAll('[data-hot="true"]')].map((row) => row.textContent);
    expect(hot).toEqual([expect.stringContaining("amount"), expect.stringContaining("status")]);
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.getByLabelText("Tool result").tagName).toBe("PRE");
  });
});
