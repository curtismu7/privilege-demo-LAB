import { useSession } from "../session";

// The simulation banner (rule 2), on every page and in presenter mode. It says what is simulated, and the same mode the toggle shows.
export default function ModeBanner() {
  const { config } = useSession();
  const mode = config?.mode ?? "mock";
  return (
    <p className="banner" data-state={mode} role="note" data-testid="mode-banner">
      {mode === "mock" ? (
        <><strong>Mock mode, simulated.</strong> The sign-in, the access tokens (signed by an in-process mock issuer, not PingFederate) and every tool backend are made up here, and nothing leaves this machine. The Cedar decisions are real.</>
      ) : (
        <><strong>Live mode.</strong> Bearer access tokens are verified against the PingFederate you configured, and only that server is contacted. Tool backends are still mocks. Whether your PingFederate puts <code>groups</code> and an object-valued <code>act</code> in access tokens is UNVERIFIED.</>
      )}
    </p>
  );
}
