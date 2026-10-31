// Workspaces (rule 13). A workspace id (default "default") scopes the policy store, approvals, drift, trace, audit log and sign-in.
// Reset clears the current workspace only. State is created on first use; the number of workspaces is capped.
export const DEFAULT_WORKSPACE = 'default';
export const MAX_WORKSPACES = 20;
export const WORKSPACE_HEADER = 'x-workspace';
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const validWorkspace = (id) => typeof id === 'string' && ID.test(id);

export class WorkspaceError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

// build(id) returns the workspace's state object (store, approvals, sink, ...); reset(state) clears it.
export function createWorkspaces({ build, reset, max = MAX_WORKSPACES }) {
  const all = new Map();
  return {
    get(id = DEFAULT_WORKSPACE) {
      if (!validWorkspace(id)) throw new WorkspaceError('bad_workspace', 400);
      let ws = all.get(id);
      if (!ws) {
        if (all.size >= max) throw new WorkspaceError('too_many_workspaces', 429);
        ws = build(id);
        all.set(id, ws);
      }
      return ws;
    },
    peek: (id = DEFAULT_WORKSPACE) => all.get(id) ?? null,
    ids: () => [...all.keys()],
    reset(id) { return reset(this.get(id)); },
  };
}
