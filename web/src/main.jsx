import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled with the app (the page loads nothing from outside it): Montserrat for text, IBM Plex Mono for code.
import "@fontsource/montserrat/300.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
// The family's shared stylesheet first (tokens, controls, dark mode, banner), then this app's own layout.
import "./standalone-ui.css";
import "./app.css";
import AppShell from "./AppShell";
import { SessionProvider } from "./session";
import { initPresenter } from "./presenter";
import HomePage from "./pages/HomePage";
import PoliciesPage from "./pages/PoliciesPage";
import ConsolePage from "./pages/ConsolePage";
import ApprovalsPage from "./pages/ApprovalsPage";
import TracePage from "./pages/TracePage";
import LearnPage from "./pages/LearnPage";
import DiagramPage from "./pages/DiagramPage";

// No router: the page is picked by path (the server answers every path with index.html).
const ROUTES = { "/policies": PoliciesPage, "/console": ConsolePage, "/approvals": ApprovalsPage, "/trace": TracePage, "/learn": LearnPage, "/diagram": DiagramPage };
const Page = ROUTES[window.location.pathname.replace(/\/+$/, "")] || HomePage;
initPresenter();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SessionProvider>
      <AppShell><Page /></AppShell>
    </SessionProvider>
  </StrictMode>,
);
