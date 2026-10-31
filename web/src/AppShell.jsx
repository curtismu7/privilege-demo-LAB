// Pattern from id-jag-standalone web/src/AppShell.jsx: Core Dark bar, Ping Red rule, page nav, theme switch,
// plus the signed-in persona and group badges.
import { useEffect, useState } from "react";
import { PERSONAS } from "./api";
import { useSession } from "./session";
import { usePack } from "./pack";
import "./AppShell.css";
import "./app.css";

const THEME_KEY = "privdemo.theme";
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
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function AppShell({ children }) {
  const [theme, setTheme] = useState(initialTheme);
  const { me, signOut } = useSession();
  const pack = usePack();
  const here = currentPage();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  };
  const name = me ? (me.name ?? PERSONAS[me.persona]?.name ?? me.sub) : null;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="shell-bar">
        <a className="shell-brand" href="/">
          <img src="/branding/ping-logo.png" alt="Ping Identity" />
          <span>Privilege demo LAB</span>
        </a>
        <nav aria-label="Site" className="shell-nav">
          {PAGES.map(([href, label]) => <a key={href} href={href} aria-current={href === here ? "page" : undefined}>{label}</a>)}
        </nav>
        {me && (
          <p className="shell-user" data-testid="shell-user">
            <span>Signed in as <strong>{name}</strong></span>
            {me.groups.map((g) => <span key={g} className="shell-badge">{g}</span>)}
            <button type="button" className="shell-theme" onClick={signOut}>Sign out</button>
          </p>
        )}
        <button type="button" className="shell-theme" onClick={flip} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>
      {pack.notice && <p className="pack-notice" role="note" data-testid="pack-notice"><strong>{pack.id === "utility" ? "Demo pack" : "Pack"}:</strong> {pack.notice}</p>}
      <div id="main" tabIndex={-1}>{children}</div>
    </div>
  );
}
