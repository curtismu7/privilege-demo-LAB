// This lab's gateway card: the family's shared PrivilegeCheck (vendored unchanged, see privilege-check.pin.test.js) plus the Rule 25
// "What Privilege did" panel. The panel is drawn from the card's own onResult answer, so the page makes no second gateway call.
import { useCallback, useState } from "react";
import PrivilegeCheck from "./PrivilegeCheck";
import GatewayTrace from "../gateway-trace/GatewayTrace";
import { GatewayRunObs } from "../components/RunObs";

export default function GatewayCheckCard(props) {
  const [exchanges, setExchanges] = useState(null);
  // Only a finished check that came with a trace shows one; a retry, an error or "not configured" clears the old one.
  // The run record (rule 27) comes back with the same answer, so it too costs no second gateway call.
  const [seen, setSeen] = useState(null);
  const onResult = useCallback((r) => {
    const done = r?.phase === "done";
    setExchanges(done && r.exchanges?.length ? r.exchanges : null);
    setSeen(done && r.observability ? { record: r.observability, noReply: Array.isArray(r.noReply) ? r.noReply : [] } : null);
  }, []);
  return (
    <>
      <PrivilegeCheck {...props} onResult={onResult} />
      {exchanges && <GatewayTrace exchanges={exchanges} source="real" />}
      {seen && <GatewayRunObs {...seen} />}
    </>
  );
}
