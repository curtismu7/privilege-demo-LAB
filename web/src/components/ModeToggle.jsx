import { useState } from "react";
import { useSession } from "../session";

// The Mock/Live toggle (in the header of every page). It shows the current mode; Live without PF settings is refused with the fix.
export default function ModeToggle() {
  const { config, setMode } = useSession();
  const mode = config?.mode ?? "mock";
  const [problem, setProblem] = useState("");
  const choose = async (next) => {
    if (next === mode) return;
    setProblem("");
    const r = await setMode(next);
    if (!r.ok) setProblem(r.data?.liveFix ?? `The mode was not changed (${r.data?.reason ?? r.data?.error ?? r.status}).`);
  };
  return (
    <div className="mode-toggle">
      <div className="mode-toggle__group" role="group" aria-label="Mode">
        <button type="button" aria-pressed={mode === "mock"} onClick={() => choose("mock")}>Mock</button>
        <button type="button" aria-pressed={mode === "live"} onClick={() => choose("live")}>Live</button>
      </div>
      {problem && <p className="mode-toggle__problem" role="alert">{problem}</p>}
    </div>
  );
}
