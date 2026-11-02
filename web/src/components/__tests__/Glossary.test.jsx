import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GLOSSARY, UI_TERMS } from "../../glossary";
import Glossary from "../Glossary";

describe("Glossary", () => {
  it("defines every word the screens use, in one or two short sentences", () => {
    const terms = GLOSSARY.map((g) => g.term);
    for (const t of UI_TERMS) expect(terms, t).toContain(t);
    for (const g of GLOSSARY) {
      expect(g.def.length, g.term).toBeGreaterThan(20);
      expect(g.def.split(/[.!?]\s/).length, g.term).toBeLessThanOrEqual(3);
    }
  });
  it("shows the Cedar words only as secondary labels", () => {
    const { container } = render(<Glossary />);
    for (const g of GLOSSARY) expect(container.textContent).toContain(g.term);
    expect(screen.getByText(/Cedar word: permit/)).toBeInTheDocument();
    expect(screen.getByText(/Cedar word: forbid/)).toBeInTheDocument();
    expect(screen.getByText(/Cedar word: PEP/)).toBeInTheDocument();
    expect(screen.getByText(/Cedar word: principal/)).toBeInTheDocument();
    // the definitions themselves use the plain words
    for (const g of GLOSSARY) expect(g.def).not.toMatch(/\b(permit|forbid|principal)\b/);
  });
});
