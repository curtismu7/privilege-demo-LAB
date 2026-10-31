// Who is signed in. Mock mode: a persona cookie; the picker is offered only when the server says it is available.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

export const SessionContext = createContext({ status: "anon", me: null, config: null, refresh: () => {}, signIn: async () => ({}), signOut: async () => {} });
export const useSession = () => useContext(SessionContext);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: "loading", me: null, config: null });
  const refresh = useCallback(async () => {
    const [cfg, me] = await Promise.all([api("/api/auth/config"), api("/api/me")]);
    setState({ status: me.ok ? "in" : "anon", me: me.ok ? me.data : null, config: cfg.ok ? cfg.data : null });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const signIn = useCallback(async (persona) => {
    const r = await api("/api/auth/mock/login", { method: "POST", body: { persona } });
    if (r.ok) await refresh();
    return r;
  }, [refresh]);
  const signOut = useCallback(async () => { await api("/api/auth/logout", { method: "POST" }); await refresh(); }, [refresh]);
  const value = useMemo(() => ({ ...state, refresh, signIn, signOut }), [state, refresh, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
