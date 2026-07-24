# Bank Frick — Operations Runbook

Operational notes for the Bank Frick statement import (`BankTxFrickService`), payout rail
(`FiatOutputFrickService`), registry placeholders and cryptographic activation. Bank Frick must
remain disabled until every activation check below has passed.

## 1. Bank Frick watermark backfill

### Background

The poller tracks progress per receiving Bank Frick account via the setting key
`lastBankFrickDate:<bankId>` (`bankId` = the `Bank` row id, not the IBAN). It advances only after a
**non-empty** response was fully persisted, to
`min(now, latest processed booking date) − FRICK_WATERMARK_OVERLAP_DAYS` (currently two days).
Empty, structurally invalid and partially persisted responses do not advance it. The setting
update uses a transaction-scoped PostgreSQL advisory lock and a monotonic comparison, so a stale
worker cannot move the value backwards. Duplicate re-fetches inside the overlap window are
expected and are absorbed by the existing `accountServiceRef` uniqueness check.

Bank Frick does not expose an ingestion cursor. If an entry becomes visible with a booking date
**older than the overlap window already covered**, the watermark will not pick it up on its own —
this requires a manual rewind. Conversely, an idle account whose first fetch is empty retains its
seeded value; this is deliberate and is why initial seeding is mandatory.

### When to intervene

- Support/Finance reports a booking that is missing from `bank_tx` and its booking date is
  older than `now − FRICK_WATERMARK_OVERLAP_DAYS` relative to when it was first pollable.
- A Bank Frick account was inactive/misconfigured for a period and needs its history
  re-imported once fixed.
- Before activating polling for a **newly added** Bank Frick account (initial seed, see below).

### Procedure

1. Confirm the missing entry actually exists on the Bank Frick side (camt.053 export or their
   portal) and note its booking date and `accountServiceRef`.
2. Identify the affected `bankId` (the `Bank.id` for the Bank Frick IBAN in question).
3. Rewind the setting key to a timestamp before the missing entry's booking date, with margin:
   ```sql
   UPDATE setting
   SET value = '<ISO-8601 timestamp, e.g. 2026-06-01T00:00:00.000Z>'
   WHERE key = 'lastBankFrickDate:<bankId>';
   ```
   If the key does not exist yet, insert it instead of updating.
4. Let the next scheduled poll run (or trigger it manually in a lower environment first if
   unsure). The service re-fetches everything from the new watermark forward.
5. **Watch for duplicate-conflict volume** on the affected account for the next few poll
   cycles — every entry between the rewound watermark and the original one will be re-fetched
   and is expected to hit the `create()` dedup (`ConflictException`, logged as handled, not as
   an error). A spike here right after a rewind is normal; it should die down once the
   watermark catches back up to where it was.
6. If genuinely new `bank_tx` rows are created, verify them against the source statement and
   hand off to Finance/Support as usual.
7. Do not rewind further back than necessary — a very old watermark on a busy account causes a
   large one-off re-fetch and a correspondingly large burst of dedup conflicts.

### Initial seed for newly activated accounts

When a new Bank Frick receiving account is added, its `lastBankFrickDate:<bankId>` key does not
exist yet and defaults to the epoch (`1970-01-01`) on first poll. Seed the setting key explicitly
**before** flipping `Bank.receive` to `true`, to the earliest date that should be imported (or
`now`, if only new activity should be picked up). Do not enable an account with an epoch cursor.

## 2. `Iso20022Service`'s deterministic reference does not affect existing Raiffeisen/Yapeal imports

`Iso20022Service.parseCamt053Json`'s reference-less-entry fallback now derives a deterministic,
content-scoped hash instead of a random string. This does **not** create a duplicate-`bank_tx`
risk for Raiffeisen or Yapeal, because neither bank's actual import-and-create path runs through
this fallback:

- Raiffeisen's `bank_tx` creation uses the entirely separate `SepaParser`, with its own
  independent reference scheme (`CUSTOM/<iban>/<date>/<narrative>`) - it never calls
  `Iso20022Service` at all.
- Yapeal's only call into `Iso20022Service.parseCamt053Json`
  (`BankTxService.enrichYapealTransactions`) uses the result solely to **enrich already-existing**
  `bank_tx` rows (matched by their already-stored `accountServiceRef`) with address/bank-transaction-
  code fields - it never creates a `bank_tx` row.

No monitoring or manual cleanup pass is required for either bank as a result of this change.

## 3. Registry and default-off activation

The migration never creates, updates or deletes a `bank` row. The only prior migration that ever
inserted one (Yapeal EUR) was reverted (`f897b98a2 chore: remove migration (already inserted
manually)`) because the row is a manual production step, not something a schema migration should
own. The two new Bank Frick account rows are created the same way, manually, as part of this
runbook. The local seed (`migration/seed/bank.csv`) keeps clearly synthetic, checksum-valid
IBANs/ids for a fresh local database only - it is never applied to production (`migration/seed/
seed.js` hard-blocks any non-local host/environment).

### 3.1 Manually insert the two new Bank Frick accounts

The real Bank Frick CT account IBANs for the new account:

- **EUR: `LI75088110105923K000E`**
- **CHF: `LI32088110105923K000C`**

Run manually against production. BIC is `BFRILI22` for both rows (it identifies Bank Frick itself,
not the individual account, so it is the same as the existing legacy rows' BIC):

```sql
-- Defensive: this INSERT relies on bank_id_seq via the identity column. Explicit-id inserts
-- elsewhere in this codebase (see migration/seed/seed.js) are a known source of a lagging
-- sequence; bump it first so this insert can never collide with a not-yet-advanced sequence.
SELECT setval('bank_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM "bank"), (SELECT last_value FROM bank_id_seq)));

INSERT INTO "bank"
  ("updated", "created", "name", "iban", "bic", "currency", "receive", "send", "sctInst", "amlEnabled", "sendPriority")
VALUES
  (NOW(), NOW(), 'Bank Frick', 'LI75088110105923K000E', 'BFRILI22', 'EUR', FALSE, FALSE, FALSE, TRUE, 2000),
  (NOW(), NOW(), 'Bank Frick', 'LI32088110105923K000C', 'BFRILI22', 'CHF', FALSE, FALSE, FALSE, TRUE, 2000);
```

`receive`, `send` and `sctInst` all start `FALSE` and `sendPriority` starts at `2000` (worse than
every pre-existing row's backfilled `1000`), so inserting these rows changes nothing about current
routing by itself - Ops must deliberately flip flags/lower the priority per the steps below.

### 3.2 Retire the legacy Bank Frick rows

Bank Frick was integrated once before and removed; three legacy `Bank Frick` rows (the old
account's IBANs, `receive=false`/`send=false`) were never cleaned up. Once the new rows above
exist, `(name, currency)` would match two rows each for EUR/CHF unless the legacy rows are
retired. **Decision: rename, not delete** (keeps history/audit trail intact). Run manually against
production, immediately after 3.1:

```sql
UPDATE "bank"
SET "name" = 'Bank Frick (legacy)'
WHERE "name" = 'Bank Frick'
  AND "receive" = FALSE AND "send" = FALSE
  AND "iban" NOT IN ('LI75088110105923K000E', 'LI32088110105923K000C');
```

This is scoped so it can never match the two new rows inserted in 3.1 (excluded by IBAN) or any
row that is actually live - `receive`/`send` both `FALSE` only matches the dormant legacy rows
today. To roll back (rename the legacy rows back), reverse the `SET`:

```sql
UPDATE "bank" SET "name" = 'Bank Frick' WHERE "name" = 'Bank Frick (legacy)';
```

As defense in depth independent of this cleanup step, `BankService.getBankInternal`/
`loadIbanCache` now deterministically prefer the highest `Bank.id` per `(name, currency)` - the
newest row always wins a name/currency collision even before (or if ever again after) this cleanup
runs.

### 3.3 Activate

1. Set `receive`, `send` and `sctInst` from the confirmed account-role matrix. Never infer these
   flags from currency. **A Frick row used for `send=true` must also have `receive=true`** - a
   send-only Frick row can never see its own booked debit come back on a statement, so it can never
   reach `isComplete` and its reserved liquidity silently never releases. This combination is
   checked and logged loudly on every `BankTxFrickService` poll cycle, but must not be relied upon
   as the primary safeguard - set the flags correctly up front.
   Before setting `send=true`, link the row to the correctly configured custody/liquidity asset and
   verify that its balance is refreshed; payout readiness deliberately requires that balance.
   Instant outputs additionally require `sctInst=true`; a row without that confirmed capability is
   excluded from instant routing.
2. Seed `lastBankFrickDate:<bankId>` before setting `receive=true`.
3. Leave `FiatOutputFrickTransmission` and `FiatOutputFrickStatusCheck` in the `disabledProcess`
   setting until the sandbox checklist below is complete. The migration adds both without
   removing or duplicating existing process switches.
4. Enable the status process before (or in the same controlled change as) transmission. If new
   payout creation is later stopped, keep status polling enabled until all existing Frick orders
   are terminal or reconciled.
5. Set `Bank.sendPriority` deliberately before enabling a Frick `send` flag. Lower value is tried
   first; every pre-existing row defaults to `1000` and the new Frick rows are inserted at `2000`
   (3.1), so enabling Frick's `send` flag changes nothing by default - Frick coexists with, but
   loses ties against, the incumbent (Olkypay/Yapeal) until Ops explicitly lowers its priority
   below `1000` to cut traffic over. Two eligible banks sharing the exact same priority for a
   currency is treated as a genuine misconfiguration and leaves the output unassigned until Ops
   resolves the tie.

The API also refuses to assign or ready a new Frick payout while creation is unavailable. If
another eligible sender bank exists it is selected instead; otherwise the output remains
unassigned, not stranded inside a disabled Frick rail.

## 4. Required cryptographic configuration

All values remain blank in `.env.example`. Deployment must provide:

- `FRICK_BASE_URL`, `FRICK_API_KEY`, `FRICK_CUSTOMER`
- `FRICK_PRIVATE_KEY` — client signing key, PEM with `<br>` line separators
- `FRICK_SERVER_PUBLIC_KEY` — Bank Frick response-verification key, PEM with `<br>` separators;
  obtain it from Bank Frick through the authenticated onboarding channel
- `FRICK_PAYOUT_ENABLED=true` only after inbound verification
- `FRICK_APPROVE_WITHOUT_TAN=true` only after Bank Frick confirms backend exemption
- `FRICK_VBAN_BASE_URL` — base URL of Bank Frick's separate VBAN API (test
  `https://api-test.bankfrick.li/vban`, production `https://api.bankfrick.li/vban`), used to issue
  EUR personal IBANs; opt-in — when unset, the Frick virtual-IBAN provider is unavailable and there
  is no behaviour change

`BankFrickService.isAvailable()` requires both keys. Every request signs the exact serialized
body. Every response remains raw text until its detached `Signature` and `algorithm` headers have
been verified (`rsa-sha512`, `rsa-sha384` or `rsa-sha256`); only then is JSON parsed. A missing key,
header, unsupported algorithm or signature mismatch fails closed.

## 5. Payout and reconciliation decisions

- EUR uses `SEPA` or `SEPA_INSTANT`; instant is never sent for non-EUR.
- EUR creation additionally requires a SEPA-country creditor IBAN and the existing automated-bank
  country allowlist (`Country.yapealEnable`). Unsupported routes fail before a bank order is created.
- CHF uses Bank Frick `FOREIGN` because that is the selected JSON contract. A missing creditor BIC
  is resolved through SepaTools and accepted only when exactly one unique candidate exists. The
  default charge is `SHA`; an explicit `BEN`/`OUR`/`SHA` value is preserved.
- Every bank reference begins with `DFX-FO-<fiatOutputId>` and is capped at 140 characters. User
  remittance text follows the stable identifier, so the statement echo remains unique.
- Approval uses a safely representable Bank Frick `orderId` where available. It falls back to the
  OpenAPI `customIds` selector when JSON cannot represent the int64 safely.
- With `FRICK_APPROVE_WITHOUT_TAN=false`, a created order deliberately remains `PREPARED` until an
  operator approves it in the Bank Frick portal; the independent status poll continues tracking it.
  Enable automatic approval only after Bank Frick has confirmed the backend TAN exemption.
- Reconciliation accepts exactly one debit transaction with the same source account, amount,
  currency, readiness window and reference/end-to-end ID. Zero matches wait; multiple matches fail
  closed and never mark the output complete.

## 6. Mandatory sandbox checklist

Do not remove the default process switches until all items are evidenced with Bank Frick test or
sandbox credentials:

1. Verify authorize, accounts and camt.053 responses with the environment-specific server key.
2. Import an official-shape camt.053 containing offset dates, `Pty` wrappers and entry-level bank
   transaction codes; reconcile the resulting row to the source statement.
3. Confirm the real CHF routing contract (`FOREIGN`, creditor BIC and `SHA`) with one harmless test
   order. If Bank Frick requires a domestic type instead, change the mapping before production.
4. Confirm `signTransactionWithoutTan` accepts `orderIds` and the configured token exemption. Keep
   automatic approval disabled if this has not been confirmed.
5. Confirm the booked statement echoes the full `DFX-FO-<id> ...` reference and that the strict
   reconciliation query completes exactly one fiat output.
6. Exercise 401 re-authorization, invalid response signature, ambiguous BIC, ambiguous bank match,
   empty statement and import-persistence failure; each must leave money/cursors unchanged.
7. Enable `FiatOutputFrickStatusCheck`, observe clean polling, then enable
   `FiatOutputFrickTransmission` in a separate controlled step.
8. Verify with a real camt.053 sample that Bank Frick books a charged debit **gross**
   (`Ntry/Amt` inclusive of `Chrgs`), matching what the #8 net-of-charge reconciliation fix
   (`bank-tx-outgoing-match.service.ts`) assumes. If Bank Frick ever books net instead while still
   sending a `Chrgs` element, the matcher would subtract a phantom charge from an already-net amount
   and the payout would never reconcile - this can only be confirmed against a real booked statement,
   not from the API documentation alone. The matcher and `BankTxService.fillBankTx`'s accounting
   (which now also treats a DEBIT row's `amount` as gross and does not add `chargeAmount` back on top)
   both encode the same gross-booking assumption - if this verification ever concludes Bank Frick books
   net instead, both must be re-aligned together, not just the matcher.
9. Verify that a payment order just created via `PUT /transactions` is immediately visible through
   `GET /transactions?customId=...` (read-after-write). If Bank Frick can transiently return no
   result right after creation, the #6 self-heal in `checkFrickOrderStatus` could misread that as
   "order was never created", clear the reservation, and trigger a re-`PUT` for the same customId.
   Confirm this with a real sandbox order before enabling automatic status polling.

## 7. Coverage gate on the shared `iso20022.service.ts`

`jest.frick.config.js`'s `coverageThreshold` holds `src/integration/bank/services/iso20022.service.ts`
to 100% even though this file is shared with Yapeal/Raiffeisen parsing, not Frick-only. This is a
deliberate trade-off, not an oversight: the money-critical fixes in this PR (malformed-entry
rejection, the missing-bank-reference guard, and bank-charge parsing) live in exactly this file,
and 100% branch coverage is the only mechanical guarantee that a future change cannot silently
regress them. The cost - a future, unrelated Yapeal/Raiffeisen-only change could fail CI on an
uncovered branch it didn't intend to touch - is accepted deliberately in exchange for that
protection. If this ever becomes a real blocker, the long-term fix is to split the Frick-specific
strict-mode parsing into its own file with its own gate, not to lower this threshold.

The `test:frick:cov` gate compiles with full type information (`tsconfig.coverage.json`, which sets
`isolatedModules: false`), unlike the main test run. The main suite uses ts-jest transpile-only
(`isolatedModules`) for speed, but transpile-only emits the `emitDecoratorMetadata` helpers
differently and adds phantom uncovered branches on dependency-injected constructors, which would red
this 100% gate. Compiling the coverage run the same way as the production build keeps the gate exact.
