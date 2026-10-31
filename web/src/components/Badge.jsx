// Outcome and state chips. Meaning is in the words, never in the colour alone.
const LABEL = { allow: "Allow", deny: "Deny", hold: "Hold", error: "Error", pending: "Pending", approved: "Approved", denied: "Denied", expired: "Expired" };
export default function Badge({ kind, children }) {
  return <span className="badge" data-state={kind}>{children ?? LABEL[kind] ?? kind}</span>;
}
