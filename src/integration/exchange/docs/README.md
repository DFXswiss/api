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

**Fetched:** 2026-05-21. The live spec is the source of truth — refresh the
checked-in copy by re-downloading from the URL above (HTTP Basic Auth
credentials are stored in Vaultwarden under the Scrypt entry).

**Companion docs not checked in:**

- FIX API PDF: <https://uploads-ssl.webflow.com/65b7df67f3cf496d06acb907/65d77e3e7a09868617766110_Scrypt%20FIX%20API.pdf>
- Sandbox WebSocket: `wss://demo.scrypt.swiss/ws/v1`
- Production WebSocket: `wss://otc.scrypt.swiss/ws/v1`

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
- Onboarding for new API keys: email `trade@scrypt.swiss`. There is no
  public fee schedule endpoint.
