# Exchange API references

Vendor-supplied API specifications for the exchanges integrated under
`src/integration/exchange/`. Kept in-repo so the Scrypt integration code
(`scrypt.service.ts`, `scrypt-websocket-connection.ts`, `scrypt.dto.ts`,
`scrypt.adapter.ts`) can be cross-referenced against the authoritative
schema without leaving the codebase.

## Scrypt

| File | Source | Title | Version |
|---|---|---|---|
| `scrypt-asyncapi.yaml` | `https://doc.client.scrypt.swiss/v1/client/customer/documentation/docs/public` | Scrypt WebSocket API | `1.0.0` (AsyncAPI 3.0.0) |
| `scrypt-fix-api.pdf`   | `https://uploads-ssl.webflow.com/65b7df67f3cf496d06acb907/65d77e3e7a09868617766110_Scrypt%20FIX%20API.pdf` | Scrypt FIX API | FIX.4.4 |

**Fetched:** 2026-05-21. The live specs are the source of truth — refresh the
checked-in copies by re-downloading from the URLs above (HTTP Basic Auth
credentials for `doc.client.scrypt.swiss` are stored in Vaultwarden under
the Scrypt entry; the FIX PDF is publicly accessible).

**Endpoints:**

- Sandbox WebSocket: `wss://demo.scrypt.swiss/ws/v1`
- Production WebSocket: `wss://otc.scrypt.swiss/ws/v1`
- FIX: hostname/port provided by Scrypt during onboarding

### Key facts that drive integration choices

- `Fee` field on `Trade` and `LastFee` on `ExecutionReport` are populated by
  the venue, but in practice come back as `"0"` for our Limit orders — Scrypt's
  commission is embedded in the quoted bid/ask spread (see Scrypt FAQ: *"The
  price you see is what you get"*). Implication: the implicit cost is not
  observable from `Fee` alone, only from the spread between Scrypt's
  executable price and an independent reference. `exchange-tx.service.ts`
  reflects this by computing `calculateSpreadFee` against `pricingService`.
- `AvgPx` doc string explicitly says *"Does not include fees"* — confirming
  that for non-RFQ orders, Fee is meant to be a separate field even when
  the venue defaults it to zero.
- For `OrdType: RFQ`, `TradedPx` is described as *"all-in price that
  includes fees"* — different semantics from Limit/Market, so any future
  RFQ integration needs its own pricing logic.
- **FIX-only `OrdType: A = LimitAllIn`** (FIX PDF, "New Order Single"
  section, Tag 40): *"requested price/size includes fees"*. This is **not
  in the AsyncAPI/WebSocket spec** — needs sandbox verification before
  attempting to use it over WebSocket.
- Onboarding for new API keys: email `trade@scrypt.swiss`. There is no
  public fee schedule endpoint.

### FIX vs WebSocket — known divergences

The two protocols expose overlapping but **not identical** surfaces. When
extending integration code, do not assume FIX semantics carry over verbatim.

| Surface | FIX | WebSocket (AsyncAPI) |
|---|---|---|
| `OrdType` values | `1=Market, 2=Limit, A=LimitAllIn` | `Market, Limit, RFQ` (no `LimitAllIn`) |
| `ExecType` extra values (vs FIX baseline) | — | `CancelRejected, ReplaceRejected, Restated, PendingResume, Resumed, PendingPause, Paused, Triggered, Started` |
| `OrdRejReason` enum | Numeric, FIX-standard codes | Named string enum, includes Scrypt-extensions (`ImmediateOrderDidNotCross`, `PostOnlyOrderWouldCross`, `QuoteExpired`, …) |
| `CumFee` (cumulative fee in `FeeCurrency`) | Tag 4016 on ExecutionReport | Surfaced via `LastFee` + cumulative tracking client-side |
| `DecisionStatus` (staged-order lifecycle) | Tag 20032 (Active/Paused/PendingPause/…) | Not exposed |
| `CancelOnDisconnect` | Tag 20030, default Y | Not applicable (subscription-based session) |
| Order State Change Matrices | Included in FIX PDF (Filled / Canceled / Replace-to-increase / Replace-during-fill) | Not documented; infer from ExecType + OrdStatus |
