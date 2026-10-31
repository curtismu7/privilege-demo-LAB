import { useSession } from "../session";

// Wraps a page that needs a signed-in principal.
export default function RequireSignIn({ children }) {
  const { status } = useSession();
  if (status === "loading") return <main className="page"><p role="status">Loading…</p></main>;
  if (status === "anon") {
    return (
      <main className="page">
        <h1>Sign in first</h1>
        <p className="lede">This page decides and records things as a person, so it needs one. <a href="/">Go to sign in</a>.</p>
      </main>
    );
  }
  return children;
}
