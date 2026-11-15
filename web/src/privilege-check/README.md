# privilege-check: the family's one "through the Privilege gateway" card

A vendored React card that calls the lab's own `POST /api/gateway-check` and shows the live
Privilege-gateway hop: the door called, the agent-key caller, the tool count and round-trip
time from the live `tools/list`, and the gateway's own refusal shape for a tool no policy
grants. The server side is the shared `gatewayReal.js` hop (see `../gateway-real/README.md`).

## Vendor it

1. Copy `PrivilegeCheck.jsx` and `privilege-check.css` into `web/src/privilege-check/`.
2. Render it on the page's settings/about area:

```jsx
import PrivilegeCheck from "./privilege-check/PrivilegeCheck";

<PrivilegeCheck />
```

No props needed for the default wiring. Optional props:

| Prop | Default | Meaning |
|---|---|---|
| `apiBase` | `""` | prefix for the API calls (the lab's own origin by default) |
| `title` | `"Privilege gateway"` | the card's heading |
| `primaryRetry` | `false` | render the retry as the page's one primary button (P9: pass it only on a page with no other primary action) |

The card renders nothing in mock-refused states except the honest reason line it got from
`GET /api/info` (the `realReason`), so a lab without the `<PREFIX>_GW_*` settings still shows
what Real would need. Keys are never displayed: the server scrubs every message.
