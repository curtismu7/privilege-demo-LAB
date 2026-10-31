import { useState } from "react";
import { getWorkspace, setWorkspace, validWorkspace } from "../workspace";

// The workspace id (rule 13) in the header. Changing it reloads the page: each workspace has its own sign-in, policies, approvals and trace.
export default function WorkspaceField() {
  const current = getWorkspace();
  const [draft, setDraft] = useState(current);
  const [problem, setProblem] = useState("");
  const apply = () => {
    if (draft === current) return;
    if (!validWorkspace(draft)) { setProblem("Use lowercase letters, digits and hyphens (1 to 32)."); return; }
    if (setWorkspace(draft)) window.location.reload(); else setProblem("This browser would not remember it.");
  };
  return (
    <label className="workspace-field">Workspace
      <input type="text" value={draft} maxLength={32} spellCheck={false} onChange={(e) => { setDraft(e.target.value); setProblem(""); }}
        onBlur={apply} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} aria-invalid={problem ? "true" : undefined} />
      {problem && <span role="alert" className="mode-toggle__problem">{problem}</span>}
    </label>
  );
}
