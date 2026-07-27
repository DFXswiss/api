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
- `FRICK_VBAN_API_URL` — base URL of Bank Frick's separate VBAN API (test
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
(`isolatedModules`) for speed. That mode has two known consequences:

1. **Coverage counting:** transpile-only emits the `emitDecoratorMetadata` helpers differently and
   adds phantom uncovered branches on dependency-injected constructors, which would red this 100%
   gate. Compiling the coverage run the same way as the production build keeps the gate exact.
2. **Entity column reflection (runtime, not just coverage):** when a TypeORM `@Column` TypeScript
   type is a non-primitive imported from another file (e.g. an enum) and the decorator has no
   explicit `type:`, TypeORM relies on `design:type` from `emitDecoratorMetadata`. Transpile-only
   cannot reliably resolve cross-file value-vs-type imports and may emit `Object` instead of the
   real enum reference — which then crashes Postgres DataSource init with
   `DataTypeNotSupportedError: Data type "Object" … is not supported`. Entity columns whose
   TypeScript type is a cross-file non-primitive **must always declare an explicit `type:`**
   (e.g. `type: 'varchar'`), independent of `length` / Reflection. Same-file enums are safer under
   transpile-only but should still use explicit `type:` for consistency if the enum might later
   move.

## 8. Periodic Frick vIBAN issuance reconciliation

### Request path is fail-closed (no self-heal)

On the customer request path, an empty Frick recovery listing is **not** treated as proof of
non-existence (a concurrent create may still be mid-flight at Bank Frick). `VirtualIbanService`
therefore **never** resets the intent, rotates `requestReference`, or re-enters issuance after an
empty listing: it fails the call (`ServiceUnavailableException`) and leaves the intent row
exactly as the create attempt left it (`InFlight` / `Failed`). The only reopener after that is
the hourly reconciliation job below.

### Two-phase hourly job

`VirtualIbanFrickIssuanceReconciliationService.reconcileRetiredIssuanceReferences`
(`@DfxCron` process `VirtualIbanFrickIssuanceReconciliation`) is the sole place that reopens
stuck intents. It does so only on the strongest evidence Bank Frick exposes: a complete,
fully validated, reference-account-scoped listing across **all lifecycle states** that starts after
the maximum locally bounded create-processing window and contains no exact `description` match.
This evidence is deliberately necessary, but it is **not authoritative proof of non-creation**:

- **Schedule:** every hour (`CronExpression.EVERY_HOUR`)
- **Rail guard:** silent no-op when `FrickVibanProvider.isAvailable()` is false (vIBAN rail not
  configured)
- **`timeout: 1800` (resumption, not abort):** LockClass (`src/shared/utils/lock.ts`) treats 1800s
  as a *resumption threshold*, not a hard abort of a still-running previous tick. A run older than
  1800s no longer blocks a new hour-tick, so two overlapping invocations are possible. Phase-1
  reset stays safe under overlap by construction:
  `VirtualIbanService.resetStuckFrickIntentForReconciliationOnly` wraps the write in a per-row
  `pessimistic_write` transaction that re-checks `requestReference` under lock, serializes
  concurrent attempts on the same intent row, and no-ops the loser (returns `false`).
- **Shared listing cache:** both phases list Frick vIBANs **per intent/event `bankId`** (not a
  single hardcoded EUR account) and share a per-run `bankId → listing` cache so the same bank is
  never listed twice in one run.
- **On unhandled phase failure:** fail-closed `ERROR_MONITORING` alert that the check itself
  could not run — absence of a match alert is **not** evidence of a clean state. Phases are
  independent try/catch blocks so a Phase-1 failure still allows Phase 2 to run (and vice versa).

Kill-switch: disable process `VirtualIbanFrickIssuanceReconciliation` via the standard disabled-
processes setting.

#### Phase 1 — reopen stuck InFlight/Failed intents (mutating, evidence gated)

1. Load every issuance intent with status `InFlight` or `Failed`, then **exclude** permanently
   merge-superseded intents (`error` contains `MERGE_SUPERSEDED_MARKER`) — those must never be
   reopened.
2. Group remaining intents by `bankId` and list Frick vIBANs for that bank's reference IBAN
   (`FrickVibanProvider.listByReferenceAccount`).
3. For each eligible intent, compare the listing's `description` set to the intent's current
   `requestReference`:
   - **Listing match** (object already exists under the current reference) → collect for an
     `ERROR_MONITORING` alert; **change nothing** on the intent. Manual operator follow-through
     required (no auto-cleanup at Bank Frick).
   - **Not found across every Frick lifecycle state, listing fully validated, intent older than the
     safety threshold, and the listing began after the intent-specific latest possible
     create-processing moment** → first send
     `Frick vIBAN reconciliation Phase 1: non-authoritative listing miss will arm automatic retry`
     with the exact technical reference and operator check, then call
     `resetStuckFrickIntentForReconciliationOnly` (sole reopener):
     reset to `Pending` with a **fresh** `requestReference`, event-logged. The abandoned (old)
     reference remains only in the append-only `virtual_iban_issuance_event` log (`nextError` on
     the transition into `Pending`).
     The alert is sent before the reset; if alert delivery fails, the reset does not run.
   - **Not found, but listing timing is not later than the maximum create-processing window** →
     keep the intent
     `InFlight`/`Failed`, keep the same reference, and send
     `Frick vIBAN reconciliation Phase 1: listing does not prove create absence`. Manual
     reconciliation is required; no automatic retry is enabled from that observation.
   - **Not found but still fresh** (`intent.updated` younger than the threshold) → skip until a
     later run.
   - **Listing not fully validated** (per-entry validation drops) → treat as **inconclusive** for
     that bank: still surface any positive matches (they are evidence), but **never** reset on
     "not listed"; send a separate incomplete-listing alert. Absence of a match alert is not a
     clean state.

The listing result carries `listingStartedAt` (captured immediately before page 0 is dispatched)
and `listingCompletedAt` (captured after the final page validates). Invalid/reversed timestamps fail
the bank for that run. For each intent, the code computes
`latestPossibleCreateProcessedAt = intent.updated + FRICK_CREATE_MAX_PROCESSING_MS`. The listing
must start strictly after that instant; checking `Date.now()` against an age threshold is weaker
and is not accepted. Even a correctly ordered listing miss remains non-authoritative because Bank
Frick provides no authoritative “this create did not happen” operation.

`FRICK_CREATE_MAX_PROCESSING_MS = 90_000` is derived from
`BankFrickService.HTTP_TIMEOUT_MS = 30_000`:

- create call worst case = 90s: original request (30s) + `/authorize` re-auth after 401 (30s) +
  one-shot retried request (30s). `requestSigned` has no further internal retry beyond that.
- the create side effect can therefore occur no later than 90s after the persisted intent update
  used by the gate

The separate 30-minute `FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS` remains as a conservative
operational delay, but it never substitutes for the per-listing ordering requirement.

Immediately before resetting, the service locks the intent row and repeats the ordering check
against the locked row's current `updated` timestamp. If a concurrent attempt has moved that
timestamp beyond the listing's observation window, it leaves the intent non-retryable and alerts
instead.

If Bank Frick later creates a vIBAN under a **retired** reference after Phase 1 rotated away from
it (e.g. a delayed/queued create), that external account can sit active and unmonitored — Phase 2
exists to detect that case.

#### Phase 2 — retired-reference orphan scan (alert-only)

Phase 2 scans the event log for previously **retired** references and alerts when Bank Frick still
shows an object under one. It is **alert-only**: it never mutates intents or Bank Frick state.

**Where retired references come from** (writers of the durable markers in `nextError`):

1. **Phase 1 reset** (`resetStuckFrickIntentForReconciliationOnly`) — current writer format:
   `reconciliation: strongest available post-create listing found no match (non-authoritative); previousRequestReference=<old>; newRequestReference=<new>`
2. **Deactivation-reopen** (`mergeUserLevelVirtualIbans` → private `deactivateVirtualIbanLocked`) —
   merge-conflict deactivation of a Frick-backed `virtual_iban` that still has a `Completed`
   intent pointing at it:
   `virtual IBAN <id> deactivated; previousRequestReference=<old>; newRequestReference=<new>`
3. **Historical recovery-path events** from older builds (parser-only; request path no longer
   writes this shape):
   `recovery listing found no match under requestReference=<old>; …`
4. **Account-merge supersede** (`resolveIssuanceIntentsForMergeLocked` / `resolveMergedVirtualIbanPairLocked`
   via `failFrickIntentLocked`) — permanently retires a non-terminal intent when merge consolidates
   the (currency, bank) pair. Embeds both `MERGE_SUPERSEDED_MARKER` (so finalize and Phase 1 refuse
   revival) and `CREATE_PATH_REFERENCE_MARKER` (so Phase 2 still scans the retired reference):
   `Superseded by account merge of userData <slaveId> into <masterId>; merge-superseded; previousRequestReference=<old>`

Markers (shared constants on `VirtualIbanService`):

- `CREATE_PATH_REFERENCE_MARKER` = `previousRequestReference=` — current writer format (Phase 1 +
  deactivation-reopen + merge supersede)
- `RECOVERY_PATH_REFERENCE_MARKER` = `recovery listing found no match under requestReference=` —
  retained so Phase 2 still parses any historical events from older builds
- `MERGE_SUPERSEDED_MARKER` = `merge-superseded` — permanent retirement marker written only by the
  merge-fail path; `finalizeFrickIssuance` and Phase 1 refuse to complete/reopen over it

The **request path never retires references** and never writes these markers.

**No rolling lookback window:** every matching issuance-event transition is loaded and kept under
scan indefinitely. A still-unresolved abandoned reference must keep being checked and (on match)
alerted; silent-forgetting after a day count is intentionally not used. Volume stays small because
these events are rare crash-only-recovery / deactivation artifacts.

Per bank (same listing cache as Phase 1): if the listing is fully validated, any abandoned
reference whose `description` appears is a match; if the listing is not fully validated, positive
matches are still alerted but unmatched abandoned references are **not** treated as clean
(incomplete-listing alert).

On a match: one `ERROR_MONITORING` alert listing each hit with `abandonedReference` / `eventId` /
`intentId` / `userDataId` / `currencyId` / `bankId` / event `created`. **No auto-cleanup** of Bank
Frick or local state — **manual operator follow-through is required**.

### What the job looks for (Phase 2 SQL)

It queries `virtual_iban_issuance_event` for any transition whose `nextError` text contains either
marker — **no `nextStatus` gate and no time bound**. Marker presence alone identifies a reference-
retirement event: Phase-1 / deactivation-reopen writers use `nextStatus = Pending`; merge-supersede
uses `nextStatus = Failed` with the same `previousRequestReference=` marker so permanently retired
references stay under scan.

```sql
SELECT id, created, intentId, userDataId, currencyId, bankId, previousStatus, nextStatus, nextError
FROM virtual_iban_issuance_event
WHERE nextError LIKE '%previousRequestReference=%'
   OR nextError LIKE '%recovery listing found no match under requestReference=%'
ORDER BY created DESC;
```

Extract each abandoned reference from the `nextError` text (`previousRequestReference=…` or
`under requestReference=…`, value ends at the next `;` or end of string). A row that matches the
LIKE clause but has an empty value after the marker (e.g. `previousRequestReference=;…`) cannot be
parsed — that candidate is alerted via `sendUnresolvedAbandonedReferenceAlert` (see below), not
treated as a Frick listing match. When Phase 2 finds a listing match, `sendMatchAlert` already puts
the exact extracted `abandonedReference` into the alert email body
(`abandonedReference=…; eventId=…`) — operators do **not** need DB access for the normal orphan
alert path. Direct DB access to `nextError` / `previousError` (or an equivalent privileged tool) is
the fallback for **ad-hoc** investigation and for unextractable-marker rows (where the free-form
`nextError` text itself must be inspected). `/gs/debug` deliberately does **not** allowlist those
free-form columns, so the debug endpoint is not that fallback.

### What it reconciles against

Both phases list Bank Frick virtual IBANs **per bank and across every lifecycle state**, not against
one hardcoded EUR reference account. For each distinct `bankId` on the intents (Phase 1) or abandoned-reference events
(Phase 2), the job resolves `Bank.iban` via `BankService.getBankById` and calls
`FrickVibanProvider.listByReferenceAccount` (no lifecycle-state filter). Comparison is exact equality of
listed `description` to the intent's current `requestReference` (Phase 1) or the extracted
abandoned reference (Phase 2). A missing bank IBAN throws inside that bank's processing and is
caught by the per-bank `try/catch` in both phases: only that one bank is skipped
(`sendPerBankFailureAlert`); every other bank in the same run continues normally. Absence of a
match alert for the skipped bank is **not** evidence of a clean state.

### What to do on a match (operator follow-up)

Applies to **Phase 1 listing matches** (stuck intent already present at Frick under the current
reference) and **Phase 2 orphan matches** (Frick still holds a vIBAN under a retired reference).
In both cases the job does **not** deactivate, delete, or auto-bind anything at Bank Frick —
only the Phase-1 not-found-and-old-enough path self-heals by reopening the local intent.

1. From the alert (or the same event/intent row), note `userDataId`, `currencyId`, `bankId` (and
   `intentId`) to identify which customer / currency / bank the reference belongs to.
2. Decide the manual reconciliation path (same fail-closed, hands-on style as section 1
   watermark rewinds and section 5 multi-match payouts):
   - If the customer already has a correct local `virtual_iban` for that currency/bank,
     **deactivate the stray Frick-side object** in the Bank Frick portal/API so it cannot
     receive untracked funds.
   - If local state is incomplete and the Frick-side vIBAN is the only live receiving
     account, **bind it to the correct local record** (or complete issuance under support
     supervision) rather than leaving an unmonitored IBAN live.
3. Do not invent a second automated recovery path here; treat every match as an ops incident
   until local and Frick state agree, then record what was done for audit.

### Residual risk: the retained auto-retry can still create a second real account

Product decision: automatic retry after an ambiguously failed issuance attempt is **kept**. A
customer must be able to proceed without waiting for manual intervention. That choice leaves a
genuine, narrow residual risk — not a defect, but a known and accepted trade-off.

Despite the safeguards added for this feature (fail-closed request-path empty listing behaviour,
requestReference/ownership lock-time checks on finalize, Phase 1 complete all-state listing gate,
atomic merge dissolution), a second
real Bank Frick account can still be created for the same customer/currency/bank triple under a
specific rare interleaving. Typical shape:

1. Bank Frick **genuinely completes** a create that the calling process never learns the outcome of,
   but its later fully validated, all-state listing still omits that object. Listing absence is not
   authoritative, regardless of the listing request starting after the locally derivable latest
   create-processing instant (for example, undocumented bank-internal queueing, filtering, or
   read-model lag).
2. Phase 1 accepts that ordered empty observation, rotates the stuck intent to a **fresh**
   `requestReference`, and a later customer retry issues a second, independent create.
3. Locally only one of the two objects is bound (`virtual_iban` / completed intent). The other
   remains live at Bank Frick under the retired reference.

If the listing starts too early, has invalid timing metadata, is incomplete, or is not an all-state
reference-account listing, the code does **not** reopen: it alerts and leaves the intent/reference
for the manual reconciliation procedure above. When every gate passes, the code alerts **before**
reopening because the remaining listing miss is still ambiguous. The accepted worst case is a
second external account that cannot be revoked by rolling back local state.

**How operations detects it:**

- **Phase 1 automatic-retry risk alert**: subject
  `Frick vIBAN reconciliation Phase 1: non-authoritative listing miss will arm automatic retry`.
  The alert is sent before the reset call, but the reset follows immediately; this is an
  observability signal, **not** a human approval gate. Check the Bank Frick portal/API promptly
  across **every lifecycle state** for the exact `requestReference` and the referenced bank account
  from the alert, ideally before a later customer request can issue again. If an object is present,
  prevent another create and reconcile it manually. If the bank portal also shows no object, the
  retry may still produce a second non-revocable external account; monitor the retired reference
  through Phase 2.
- **Phase 1 listing-match alert** (`sendStuckIntentMatchAlert`): subject
  `Frick vIBAN reconciliation Phase 1: stuck intent(s) already exist at Bank Frick`. A stuck
  intent whose **current** `requestReference` is already on a Frick listing — nothing was
  actually lost; a retry never got a chance to fire a second create. Manual follow-through only
  (the job changes nothing on the intent).
- **Phase 2 orphan alert** (`sendMatchAlert`): subject
  `Frick vIBAN retired-reference reconciliation: orphan external vIBAN(s) detected`. A **retired**
  reference still resolves to a live Frick object — the case where a genuine duplicate account was
  created (or a delayed create landed under a reference Phase 1 had already rotated away).
- **Phase 2 unresolvable abandoned-reference alert** (`sendUnresolvedAbandonedReferenceAlert`):
  subject
  `Frick vIBAN reconciliation Phase 2: abandoned-reference candidate(s) could not be resolved`.
  Fires when an event row matched the Phase-2 marker LIKE query but the abandoned reference could
  not be extracted from `nextError` (`reason=reference_unextractable` — marker present, value after
  the marker empty). **No auto-fix.** Manually inspect the affected `nextError` text via
  privileged DB access (see Direct DB access note under **What the job looks for** above); the
  alert body only carries technical IDs (`eventId` / `intentId` / `userDataId` / `currencyId` /
  `bankId`) and the fixed reason code, never free-form error text.

When a listing-match or orphan alert fires, follow **What to do on a match (operator follow-up)**
above. For the unresolvable-reference alert, start with the DB inspection of `nextError` before
any Frick-side action.
