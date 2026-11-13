// Pattern from id-jag-standalone web/src/AppShell.jsx: dark bar, page nav, the Mock/Live toggle, workspace, presenter and theme controls,
// the signed-in persona and group badges, and the simulation banner under the bar on every page.
import { useEffect, useState } from "react";
import { PERSONAS } from "./api";
import { useSession } from "./session";
import { usePack } from "./pack";
import { useCastName, useCustomer } from "./customer";
import { setPresenter, usePresenter } from "./presenter";
import ShelfLink from "./components/ShelfLink";
import WorkspaceField from "./components/WorkspaceField";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import ModeBanner from "./components/ModeBanner";

const THEME_KEY = "privdemo.theme";
const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
export const PAGES = [
  ["/", "Sign in"], ["/policies", "AI Policies"], ["/console", "Tool console"], ["/approvals", "Approvals"],
  ["/trace", "Trace"], ["/learn", "Learn"], ["/diagram", "Diagram"],
];
const currentPage = () => {
  const p = window.location.pathname;
  return PAGES.slice(1).find(([href]) => p === href || p.startsWith(`${href}/`))?.[0] || "/";
};

function initialTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") return t; } catch { /* storage blocked */ }
  return "auto";
}

export default function AppShell({ children }) {
  const [theme, setTheme] = useState(initialTheme);
  const [modeNote, setModeNote] = useState("");
  const [fontStep, setFontStep] = useState(() => { try { return localStorage.getItem("pdemo.font") || "M"; } catch { return "M"; } });
  useEffect(() => { applyFontSize(fontStep); try { localStorage.setItem("pdemo.font", fontStep); } catch { /* blocked */ } }, [fontStep]);
  const { me, signOut, status, config, setMode } = useSession();
  const pack = usePack();
  const customer = useCustomer();
  const castName = useCastName();
  const presenter = usePresenter();
  const here = currentPage();
  // The picker only sets data-theme; the shared stylesheet does the rest ("auto" follows the system setting).
  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.title = customer.name; }, [customer.name]);
  useEffect(() => {
    if (!presenter) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setPresenter(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenter]);
  const pickTheme = (next) => {
    try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  };
  const name = me ? castName(me.persona, me.name ?? PERSONAS[me.persona]?.name ?? me.sub) : null;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="shell-bar">
        <a className="shell-brand" href="/">
          <img src="/branding/ping-logo.png" alt="Ping Identity" />
          <span>{customer.name}</span>
        </a>
        {!presenter && (
          <nav aria-label="Site" className="shell-nav">
            {PAGES.map(([href, label]) => <a key={href} href={href} aria-current={href === here ? "page" : undefined}>{label}</a>)}
          </nav>
        )}
        <div className="shell-tools">
          <TopMenu
            mode={{ value: config?.mode === "live" ? "real" : "mock", onChange: (m) => { const want = m === "real" ? "live" : "mock"; if (want === (config?.mode || "mock")) return; const r = setMode(want); if (r?.then) r.then((res) => { if (res && res.ok === false) setModeNote(res.data?.liveFix || "Live is not configured."); }); }, realAvailable: config ? config.mode === "live" || config.liveReady !== false : null, realHint: config?.liveFix || undefined }}
            theme={{ value: theme, onChange: pickTheme }}
            fontSize={{ value: fontStep, onChange: setFontStep }}
            present={{ active: !!presenter, onToggle: () => setPresenter(!presenter), label: "Presenter" }}
            help={{ href: "https://github.com/curtismu7/privilege-demo-LAB#readme" }}
            version={config?.version || null}
          >
            <WorkspaceField />
            <ShelfLink />
          </TopMenu>
          {status === "anon" && <a className="shell-signin" href="/">Sign in</a>}
        </div>
        {me && (
          <p className="shell-user" data-testid="shell-user">
            <span>Signed in as <strong>{name}</strong></span>
            {me.groups.map((g) => <span key={g} className="shell-badge">{g}</span>)}
            <button type="button" onClick={signOut}>Sign out</button>
          </p>
        )}
      </header>
      {modeNote && <p className="notice" role="alert">{modeNote}</p>}
      <ModeBanner />
      {pack.notice && <p className="banner" role="note" data-testid="pack-notice"><strong>{pack.id === "utility" ? "Demo pack" : "Pack"}:</strong> {pack.notice}</p>}
      <div id="main" tabIndex={-1}>{children}</div>
    </div>
  );
}
