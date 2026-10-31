// Who is signed in, and which mode the app is in. Mock mode: a persona cookie; the picker is offered only when the server says it is available.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

export const SessionContext = createContext({ status: "anon", me: null, config: null, refresh: () => {}, signIn: async () => ({}), signOut: async () => {}, setMode: async () => ({}) });
export const useSession = () => useContext(SessionContext);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: "loading", me: null, config: null });
  const refresh = useCallback(async () => {
    // /api/session answers 200 with me: null when nobody is signed in (a 401 would be logged as a console error).
    const [cfg, session] = await Promise.all([api("/api/auth/config"), api("/api/session")]);
    const me = session.ok ? session.data?.me ?? null : null;
    setState({ status: me ? "in" : "anon", me, config: cfg.ok ? cfg.data : null });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const signIn = useCallback(async (persona) => {
    const r = await api("/api/auth/mock/login", { method: "POST", body: { persona } });
    if (r.ok) await refresh();
    return r;
  }, [refresh]);
  const signOut = useCallback(async () => { await api("/api/auth/logout", { method: "POST" }); await refresh(); }, [refresh]);
  // The Mock/Live toggle. Returns the server's answer; a refusal (live needs PF settings) carries the fix in data.liveFix.
  const setMode = useCallback(async (mode) => {
    // Live without settings is known from the config, so say so without sending a request that would answer 409.
    if (mode === "live" && state.config?.liveReady === false) return { ok: false, status: 409, data: { error: "live_not_configured", ...(state.config.liveFix ? { liveFix: state.config.liveFix } : {}) } };
    const r = await api("/api/mode", { method: "PUT", body: { mode } });
    await refresh();
    return r;
  }, [refresh, state.config]);
  const value = useMemo(() => ({ ...state, refresh, signIn, signOut, setMode }), [state, refresh, signIn, signOut, setMode]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
