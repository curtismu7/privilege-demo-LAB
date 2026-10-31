// The vertical pack the server runs (PACK=<id>). The original demo's wording lives here and in the page files, so with no pack
// information (generic, or a test with no config) every page reads exactly as before. A server pack that sends full data
// (groups, tools, sample arguments, people, scenarios) replaces it.
import { useMemo } from "react";
import { useSession } from "./session";
import { GROUPS, TEST_USERS, TOOL_NAMES } from "./claims";

export const GENERIC_PACK = {
  id: "generic",
  notice: null,
  groups: GROUPS,
  toolNames: TOOL_NAMES,
  testUsers: TEST_USERS,
  agent: { sub: "dot", label: "Dot (Mark's agent) makes the call, unattended", defaultOn: false },
  argDefaults: null,
  scenarios: [],
  personas: null,
};

/** The active pack: full data from the server for a vertical, the original constants otherwise. */
export function usePack() {
  const { config } = useSession();
  const p = config?.pack;
  return useMemo(() => (p && Array.isArray(p.groups) ? { ...GENERIC_PACK, ...p } : GENERIC_PACK), [p]);
}
