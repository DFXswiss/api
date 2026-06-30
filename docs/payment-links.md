# DFX Payment Links & OpenCryptoPay — Integration Guide

This guide explains how DFX turns a **recipient** and an **amount** into a scannable
crypto payment request, how to embed one on an invoice, the full HTTP/LNURL API behind
it, payment status tracking, and webhooks. It is written for a third party (a merchant
or their developer) who wants to accept crypto via DFX.

- **API base URL:** `https://api.dfx.swiss/v1`
- **App (payment page) base URL:** `https://app.dfx.swiss`
- **Standard:** [OpenCryptoPay](https://opencryptopay.io) — an LNURL-pay extension that
  lets a payer choose among several chains/assets, not only Lightning.

---

## Table of contents

1. [Concepts & glossary](#1-concepts--glossary)
2. [Quickstart](#2-quickstart)
3. [The Invoice tool (`/invoice`)](#3-the-invoice-tool-invoice)
4. [Integration example: offline "pay with crypto" QR on invoices](#4-integration-example-offline-pay-with-crypto-qr-on-invoices)
5. [URL & parameter reference](#5-url--parameter-reference)
6. [HTTP & LNURL API reference](#6-http--lnurl-api-reference)
7. [Payment standards](#7-payment-standards)
8. [Payment lifecycle & status tracking](#8-payment-lifecycle--status-tracking)
9. [Webhooks](#9-webhooks)
10. [Merchant setup: routes, labels, config, currency](#10-merchant-setup-routes-labels-config-currency)
11. [The web tools](#11-the-web-tools)
12. [Worked examples](#12-worked-examples)
13. [Security & data protection](#13-security--data-protection)
14. [Troubleshooting / FAQ](#14-troubleshooting--faq)
15. [Source map (for maintainers)](#15-source-map-for-maintainers)

---

## 1. Concepts & glossary

| Term | Meaning |
|---|---|
| **Payment route** | A DFX **sell route on the Lightning blockchain**, owned by a merchant. Identified by a numeric `id` and an optional, globally-unique **label**. Only Lightning routes can receive payment-link payments. |
| **Recipient / payee** | The owner of a payment route. Addressed in URLs by route `id` (numeric) or `label` (text). |
| **Payment link** | A persistent object (uniqueId `pl_…`) bound to one route. Carries recipient details, config, and one or more payments. |
| **Payment** | A single requested amount on a link (uniqueId `plp_…`): an amount, a currency, an `externalId`/reference, an expiry, a status. |
| **Quote** | One concrete pay attempt for a payment (uniqueId `plq_…`): a chosen chain+asset, a price snapshot, its own short expiry. A payment can spawn many quotes. |
| **Payment standard** | How the payer pays: `OpenCryptoPay` (default), `LightningBolt11`, or `PayToAddress`. |
| **LNURL** | A bech32-encoded (`LNURL1…`) HTTPS URL a Lightning wallet resolves to fetch the pay request. |
| **Access key** | A secret token that lets an unauthenticated point-of-sale terminal create/cancel payments without a login. Treat like a password. |

**uniqueId prefixes:** payment link `pl_…`, payment `plp_…`, quote `plq_…`.

---

## 2. Quickstart

You need a DFX account with a **Lightning payment route** (see [§10](#10-merchant-setup-routes-labels-config-currency)). Then, to bill 4.50 in your route's currency for invoice `INV-1001`:

1. **Build a URL** (pure string, no API call, no SDK):
   ```
   https://app.dfx.swiss/pl?route=<YourRouteLabelOrId>&amount=4.50&message=INV-1001&expiryDate=2025-12-31T23:59:59.000Z
   ```
2. **Render it as a QR code** with any offline QR library, and print/show it.
3. The customer **scans it**, the DFX payment page opens, the invoice is registered
   on first open, and they pay from a crypto wallet.

To be notified when it's paid, add `&webhookUrl=https://you.example.com/hook` (see
[§9](#9-webhooks)) or poll the status endpoints (see [§8](#8-payment-lifecycle--status-tracking)).

---

## 3. The Invoice tool (`/invoice`)

DFX hosts a no-login UI for creating a single invoice link interactively:
**`https://app.dfx.swiss/invoice`** ("Create Invoice").

It has exactly three inputs:

| Field | Meaning |
|---|---|
| **Recipient** | Your route **label** (a name, e.g. `Coffeeshop`) or numeric route **id**. |
| **Invoice ID** | Your reference for this charge (becomes the `message`). |
| **Amount** | The amount, in the recipient route's currency (shown as a prefix once the recipient resolves). |

What it does:

1. Validates the recipient (`GET /v1/paymentLink/recipient?id=<label-or-id>`) and reads
   its currency.
2. Once recipient + invoice id + amount are present, it calls
   `GET /v1/paymentLink/payment?route=…&amount=…&message=…&expiryDate=<now+1y>` —
   **this both validates and creates the link** (idempotently; see [§5](#5-url--parameter-reference)).
3. On success it builds the shareable link **in the browser** and renders the QR +
   a **Copy Link** button:
   ```
   https://app.dfx.swiss/pl?route=<recipient>&amount=<amount>&message=<invoiceId>&expiryDate=<iso>
   ```

You can pre-fill the recipient with `https://app.dfx.swiss/invoice?recipient=<label>`.

For automated/bulk invoicing you don't need this UI at all — build the URL yourself
([§4](#4-integration-example-offline-pay-with-crypto-qr-on-invoices)).

---

## 4. Integration example: offline "pay with crypto" QR on invoices

**Scenario.** A company sends invoices on paper or as PDF and wants each invoice to
carry a *"pay with crypto"* QR code. For data-protection reasons the QR is produced **on
the company's own systems, without calling the DFX API**. The QR is just a URL; DFX is
contacted only when the *customer* scans it. Scanning registers the invoice on the DFX
server and lets the customer pay, alongside the company's classic payment options.

This is fully supported, because the shareable URL is a plain string you assemble
yourself.

### 4.1 Why it works offline and is privacy-preserving

- The QR target is a plain URL — assembling it and rendering the QR is pure local
  computation. **No DFX endpoint is contacted at print time.**
- The URL carries only your route label, the amount, the invoice id and an expiry —
  **no buyer data**. DFX first learns of the invoice when the customer opens the link.
- The link is created on the DFX server on first open and is **idempotent**, so
  re-scanning the same printed invoice resolves to the same link (no duplicates).

### 4.2 The URL to print

```
https://app.dfx.swiss/pl?route=<RouteLabelOrId>&amount=<Amount>&message=<InvoiceId>&expiryDate=<ISO8601>
```

| Part | Required | Notes |
|---|---|---|
| `route=<RouteLabelOrId>` | **yes** | Your route's **label** or numeric **id** — identifies the payee. (Numeric ⇒ treated as id, text ⇒ label.) |
| `amount=<Amount>` | **yes** | In the route's currency. |
| `message=<InvoiceId>` | **yes** | Your invoice id / reference. |
| `expiryDate=<ISO8601>` | **strongly recommended for invoices** | Until when the invoice stays payable, e.g. `2025-12-31T23:59:59.000Z`. **Omit it and the invoice expires after ~60 seconds** (a point-of-sale default). |

> **Common mistakes.** A naive `…?amount=xxx&id=xxx&validUntil=31.12.2025` will **not**
> work: there is **no `id` parameter** (the payee is `route`, the reference is `message`);
> the **payee `route` is mandatory** (without it the page does nothing); and the date must
> be **ISO-8601** (`2025-12-31T23:59:59.000Z`), not free text.

### 4.3 Generate it locally (pseudo-code)

```js
const params = new URLSearchParams({
  route:      'Coffeeshop',                 // your route label or id — fixed per company
  amount:     '4.50',                       // per invoice
  message:    'INV-1001',                   // your invoice id
  expiryDate: '2025-12-31T23:59:59.000Z',   // until when it stays payable (ISO-8601)
});
const url = `https://app.dfx.swiss/pl?${params}`;
// → render `url` as a QR code with any offline library (qrcode, qrencode, ZXing, …)
// No DFX API call, no SDK, no secrets. The only fixed value is your route label/id.
```

For a **smaller QR** you may instead encode the compact API form as an `LNURL1…`
(see [§5.3](#53-lnurl-encoding)), but the plain `…/pl?…` web link above is simplest and is
what a phone camera handles best.

### 4.4 Prerequisites (one-time)

1. A DFX account enabled for payment links, with a **Lightning payment route**.
2. The route's **label or id** that you will print. Labels are globally unique; the
   numeric route id always works and is known to you from your route. (Label assignment is
   currently handled by DFX — see [§10.2](#102-the-route-label).)
3. Nothing else per invoice — no registration call, no signing.

### 4.5 What the customer experiences

1. Scans the QR with the phone camera → `https://app.dfx.swiss/pl?…` opens in the
   browser.
2. The page reads the params, creates/loads the invoice, and shows amount, payee and
   payment options. With OpenCryptoPay the customer may choose among the offered
   assets/chains.
3. The customer pays from a wallet. You're notified via your `webhookUrl` (if set,
   [§9](#9-webhooks)) and see the payment in your route history.

> **UX note — it's a web link, not a raw LNURL.** The printed QR is a normal HTTPS link.
> The customer opens it in a browser (camera → browser), which then produces the
> wallet-scannable LNURL. A generic Lightning wallet cannot pay the `…/pl?…` link
> directly. (DFX's own stickers work the same browser-mediated way.) The customer needs
> internet access.

### 4.6 Limits & gotchas

- **Always set `expiryDate`** for mailed invoices, or the invoice expires after ~60 s.
- The exchange-rate **quote** the customer gets at payment time is short-lived (5 min for
  Lightning/OpenCryptoPay) and refreshes on reload — independent of the invoice's
  `expiryDate`.
- Keep `message` (invoice id) **unique per amount**: the idempotency key is
  `message/amount`, so the same id with a different amount creates a *separate* link
  rather than overwriting one.
- Only **Lightning** routes can be the payee.

---

## 5. URL & parameter reference

### 5.1 The payment URL

```
https://app.dfx.swiss/pl?<params>
```

The `/pl` page treats the request as an invoice when **all three** of route + reference +
amount are present, then resolves it against the API. Each logical field has a long name
and short aliases:

| Logical field | Aliases (priority order) | Required | Meaning |
|---|---|---|---|
| Route (payee) | `routeId` → `route` → `r` | **yes** | Numeric id (`routeId`/numeric `r`) or label (`route`/non-numeric `r`). |
| Reference | `externalId` → `e` → `message` → `m` | **yes** | Your charge reference. |
| Amount | `amount` → `a` | **yes** | In the route's currency. |
| Currency | `currency` → `c` | no | Must equal the route's currency if given; otherwise it is taken from the route. |
| Expiry | `expiryDate` → `d` | no | ISO-8601; defaults to ~60 s if omitted. |
| Note | `note` → `n` | no | Free-text note shown to the payer. |
| Label | `label` → `l` | no | Link label. |
| Standard | `standard` → `s` | no | `OpenCryptoPay` (default) / `LightningBolt11` / `PayToAddress`. |
| Webhook | `webhookUrl` → `w` | no | HTTPS URL for payment notifications ([§9](#9-webhooks)). |

> There is **no `name` and no `id` parameter.** The payee is `route`/`routeId`; the
> reference is `message`/`externalId`.

If `externalId` is omitted it is derived as `` `${message}/${amount}${currency ?? ''}` ``.
That derived value is the **idempotency key**: the same reference + amount maps to the
same link; a different amount makes a new link.

### 5.2 The compact API form (`/plp`)

The same invoice can be expressed against the API directly, with one-letter params:

```
https://api.dfx.swiss/v1/plp?r=<routeLabelOrId>&a=<amount>&m=<invoiceId>&d=<iso>
# equivalent long form:
https://api.dfx.swiss/v1/paymentLink/payment?route=<…>&amount=<…>&message=<…>&expiryDate=<iso>
```

Both create-or-return the invoice link and respond with the LNURL pay request
([§7.1](#71-the-pay-request-object)). The `/plp` form exists to keep an LNURL-encoded QR small.

### 5.3 LNURL encoding

An `LNURL1…` is just the API URL bech32-encoded (HRP `lnurl`, uppercased; the encoder
allows long URLs). To build the wallet-scannable form yourself:

```
LNURL = bech32_encode("lnurl", "https://api.dfx.swiss/v1/plp?r=Coffeeshop&a=4.50&m=INV-1001")
shareable = https://app.dfx.swiss/pl?lightning=<LNURL1…>
```

A scanned `…/pl?lightning=LNURL1…` link is decoded by the page back into the API URL and
resolved normally.

---

## 6. HTTP & LNURL API reference

Base: `https://api.dfx.swiss/v1`. Responses are JSON unless noted. The integration-facing
endpoints below are public (no authentication) unless an **Auth** value says otherwise.

### 6.1 Invoice / pay-request endpoints (public)

| Method & path | Purpose | Key params | Response |
|---|---|---|---|
| `GET /paymentLink/payment` | Create-or-return an invoice link and return its pay request | `route`/`routeId`/`r`, `message`/`externalId`/`e`/`m`, `amount`/`a` (+ optional `currency`,`expiryDate`,`note`,`label`,`standard`,`webhookUrl`) | `PaymentLinkPayRequest` ([§7.1](#71-the-pay-request-object)) |
| `GET /plp` | Compact alias of the above (short params) | `r`,`a`,`m`,… | `PaymentLinkPayRequest` |
| `GET /paymentLink/recipient` | Resolve a recipient and its currency | `id` = route id or label | `{ id, currency }` |

### 6.2 LNURL-pay flow (public, wallet-facing)

| Method & path | Purpose |
|---|---|
| `GET /lnurlp/{id}` | LNURL-pay step 1 — returns the pay request. Optional `standard`, `timeout`. |
| `GET /lnurlp/cb/{id}` | LNURL-pay step 2 (callback) — returns the actual invoice/URI. Params: `quote` (required), and per standard `amount` (msat, Bolt11) or `method`+`asset` (PayToAddress), plus optional `tx`/`hex`/`sender`. |
| `GET /lnurlp/tx/{id}` | Submit a signed tx `hex` or broadcast `txId` (on-chain methods). Returns `{ txId }`. |
| `GET /lnurlp/wait/{id}` | Long-poll until the payment reaches a terminal state. Returns `{ status }`. |
| `DELETE /lnurlp/cancel/{id}` | Cancel a pending payment (only if the link is `cancellable`). |
| `GET /pl?lightning=LNURL1…` | Human scan target — decodes the embedded LNURL and forwards to `GET /lnurlp/{id}`. |

### 6.3 Managed payment-link endpoints (authenticated)

These require a merchant **JWT** (DFX login) or, where noted, a payment-link **access key**
(`?key=…`).

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /paymentLink` | JWT or `key` | Create a persistent, managed link (`CreatePaymentLink` body). |
| `GET /paymentLink` | JWT | List links / fetch one (`linkId`/`externalLinkId`/`externalPaymentId`). |
| `PUT /paymentLink` | JWT | Update a link (status, label, webhook, config). |
| `GET /paymentLink/history` | JWT or `key` | Payment history (`status`, `from`, `to`). |
| `POST /paymentLink/payment` | optional JWT / `key` | Create a payment on a link (POS path with `key`). |
| `GET /paymentLink/payment/wait` | JWT or `key` | Long-poll a link's pending payment to a terminal state; returns the full link. |
| `PUT /paymentLink/payment/confirm` | JWT or `key` | Mark a completed payment confirmed. |
| `DELETE /paymentLink/payment` | optional JWT / `key` | Cancel the pending payment. |
| `PUT /paymentLink/pos` | JWT | Get a POS URL (`{ url }`) for a link. |
| `GET /paymentLink/config`, `PUT /paymentLink/config` | JWT (account) | Read/update the account-level link config (incl. POS access key). |
| `PUT /paymentLink/assign` | none | Assign an unassigned link to a route by `publicName`. |
| `GET /paymentLink/locations` | none | Distinct recipient addresses for a `publicName`. |

> Administrative endpoints (route-label assignment, internal link/payment edits, sticker
> PDF generation, exchange-provider enrollment) exist but are internal/admin-only and are
> out of scope for third-party integration.

### 6.4 Example — `GET /v1/paymentLink/payment` → pay request

Request:
```
GET https://api.dfx.swiss/v1/paymentLink/payment?route=Coffeeshop&message=INV-1001&amount=4.50&currency=CHF
```
Response (`PaymentLinkPayRequest`):
```json
{
  "id": "pl_8sJ2Kd9fQ1",
  "externalId": "INV-1001/4.5",
  "mode": "Multiple",
  "tag": "payRequest",
  "callback": "https://api.dfx.swiss/v1/lnurlp/cb/plp_3Hf72Kd0Za",
  "minSendable": 5742000,
  "maxSendable": 5742000,
  "metadata": "[[\"text/plain\", \"Coffeeshop - CHF 4.5\"]]",
  "displayName": "Coffeeshop",
  "standard": "OpenCryptoPay",
  "possibleStandards": ["OpenCryptoPay", "LightningBolt11", "PayToAddress"],
  "displayQr": true,
  "recipient": { "name": "Coffeeshop GmbH", "address": { "city": "Zug", "country": "CH" } },
  "route": "Coffeeshop",
  "quote": {
    "id": "plq_Qe91Hf0Tz7",
    "expiration": "2026-06-30T12:34:56.000Z",
    "payment": "plp_3Hf72Kd0Za"
  },
  "requestedAmount": { "asset": "CHF", "amount": 4.5 },
  "transferAmounts": [
    { "method": "Lightning", "minFee": 0,    "assets": [{ "asset": "BTC", "amount": "0.00005742" }], "available": true },
    { "method": "Polygon",   "minFee": 0.01, "assets": [{ "asset": "ZCHF", "amount": "4.55" }, { "asset": "USDT", "amount": "5.07" }], "available": true },
    { "method": "Bitcoin",   "minFee": 2,    "assets": [{ "asset": "BTC", "amount": "0.00005742" }], "available": true }
  ]
}
```

Notes:
- `id` is the **link** id (`pl_…`); `quote.payment` is the **payment** id (`plp_…`).
- `minSendable`/`maxSendable` are **millisatoshis** and equal (the amount is fixed).
- `requestedAmount` carries the **fiat** amount; `transferAmounts` lists the payable
  crypto amounts per chain (asset amounts are decimal strings, `minFee` is a number).
- `currency` is not part of the success response (it's inside `requestedAmount.asset`).

---

## 7. Payment standards

A link offers one or more standards (default: `OpenCryptoPay`). The pay request's
`possibleStandards` lists them; `standard` is the active one. Request a specific one with
`&standard=` (or `&s=`).

| Standard | What the payer gets | Notes |
|---|---|---|
| **`OpenCryptoPay`** (default) | An LNURL; the wallet/page lets the user pick any supported chain + asset from `transferAmounts`. | Multi-chain. The LNURL is built client-side; no extra callback round-trip to start. |
| **`LightningBolt11`** | A classic BOLT11 Lightning invoice (`pr`). | The page calls the callback `?quote=<id>&amount=<msat>` and shows the returned `pr`. |
| **`PayToAddress`** | A chain payment URI/address for a chosen chain + asset. | The page calls `?quote=<id>&method=<chain>&asset=<asset>`; the response `uri` is the address/URI. Longer quote window (2 h) and a slightly higher FX fee. |

### 7.1 The pay-request object

`PaymentLinkPayRequest` (returned by the invoice and LNURL endpoints):

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Link uniqueId (`pl_…`). |
| `externalId` | string? | The link's external id (derived `message/amount` if you didn't pass one). |
| `tag` | string | Always `"payRequest"` (LNURL discriminator). |
| `callback` | string | LNURL callback URL the wallet calls next. |
| `minSendable` / `maxSendable` | number | Payable amount in **millisatoshi** (equal — fixed amount). |
| `metadata` | string | LNURL metadata, `[["text/plain","<payee> - <ccy> <amount>"]]`. |
| `displayName` | string | Payee display name. |
| `standard` | enum | Active standard. |
| `possibleStandards` | enum[] | All standards the link supports. |
| `displayQr` | boolean | Whether the UI should render a QR. |
| `recipient` | object | Payee details (name, address, phone, mail, website, …). |
| `mode` | enum | `Single` / `Multiple` / `Public`. |
| `route` | string? | Route label. |
| `quote` | object | `{ id, expiration, payment }` — the price quote this request is bound to. |
| `requestedAmount` | object | `{ asset, amount }` in **fiat** (the requested invoice amount). |
| `transferAmounts` | array | Payable crypto amounts per chain — see below. |

### 7.2 `transferAmounts`

One entry per supported chain:

```json
{ "method": "Polygon", "minFee": 0.01, "assets": [{ "asset": "ZCHF", "amount": "4.55" }], "available": true }
```

- `method` — chain name (`Lightning`, `Bitcoin`, `Ethereum`, `Polygon`, `Arbitrum`,
  `Optimism`, `Base`, `Gnosis`, `BinanceSmartChain`, `Monero`, `Zano`, `Solana`, `Tron`,
  `Cardano`, `InternetComputer`, …), an exchange provider, or a brand-only manual method
  (`TaprootAsset`, `Spark`, `Arkade`, listed with `available: false`).
- `minFee` — minimum network fee for that chain (units are chain-native; `0` for Lightning).
- `assets[].amount` — the crypto amount to send, as a **decimal string** (≤ 8 decimals).
- `available` — whether this method can currently be used.

A `Lightning`/`BTC` entry is always present. Asset amounts are computed from the live FX
rate plus a small forex fee (CHF invoices paid in ZCHF/VCHF are fee-free).

---

## 8. Payment lifecycle & status tracking

### 8.1 Statuses

A **payment** has one of: `Pending`, `Completed`, `Cancelled`, `Expired`. Only one
`Pending` payment can exist per link at a time. The three non-pending states are terminal.

Internally a payment progresses through **quotes** (one per pay attempt). The payment-level
status is the only status exposed to clients; the per-quote tx detail
(`TxMempool`/`TxBlockchain`/`TxCompleted`/…) is internal, summarised by `txCount` (the
number of quotes that reached the completion threshold).

### 8.2 When does a payment complete?

A merchant config field, **`minCompletionStatus`**, decides how far a transaction must get
before the payment auto-completes (in `Single` mode):

- **`TxMempool`** (default) — completes as soon as the paying transaction is seen
  (pre-confirmation). Fast; suited to on-premises point-of-sale.
- **`TxBlockchain`** — requires on-chain inclusion (≥ 1 confirmation) before completing.
  Recommended for remote or higher-value payments.

In `Multiple` mode the payment stays `Pending` and only `txCount` increases (tip-jar /
reusable links).

### 8.3 Expiry — two separate clocks

- **Invoice expiry** = the payment's `expiryDate`. "Until when is this invoice payable."
  Set it explicitly for invoices (e.g. months). **If you don't set it, it defaults to
  ~60 seconds.**
- **Quote timeout** = how long one price snapshot stays valid: **5 minutes** for
  OpenCryptoPay/Lightning, **2 hours** for PayToAddress — but never beyond the invoice's
  own `expiryDate`. Quotes refresh automatically while the invoice is still open.

A background job expires overdue pending payments every minute.

### 8.4 Tracking status

Three options, from push to pull:

1. **Webhook** — set `webhookUrl`; DFX POSTs to you on every state change ([§9](#9-webhooks)).
2. **Long-poll** — `GET /v1/lnurlp/wait/{plp_id}` returns `{ status }` when the payment
   reaches a terminal state. (Authenticated variant: `GET /v1/paymentLink/payment/wait`.)
   Both require the payment to be **currently pending** when you call; if it already
   settled, fall back to a plain read.
3. **Poll** — read `GET /v1/paymentLink` / `GET /v1/paymentLink/history` (JWT or access
   key) and inspect `payment.status` / `payments[]`.

The status fields on a payment: `status`, `amount`, `currency`, `date`, `expiryDate`,
`txCount`, `isConfirmed`.

---

## 9. Webhooks

Set `webhookUrl` (or `w`) on a link — as a query param on the invoice URL, or in the
managed-link body/config. DFX then notifies you of payment state changes.

- **Method:** HTTP `POST` to your URL.
- **When:** on **every** payment state change for that link — the initial `Pending`
  creation, and each terminal transition (`Completed`, `Cancelled`, `Expired`). Expect a
  `Pending` event followed by a terminal event.
- **Body:** the full payment-link object (same shape as `GET /paymentLink`), with the
  changed payment in the `payment` field. The merchant-facing fields: `payment.status`,
  `payment.amount`, `payment.currency`, `payment.externalId`, `payment.id`, plus link
  `id`, `routeId`, `externalId`, `recipient`, `config`.
- **Headers:** `Content-Type: application/json` and `X-Payload-Signature: <base64>`.
  There is no bearer token — authenticity is established by the signature.

### 9.1 Verifying the signature

The signature is computed as:

```
signature = base64( RSA/ECDSA-SHA256-sign( sha256_hex( JSON.stringify(body) ), DFX_private_key ) )
```

To verify on your side: take the **raw received body**, compute its SHA-256 hex digest,
and verify the `X-Payload-Signature` (base64) against that digest using DFX's **public
key**. Obtain the public key from DFX out-of-band (there is no endpoint that serves it).
Pseudo-code:

```js
const ok = crypto.createVerify('sha256')
  .update(sha256Hex(rawBody))
  .verify(DFX_WEBHOOK_PUBLIC_KEY_PEM, signatureHeader, 'base64');
```

### 9.2 Delivery semantics (important)

- **Retries:** up to **12 attempts**, a fixed **5 s** apart (~55 s total), on **any**
  non-2xx response or network error. Return **2xx promptly** to stop retries.
- **No ordering guarantee** and **no event id**: a `Completed` could in principle arrive
  before you finished processing `Pending`. **Deduplicate on `payment.id` + `payment.status`.**
- **No replay/dead-letter:** if all 12 attempts fail, the event is dropped (logged on
  DFX's side only). Use the wait/poll endpoints ([§8.4](#84-tracking-status)) as a
  backstop for critical flows.
- Your own `webhookUrl` is echoed back inside the payload.

> The webhook fires only for payment-level changes. Confirming a payment
> (`PUT …/payment/confirm`) and editing the link itself do **not** trigger a webhook.

---

## 10. Merchant setup: routes, labels, config, currency

### 10.1 A payment route

A "payment route" is a **DFX sell route on the Lightning blockchain**. Your account must be
enabled for payment links. The route's settlement **currency** is its fiat (e.g. CHF, EUR,
USD); that currency governs every invoice on the route.

### 10.2 The route label

A route can have a **label** — a globally-unique text handle you can use in URLs instead of
the numeric id. Labels are enforced unique across all routes (assigning a taken label
fails). **Label assignment is currently performed by DFX** (the self-service "rename" in
the app edits a *payment-link* label, not the route label). In practice:

- Use your **numeric route id** in `route=`/`routeId=` — you always have it, no setup needed.
- Ask DFX to assign a memorable **label** if you prefer a readable URL.

If a `route` value doesn't resolve to one of your Lightning routes, the request fails with
`400 Bad Request — "Only Lightning routes are allowed"`.

### 10.3 Link configuration

Per link (or per account), the configurable fields and their defaults:

| Field | Default | Meaning |
|---|---|---|
| `standards` | `["OpenCryptoPay"]` | Offered payment standards. |
| `blockchains` | all supported | Which chains appear in `transferAmounts`. |
| `minCompletionStatus` | `TxMempool` | Completion threshold ([§8.2](#82-when-does-a-payment-complete)). |
| `displayQr` | `false` | Whether the pay UI shows a QR. |
| `paymentTimeout` | `60` (s) | Default invoice expiry when `expiryDate` is omitted. |
| `scanTimeout` | — | Optional: drop a shown-but-never-scanned QR after N seconds. |
| `cancellable` | `true` | Whether the payer may cancel. |
| `recipient` | — | Payee identity shown to the payer (see below). |
| `fee` | `0.002` | Read-only service fee fraction. |

Config precedence (later wins): **defaults < account-level config < per-link config**.

**Recipient** (`recipient`) fields: `name`, `address` (`street`, `houseNumber`, `zip`,
`city`, `country`), `phone` (E.164), `mail`, `website` (with `https://`),
`registrationNumber`, `storeType`, `merchantCategory`, `goodsType`, `goodsCategory`.

### 10.4 Currency

The invoice currency is **always the route's own fiat**. If you pass `currency` it must
match the route's currency, otherwise the request fails with
`400 — "Payment currency mismatch"`. Omit it and the route currency is used. Discover a
route's currency with `GET /v1/paymentLink/recipient?id=<route>` (returns `{ id, currency }`).

### 10.5 Point-of-sale access keys

For an unattended terminal, an **access key** lets you create/cancel/await payments without
a JWT. Keys are account-wide or scoped to a single link, and are passed as `?key=<secret>`.
Treat the key as a credential: TLS only, never log it, rotate if leaked. Get a POS URL with
`PUT /v1/paymentLink/pos` (it returns `https://app.dfx.swiss/pl/pos?lightning=…&key=…`).

---

## 11. The web tools

| Tool | URL | Use |
|---|---|---|
| **Create Invoice** | `app.dfx.swiss/invoice` | No-login: recipient + invoice id + amount → shareable link + QR ([§3](#3-the-invoice-tool-invoice)). |
| **Payment Routes** | `app.dfx.swiss/routes` | Logged-in management of routes and persistent links (create/edit, recipient, config, QR, stickers, POS). |
| **POS terminal** | `app.dfx.swiss/pl/pos` | Cashier view for an existing link: authenticate with an access key, enter an amount, show the QR. |
| **Payment page** | `app.dfx.swiss/pl` | The payer-facing page a scanned link opens. |
| **Stickers** | `app.dfx.swiss/stickers` | Printable OpenCryptoPay sticker PDF for a route. |

---

## 12. Worked examples

### 12.1 Offline QR on a printed invoice

Company `Coffeeshop` (a labelled Lightning route, currency CHF) mails a paper invoice
`INV-1001` for CHF 4.50, payable until 31 Dec 2025, and prints this QR — generated locally,
no DFX call:

```
# QR target printed on the invoice
https://app.dfx.swiss/pl?route=Coffeeshop&amount=4.50&message=INV-1001&expiryDate=2025-12-31T23:59:59.000Z
```

On scan it resolves to:
```
https://api.dfx.swiss/v1/paymentLink/payment?route=Coffeeshop&amount=4.50&message=INV-1001&expiryDate=2025-12-31T23:59:59.000Z
# compact:
https://api.dfx.swiss/v1/plp?r=Coffeeshop&a=4.50&m=INV-1001&d=2025-12-31T23:59:59.000Z
```

Derived idempotency key `externalId = INV-1001/4.5` — re-scanning never creates duplicates.
Add `&webhookUrl=https://coffeeshop.example/dfx-hook` to be notified on payment.

### 12.2 Notified, programmatic invoicing (no UI)

```js
const base = 'https://app.dfx.swiss/pl';
function invoiceQrUrl({ route, amount, invoiceId, validUntil }) {
  const p = new URLSearchParams({
    route, amount: String(amount), message: invoiceId,
    expiryDate: validUntil.toISOString(),
    webhookUrl: 'https://you.example.com/dfx/webhook',
  });
  return `${base}?${p}`;
}
// render the returned string as a QR with your QR library
```

Then verify each incoming webhook's `X-Payload-Signature` ([§9.1](#91-verifying-the-signature))
and act on `payment.status === 'Completed'`, deduping on `payment.id`.

---

## 13. Security & data protection

- **Privacy at print time.** Building the URL/QR contacts no DFX service and contains no
  buyer data. DFX is reached only when the customer scans. On scan, merchant transaction
  metadata (route label/id, amount, invoice id) is sent to DFX; no buyer PII is in the URL.
- **The invoice endpoint is public.** `GET /paymentLink/payment` and `/plp` require no
  login — this is what makes offline QR generation possible. Anyone who knows a route
  label/id can create invoice links against it; treat your route label as semi-public and
  use `webhookUrl`/status checks to reconcile real payments.
- **Access keys and webhook secrets are credentials.** Transmit `?key=` only over TLS,
  never log it. Verify webhook signatures with DFX's public key; don't trust unsigned
  callbacks.
- **Confirmation strength is your choice.** The default `minCompletionStatus = TxMempool`
  completes on a pre-confirmation sighting (fine for in-person retail). For remote or
  high-value flows set `TxBlockchain` to require on-chain confirmation.
- **Currency is enforced server-side.** A mismatched `currency` is rejected, not silently
  converted.

---

## 14. Troubleshooting / FAQ

| Symptom | Cause / fix |
|---|---|
| The `/pl` page does nothing / no payment appears | A required param is missing. You need **all** of `route`(or `routeId`), `message`(or `externalId`), `amount`. |
| `400 — Only Lightning routes are allowed` | The `route` label/id doesn't resolve to one of your **Lightning** routes (wrong/unknown label, or a non-Lightning route). |
| `400 — Payment currency mismatch` | You passed a `currency` other than the route's settlement currency. Omit it or match it. |
| Invoice expired almost immediately | You didn't set `expiryDate`; it defaulted to ~60 s. Always set an explicit ISO-8601 `expiryDate` for invoices. |
| A generic Lightning wallet won't scan my printed QR | The printed QR is a **web link** (`…/pl?…`), not a raw LNURL. The customer opens it in a browser, which then shows the wallet-scannable code. |
| Used `id=` / `name=` and it's ignored | Those aren't parameters. Payee = `route`/`routeId`, reference = `message`/`externalId`. |
| Two invoices with the same number collapsed into one | The idempotency key is `message/amount`; identical reference **and** amount reuse the same link. Use distinct invoice ids. |
| Didn't receive a webhook | Return HTTP 2xx quickly (non-2xx triggers retries, then drop). There's no replay — reconcile with the wait/poll endpoints. Dedupe on `payment.id`+`status`. |

---

## 15. Source map (for maintainers)

Module root: `src/subdomains/core/payment-link/`.

- **Controllers:** `controllers/payment-link.controller.ts` (invoice `GET payment` :214, `/plp` :464, `recipient` :206, managed CRUD, wait :262, confirm :284); LNURL forwarding `src/subdomains/generic/forwarding/controllers/lnurlp-forward.controller.ts`; human scan target `…/forwarding/controllers/payment-forward.controller.ts` (`GET /pl`).
- **Invoice creation:** `services/payment-link.service.ts` `createInvoice` :157 (label resolution, Lightning-only :162, idempotency :165-181), `createForRoute` :217, `createPayRequest` :255-300; alias normalisation in the controller :217-234 (derived `externalId` :234).
- **Standards / transfer amounts:** `enums/index.ts` (`PaymentStandard` :57; statuses :9-27), `services/payment-quote.service.ts` `createTransferAmounts` :226, `entities/payment-quote.entity.ts` `transferAmountsForPayRequest` :105; defaults `config.ts:734-753`.
- **Lifecycle / expiry:** `services/payment-link-payment.service.ts` (`createPayment`/timers :197-265, default expiry :230, `handleQuoteChange` :414-437, `processExpiredPayments` :55, `waitForPayment` :170, `doSave` :439); cron `services/payment-cron.service.ts`; `minCompletionStatus` comment `enums/index.ts:98-118`.
- **Webhooks:** `services/payment-webhook.service.ts` (POST, `X-Payload-Signature`, retry 12×5 s); trigger gate `services/payment-link-payment.service.ts:442`; payload `dto/payment-link-dto.mapper.ts`.
- **Routes / labels / config:** `src/subdomains/supporting/address-pool/route/deposit-route.service.ts` (`getByLabel` :36, `getPaymentRoute` :44, `getById` :23), `src/subdomains/core/route/route.entity.ts:11-13` (unique `label`), `route.service.ts` (admin label writer), `entities/payment-link.config.ts` (defaults), `entities/payment-link.entity.ts` (`configObj` precedence :74-94).
- **Frontend (`services` repo):** routes `src/App.tsx` (`/invoice` :232, `/pl` :203, `/pl/pos` :195, `/routes` :187); invoice builder `src/screens/invoice.screen.tsx`; invoice detection + client LNURL `src/contexts/payment-link.context.tsx` (`isPaymentInvoiceRequest` :152, OCP encode :384, `simplifyPaymentLinkUrl` :409); LNURL helpers `src/util/lnurl.ts`, `src/util/open-crypto-pay.ts`.

> Note: the invoice endpoints (`GET /paymentLink/payment`, `/plp`, `recipient`) carry
> `@ApiExcludeEndpoint()` and are therefore not in the public Swagger today, although they
> are publicly reachable and are the basis of this integration. Consider whether to surface
> them officially in Swagger to match this guide.
