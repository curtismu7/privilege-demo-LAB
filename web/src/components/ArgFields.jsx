import { useId } from "react";

// Argument inputs built from a tool's inputSchema. Integers stay numbers; an empty number field is sent as "" so the server's
// argument check (not the form) is what refuses it. A property with an enum is a list to pick from.
const DEFAULTS = {
  search_flights: { query: "SFO to JFK" },
  create_ticket: { subject: "Seat change request" },
  pay_invoice: { invoiceId: "INV-1001", amount: 250 },
  book_fare: { flightId: "FL200", amount: 2400 },
};
/** Sample arguments for a tool. A vertical pack passes its own table (`packDefaults`); the original tools use the built-in one. */
export const defaultArgs = (tool, packDefaults = null) => ({ ...((packDefaults ?? DEFAULTS)[tool?.name] ?? {}) });

export default function ArgFields({ tool, args, onChange }) {
  const uid = useId();
  if (!tool) return null;
  return (
    <>
      {Object.entries(tool.inputSchema?.properties ?? {}).map(([k, spec]) => {
        const num = spec.type === "integer";
        if (spec.enum) {
          return (
            <label key={k} className="field">{k}
              <select id={`${uid}-${k}`} value={args[k] ?? ""} onChange={(e) => onChange({ ...args, [k]: e.target.value })}>
                {spec.enum.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          );
        }
        return (
          <label key={k} className="field">{k}
            <input id={`${uid}-${k}`} type={num ? "number" : "text"} min={num ? 0 : undefined} step={num ? 1 : undefined}
              value={args[k] ?? ""} onChange={(e) => onChange({ ...args, [k]: num ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value })} />
          </label>
        );
      })}
    </>
  );
}
