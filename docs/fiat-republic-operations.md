# Fiat Republic — Operations Runbook

Fiat Republic is an EUR fiat rail: one Client Money Account held by DFX, with a named sub-account
(virtual account, own IBAN) per end customer. Payins arrive as webhooks, payouts leave as SEPA credit
transfers.

The integration ships **dark**. Every line of it is inert until an operator supplies credentials
*and* sets release flags, one capability at a time. This document is how to switch it on and what to
check at each step.

---

## 1. The release model

Two conditions gate everything, and both must hold before any Fiat Republic code does anything:

| Condition | Where | Effect when missing |
| --------- | ----- | ------------------- |
| Complete credentials | `FIAT_REPUBLIC_BASE_URL`, `_AUTH_URL`, `_CLIENT_ID`, `_CLIENT_SECRET` | `FiatRepublicService.isConfigured()` is false; every call throws before touching the network |
| Master release | `FIAT_REPUBLIC_ENABLED=true` | `isAvailable()` is false; identical behaviour to no credentials at all |

On top of the master switch, each capability has its own flag. They are independent and can be
turned on — and off again — one at a time:

| Stage | Flag | What it enables | What it does NOT do |
| ----- | ---- | --------------- | ------------------- |
| 1 | `FIAT_REPUBLIC_BANK_TX_SYNC_ENABLED` | Payins are ingested into `bank_tx` (webhook, plus a polling backstop). The webhook endpoint additionally requires `FIAT_REPUBLIC_WEBHOOK_SECRET`; without it every delivery is rejected with 403 | Does not offer any IBAN to a customer |
| 2 | `FIAT_REPUBLIC_FRONTEND_ENABLED` | Fiat Republic is offered to customers: its collection IBAN through the receive-IBAN path, and personal IBANs (named sub-accounts) through the virtual-IBAN provider. Requires `FIAT_REPUBLIC_MASTER_FIAT_ACCOUNT_ID` | Does not send any money |
| 3 | `FIAT_REPUBLIC_PAYOUT_ENABLED` | Fiat outputs **already assigned** to Fiat Republic are transmitted (payee, Verification of Payee, SEPA payment, status polling) | Does not re-route anything; nothing gets assigned to Fiat Republic by itself |
| 4 | `FIAT_REPUBLIC_PAYOUT_ROUTING_ENABLED` | The payout bank selection may pick Fiat Republic for new EUR outputs instead of Olkypay. Requires stage 3 — routing to a rail that may not transmit would strand the payout | Does not decide the order between banks; see §5 |

Non-secret configuration (`FIAT_REPUBLIC_BASE_URL`, `_AUTH_URL`, `_IBAN_COUNTRY`, `_MASTER_FIAT_ACCOUNT_ID`,
and all five flags) belongs in the `services.dfx-api.environment:` block of the infrastructure repo.
Only `FIAT_REPUBLIC_CLIENT_SECRET` and `FIAT_REPUBLIC_WEBHOOK_SECRET` are secrets and belong in the
vault.

`FIAT_REPUBLIC_IBAN_COUNTRY` defaults to `DE` — the EUR IBAN country DFX committed to towards Fiat
Republic. A blank value falls back to that default rather than travelling upstream as invalid input.

### Runtime kill switches

Independently of the environment, three `DISABLED_PROCESSES` entries stop the scheduled work without
a deploy (and can also be set through the `disabledProcess` database setting, effective within 30s):

- `BankTxFiatRepublicSync` — the payin polling backstop
- `FiatOutputFiatRepublicTransmission` — payout transmission
- `FiatOutputFiatRepublicStatusCheck` — payout status polling

These are *additional* brakes. They do not replace the environment flags and cannot enable anything.

---

## 2. Registering the bank row

The migration deliberately creates **no** bank row: the Fiat Republic collection IBAN is live data
that only exists once the account is opened. Registering it is a manual operational step, and until
it happens the rail has nothing to select even with every flag on.

```sql
INSERT INTO "bank" ("name", "iban", "bic", "currency", "receive", "send", "sctInst", "amlEnabled", "sendPriority")
VALUES ('Fiat Republic', '<the DE IBAN of the client money account>', '<BIC>', 'EUR', TRUE, TRUE, TRUE, TRUE, 1000);
```

Notes:

- `sctInst` is `TRUE`: Fiat Republic settles EUR through SEPA Instant where the beneficiary bank
  supports it, using the same `SCT` scheme code.
- `sendPriority` decides which bank wins when several are eligible — see §5. Leave it at the default
  until stage 4 is actually meant to move traffic.
- `receive`/`send` can be used to open one direction at a time, in addition to the flags.

Before the first payin, create the webhook at Fiat Republic (dashboard or `POST /webhooks`) pointing
at `https://<api-host>/v1/bank/fiatRepublic/webhook`, subscribed at least to `PAYMENT.STATUS_UPDATED`.
Store its secret key as `FIAT_REPUBLIC_WEBHOOK_SECRET` — each endpoint has its own.

---

## 3. Payin path

1. Fiat Republic posts `PAYMENT.STATUS_UPDATED` to the webhook endpoint.
2. The endpoint verifies the HTTP Message Signature (sha1 body digest folded into a signature base,
   HMAC-SHA256 with the endpoint secret) over the **raw** body, then forwards the payment.
3. Only `direction=PAYIN` **and** `status=COMPLETED` is booked. A payment in `COMPLIANCE_REVIEW` has
   not credited the master account yet; Fiat Republic sends a second event once it clears.
4. The virtual account id is resolved to the customer's personal IBAN, the payer is read for the
   counterparty name and bank details, and a `bank_tx` row is created keyed on the Fiat Republic
   payment id (`accountServiceRef`).

**Backstop:** Fiat Republic retries a webhook ten times over roughly ninety minutes and then gives
up. `BankTxFiatRepublicService.checkTransactions` re-reads the same payments from the API on the
regular `BANK_TX` cycle and imports whatever the webhook did not. The two paths are idempotent
against each other through the unique `accountServiceRef`. The window is read to its end, page by
page — a truncated read is never reported as complete.

### The watermark, and why it can lag

The cursor lives in the setting `lastBankFiatRepublicDate:<bankId>`. It advances only after a
non-empty window was fully persisted, and never past **the oldest payin that has not settled yet**.

That clamp is the important part. Fiat Republic filters on `createdAt`, and a payin held in
compliance review keeps that date while its status changes days later. A cursor that moved to
wall-clock-minus-overlap would drop such a payment out of every future window before it ever reached
`COMPLETED` — and with webhook delivery also failed, the money would arrive and never be booked.
Otherwise the cursor keeps the usual two-day overlap.

The consequence is deliberate: while a payin stays non-terminal, the polling window grows. That is
the safe direction (re-read too much rather than skip), but it is not free.

**What to watch for.** If a payin never reaches a terminal state, the window eventually exceeds the
paging budget and `checkTransactions` logs

```
Failed to fetch Fiat Republic payments: ... Fiat Republic payment window exceeded 50 pages
```

on every cycle, with the cursor frozen. The rail keeps working through webhooks, but the backstop is
dead until someone intervenes — so **alert on that log line**. It means a payment has been stuck at
Fiat Republic long enough to need a support ticket; resolving it there (or having Fiat Republic
terminate it) lets the cursor move again on its own.

---

## 4. Payout path

Per fiat output assigned to Fiat Republic:

1. **Payee** — created once per (end user, IBAN, name) and reused (`fiat_republic_payee`). The name
   is part of the key because Verification of Payee validates the holder name against the IBAN.
2. **Verification of Payee** — mandatory for SEPA EUR, single-use, expires after ten minutes.
   Created immediately before the payment, never cached. A `CLOSE_MATCH`/`NO_MATCH` is a definitive
   answer from the beneficiary bank, not an error, and is accepted automatically — the payee is an
   IBAN DFX itself holds under KYC for that customer. The observed level is persisted on the row
   (`fiatRepublicMatchLevel`), so an accepted mismatch stays auditable.
3. **Payment** — `SCT`, with the row's deterministic `DFX-FO-<id>` as the idempotency key, sent from
   the customer's own virtual account when they have one, otherwise from the master account.
4. **Status** — polled hourly until terminal.

### Row reservation

`fiatRepublicCustomId` is both the mutex and the idempotency key. It is written in a conditional
`UPDATE … WHERE fiatRepublicCustomId IS NULL`, so at most one process ever reaches `createPayment`
for a row. `fiatRepublicReference` is written in the same statement because reconciliation matches
on it.

If the create outcome is unknown, the status job looks the payment up by that reference across the
window. Found → adopt and heal. Proven absent **and** nothing was transmitted → release the claim so
transmission retries with the same deterministic id. A lookup that could not complete propagates as
an error: "not found" and "could not look" must never collapse into the same answer for a payout.

The status job skips a row reserved within the last five minutes that has not produced a payment id
or status yet. Such a row may have a `createPayment` call in flight right now (up to the client's
30s timeout): looking it up would correctly find nothing, and releasing the claim on that basis
would let the minutely transmission start a second attempt against a payment already on its way.
A row whose transmission really did crash is picked up on the next hourly pass.

The payee create carries an idempotency key derived from its claim row, so a retry after an
ambiguous failure — and a second concurrent payout to the same beneficiary — both resolve to the
original payee instead of creating a duplicate.

### Liquidity

A Fiat Republic payout keeps its amount reserved until the payment reaches a terminal state
(`COMPLETED`, `REJECTED`, `FAILED`, `RETURNED`) — a payment can sit in `COMPLIANCE_REVIEW` or
`AWAITING_APPROVAL` for a while, and releasing it early would let a later payout overdraw.

While `FiatOutputFiatRepublicService.canCreatePayments()` is false, an assigned row is never marked
ready: it must not consume liquidity for a rail that cannot currently send.

---

## 5. Routing: the flag decides participation, `sendPriority` decides order

Stage 4 makes Fiat Republic *eligible* for automatic payout selection. Which of the eligible banks
actually wins stays an operational decision through `Bank.sendPriority` (lower wins), exactly as it
is for every other bank. To move EUR payouts away from Olkypay:

1. Turn on stage 3, verify a manually assigned payout end to end.
2. Turn on stage 4.
3. Set the Fiat Republic row's `sendPriority` below Olkypay's.

Rolling back is the reverse and leaves in-flight rows untouched: turning routing off stops new
assignments, it does not un-assign anything already assigned.

Bank Frick remains categorically excluded from automatic payout selection, independently of all of
the above.

---

## 6. Compliance boundary (AUP)

DFX committed in writing that products and customer segments outside Fiat Republic's risk appetite
run exclusively through the other banking partners and never touch the Fiat Republic platform. Two
things enforce that in code:

- `Bank.isCountryEnabled` gates Fiat Republic through the same country allowlist as the other EU/EEA
  rails, rather than leaving it open to every country.
- Stage 2 gates whether a customer is ever shown a Fiat Republic IBAN at all.

Extending the rail to a new segment is a compliance decision first; the country flag is where it is
expressed.

---

## 7. Mandatory sandbox checklist

Run against the sandbox before enabling any stage in production:

1. **Auth** — a token is obtained, cached, and refreshed after expiry (`FiatRepublicService`).
2. **End user** — created once for a test customer; a repeated request reuses the same
   `fiat_republic_end_user` row and never creates a second end user.
3. **Virtual account** — created with `ibanCountry=DE`, reaches `ACTIVE` with an IBAN, and the IBAN
   is persisted as a `virtual_iban` row with the account id in `providerAccountRef`.
4. **Payin** — simulate one (`POST /simulator/payment` or the dashboard's *Add Funds*), confirm the
   webhook signature passes, and confirm exactly one `bank_tx` row appears with the payment id as
   `accountServiceRef`.
5. **Payin deduplication** — replay the same webhook; no second `bank_tx` row.
6. **Compliance hold** — a payment delivered in `COMPLIANCE_REVIEW` must not be booked.
7. **Payout** — a payee is created, verification returns a match level, the payment is accepted, and
   the row carries `fiatRepublicPaymentId`, `isTransmittedDate` and the match level.
8. **Payout idempotency** — replaying the transmission with the same custom id does not create a
   second payment.
9. **Rejection** — a payment terminating in `REJECTED`/`FAILED` leaves its reason on the row and does
   not mark the output complete.
10. **Kill switches** — with each of the three `DISABLED_PROCESSES` entries set, the corresponding
    job does nothing.
11. **Dark check** — with `FIAT_REPUBLIC_ENABLED` unset, none of the above happens at all, and the
    webhook endpoint answers 403.

---

## 8. Coverage gate

`npm run test:fiat-republic:cov` pins every file of the rail at 100% (branches, functions, lines,
statements), running under full compilation (`tsconfig.coverage.json`) so decorator-metadata emit
does not skew the branch count. It runs as its own CI step, like the Bank Frick gate — see
[coverage-gate.md](coverage-gate.md).

Adding a file to the rail means adding it to `jest.fiat-republic.config.js`, to the
`--collectCoverageFrom` list in the `test:fiat-republic:cov` script, and covering it.
