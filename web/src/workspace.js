// The workspace id (rule 13): lowercase letters, digits and hyphens, default "default". Remembered in this browser only; the server
// scopes the policies, approvals, trace and sign-in by the X-Workspace header the api() wrapper sends.
export const DEFAULT_WORKSPACE = "default";
const KEY = "privdemo.workspace";
export const validWorkspace = (id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(id);

export function getWorkspace() {
  try { const id = localStorage.getItem(KEY); if (validWorkspace(id)) return id; } catch { /* storage blocked */ }
  return DEFAULT_WORKSPACE;
}
export function setWorkspace(id) {
  if (!validWorkspace(id)) return false;
  try { localStorage.setItem(KEY, id); } catch { return false; }
  return true;
}
