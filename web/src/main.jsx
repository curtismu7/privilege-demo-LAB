import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AppShell from "./AppShell";
import { SessionProvider } from "./session";
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

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SessionProvider>
      <AppShell><Page /></AppShell>
    </SessionProvider>
  </StrictMode>,
);
