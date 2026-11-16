// This lab's gateway card: the family's shared PrivilegeCheck (vendored unchanged, see privilege-check.pin.test.js) plus the Rule 25
// "What Privilege did" panel. The panel is drawn from the card's own onResult answer, so the page makes no second gateway call.
import { useCallback, useState } from "react";
import PrivilegeCheck from "./PrivilegeCheck";
import GatewayTrace from "../gateway-trace/GatewayTrace";

export default function GatewayCheckCard(props) {
  const [exchanges, setExchanges] = useState(null);
  // Only a finished check that came with a trace shows one; a retry, an error or "not configured" clears the old one.
  const onResult = useCallback((r) => setExchanges(r?.phase === "done" && r.exchanges?.length ? r.exchanges : null), []);
  return (
    <>
      <PrivilegeCheck {...props} onResult={onResult} />
      {exchanges && <GatewayTrace exchanges={exchanges} source="real" />}
    </>
  );
}
