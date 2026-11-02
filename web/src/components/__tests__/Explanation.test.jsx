// The explanation card renders what the server built. The fixtures are produced by the server's golden test (UPDATE_GOLDEN=1), never hand-written.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PEOPLE, renderAs } from "../../testUtils";
import Explanation from "../Explanation";
import fixtures from "./fixtures/explanations.json";

const show = (key, props = {}) => render(<Explanation explanation={fixtures[key]} {...props} />);
const section = (name) => screen.getByRole("heading", { name, level: 4 }).closest("section");

describe("Explanation", () => {
  it("an allow: headline, who, what, why and the rules checked, with nothing to change", () => {
    show("A-allow");
    expect(screen.getByText(/^Allowed\. Mark may use book_fare here/)).toBeInTheDocument();
    expect(within(section("Who asked")).getByText(/Mark, in the group travel-agents/)).toBeInTheDocument();
    expect(within(section("What was asked")).getByText(/book_fare \(booking app\), amount 800\. Attended/)).toBeInTheDocument();
    expect(within(section("Why")).getByText(/Travel agents may book fares/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What would change the answer" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Approval" })).toBeNull();
    const rules = section("Rules checked (6)");
    expect(within(rules).getByRole("heading", { name: "Decided this" })).toBeInTheDocument();
    expect(within(rules).getByText("Allowed it")).toBeInTheDocument();
    expect(within(rules).getAllByText("Did not apply").length).toBeGreaterThanOrEqual(1);
    expect(within(rules).getByText(/^the amount 800 is not over 1000$/)).toBeInTheDocument();
    expect(within(rules).getByText(/2 rules are about other tools/)).toBeInTheDocument();
  });

  it("a default deny says that no rule allowed it, and what would change that", () => {
    show("B-default-deny");
    expect(screen.getByText(/^Denied\. No rule allows Mark to use pay_invoice/)).toBeInTheDocument();
    expect(within(section("Why")).getByText(/This is called default deny\./)).toBeInTheDocument();
    expect(within(section("What would change the answer")).getByText(/Mark were in the finance group and the token had the payments:write scope/)).toBeInTheDocument();
    expect(screen.getByText("Mark is not in the finance group")).toBeInTheDocument();
  });

  it("a block rule that beats an allow rule names both, and an approval cannot lift it", () => {
    show("C-block-overrides-allow");
    const rules = section("Rules checked (6)");
    expect(within(rules).getByText("Blocked it")).toBeInTheDocument();
    expect(within(rules).getByText("Would have allowed it, but a block rule beat it")).toBeInTheDocument();
    expect(within(section("What would change the answer")).getByText(/an approval cannot lift it/)).toBeInTheDocument();
  });

  it("a hold names who approves and where, with a link to the Approvals page", () => {
    show("D-hold");
    expect(screen.getByText("Held. Priya must approve this before book_fare runs.")).toBeInTheDocument();
    const approval = section("Approval");
    expect(within(approval).getByText(/sign in as Priya/)).toBeInTheDocument();
    expect(within(approval).getByRole("link", { name: "Open Approvals" })).toHaveAttribute("href", "/approvals");
    expect(within(section("Rules checked (6)")).getByText("Held it for approval")).toBeInTheDocument();
  });

  it("a hold read by the approver does not tell them to sign in as themselves", () => {
    renderAs(<Explanation explanation={fixtures["D-hold"]} />, { me: PEOPLE.priya });
    const text = section("Approval").textContent;
    expect(text).toContain("you are signed in as Priya");
    expect(text).not.toContain("sign in as Priya");
    expect(text).toContain("Priya can approve it on the Approvals page");
  });

  it("a hold with no way through says so", () => {
    show("D2-hold-no-way-through");
    expect(screen.getByText(/even with an approval no rule would allow this/)).toBeInTheDocument();
    expect(screen.getByText("Would hold it, but the call is denied anyway")).toBeInTheDocument();
  });

  it("a refusal before any rule has no rules section", () => {
    show("F-before-rules");
    expect(screen.getByText("Denied before any rule was checked.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Rules checked/ })).toBeNull();
  });

  it("the technical details fold holds the raw facts (and can be left out)", () => {
    const { unmount } = show("C-block-overrides-allow");
    const tech = screen.getByText("Technical details").closest("details");
    expect(within(tech).getByText("Deciding policy")).toBeInTheDocument();
    expect(within(tech).getAllByText("s23-forbid-over-cap").length).toBeGreaterThan(0);
    unmount();
    show("C-block-overrides-allow", { showTechnical: false });
    expect(screen.queryByText("Technical details")).toBeNull();
  });

  it("every status chip carries a word, and no state is told by colour alone", () => {
    for (const key of Object.keys(fixtures)) {
      const { container, unmount } = show(key);
      for (const chip of container.querySelectorAll(".rule-chip")) {
        expect(chip.textContent.trim().length, `${key} ${chip.dataset.state}`).toBeGreaterThan(3);
        expect(chip.dataset.state).toMatch(/^(allowed|overridden|blocked|held|hold-moot|not-applied|not-about-tool)$/);
      }
      unmount();
    }
  });

  it("when the server could not build one, it says so and nothing else", () => {
    render(<Explanation explanation={{ v: 1, error: true, outcome: "deny", text: "An explanation could not be built. The decision above is not affected." }} />);
    expect(screen.getByText(/could not be built/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Why" })).toBeNull();
  });

  it("claim text is rendered as plain text, never as markup", () => {
    const ex = { ...fixtures["A-allow"], who: { ...fixtures["A-allow"].who, text: "<img src=x onerror=alert(1)> group" } };
    const { container } = render(<Explanation explanation={ex} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
});
