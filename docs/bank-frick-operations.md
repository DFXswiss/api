# Bank Frick — Operations Runbook

Operational notes for the Bank Frick statement import (`BankTxFrickService`), payout rail
(`FiatOutputFrickService`), registry placeholders and cryptographic activation. The production
migration enables the rail; if the activation evidence below is incomplete, Operations must
disable it immediately rather than treating the checklist as an automatic deployment gate.

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

## 3. Registry and production activation

Production activation is code-owned by
`migration/1784400000000-ActivateBankFrick.js`. That migration is guarded by
`ENVIRONMENT === 'prd'` and is a complete no-op in local, development and CI environments. Local
databases continue to use the synthetic rows in `migration/seed/bank.csv`.

### 3.1 What the production migration does

The migration:

1. advances the named `bank_id_seq` beyond the current maximum `Bank.id`;
2. upserts the EUR account `LI75088110105923K000E` and CHF account
   `LI32088110105923K000C`, both with BIC `BFRILI22`;
3. sets both rows to `receive=true`, `send=true`, `sctInst=false`, `amlEnabled=true`, and
   `sendPriority=2000`;
4. renames dormant legacy rows to `Bank Frick (legacy)`;
5. seeds `lastBankFrickDate:<bankId>` to the current UTC time when the key is absent; and
6. removes `FiatOutputFrickTransmission` and `FiatOutputFrickStatusCheck` from
   `disabledProcess`.

The upsert and watermark seed are idempotent. `sendPriority=2000` leaves the incumbent banks
(backfilled to `1000`) ahead of Frick, so activation makes Frick an eligible fallback rather than
the primary sender. The migration deliberately enables the two payout processes; this runbook must
not describe them as default-off after that migration has run.

### 3.2 Verification and rollback boundary

After deployment, verify both rows, their non-epoch watermark keys, and the two process settings
before treating the rail as operational. A Frick row with `send=true` must also have
`receive=true`; otherwise its booked debit cannot reconcile and release reserved liquidity.
Instant routing remains unavailable while `sctInst=false`.

The migration's `down()` is suitable only before the new rows have been used. It re-adds both
disabled-process sentinels, restores dormant legacy names, deletes the seeded watermarks, and
deletes the two new bank rows. Existing foreign-key references make that final delete fail loudly.
If an account has routed production traffic, rollback is an Operations reconciliation procedure,
not a plain migration revert.

### 3.3 Sender cutover

Lower `Bank.sendPriority` below the incumbent's `1000` only as a deliberate cutover. Two eligible
sender banks with the same best priority are treated as a misconfiguration and the output remains
unassigned until the tie is resolved. If new Frick payout creation is later stopped, keep status
polling enabled until existing orders are terminal or reconciled.

`BankService.getBankInternal` orders duplicate `(name, currency)` rows newest-first but prefers an
asset-linked row because that link owns bank-transaction attribution. Only when no row is
asset-linked does the newest row win. This is deterministic defense in depth; the production
migration's legacy-row rename remains the primary collision removal.

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

The production migration removes the two process switches; it does not verify external Bank Frick
behaviour. Retain evidence for every item below. If any prerequisite is unverified or fails,
restore the process switches immediately and keep the rail disabled until it is resolved:

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
7. For a future reactivation, enable `FiatOutputFrickStatusCheck`, observe clean polling, then
   enable `FiatOutputFrickTransmission` in a separate controlled step. The initial production
   migration enables both together, so verify both processes immediately after deployment.
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

### Provider boundary: this protocol is Frick-only

The durable issuance intent, issuance-event retirement markers, merge-time intent reconciliation,
and both hourly orphan-reconciliation phases apply only to `provider = 'Bank Frick'`. Implicit CHF
issuance through Yapeal retains its pre-feature direct create/save flow: it does not acquire a
Frick issuance lock, create an intent/event, write a retired-reference marker, or enter the Frick
scanner. Phase 2 filters the provider snapshot stored on each issuance event before any `Bank`
lookup or Frick API call, and `getListingForBank` independently refuses a bank row whose current
name is not `Bank Frick`.

Yapeal still has the pre-existing weakness that an external create cannot be undone and has no
reference-based reconciliation protocol. This change intentionally does not introduce a second
recovery design for that provider; restoring pre-feature customer behavior takes precedence.

### Request path is fail-closed (no self-heal)

On the customer request path, an empty Frick recovery listing is **not** treated as proof of
non-existence (a concurrent create may still be mid-flight at Bank Frick). `VirtualIbanService`
therefore **never** resets the intent, rotates `requestReference`, or re-enters issuance after an
empty listing: it fails the call (`ServiceUnavailableException`) and leaves the intent row
exactly as the create attempt left it (`InFlight` / `Failed`). The hourly reconciliation job also
leaves it non-retryable; a human must reconcile ambiguous outcomes.

Automatic retry still exists where the evidence is conclusive. A failed preflight occurs before
the create call and may reset the intent to `Pending`; a classified `VibanNotCreatedError` is the
bank's definite rejection and may also reset the same reference to `Pending`. Transport failures,
activation failures, recovery-listing failures, and every listing miss are ambiguous and never
arm an automatic retry.

### Two-phase hourly job

`VirtualIbanFrickIssuanceReconciliationService.reconcileRetiredIssuanceReferences`
(`@DfxCron` process `VirtualIbanFrickIssuanceReconciliation`) is an alert-only check for stuck
intents and retired references. A complete, fully validated, reference-account-scoped listing
across **all lifecycle states** is useful positive evidence when it contains the exact
`description`, but absence is **not authoritative proof of non-creation** and causes no mutation:

- **Schedule:** every hour (`CronExpression.EVERY_HOUR`)
- **Rail guard:** silent no-op when `FrickVibanProvider.isAvailable()` is false (vIBAN rail not
  configured)
- **`timeout: 1800` (resumption, not abort):** LockClass (`src/shared/utils/lock.ts`) treats 1800s
  as a _resumption threshold_, not a hard abort of a still-running previous tick. A run older than
  1800s no longer blocks a new hour-tick, so two overlapping invocations are possible. Both phases
  are read-only with respect to issuance intents; overlap can duplicate an alert but cannot arm a
  retry.
- **Shared listing cache:** both phases list Frick vIBANs **per intent/event `bankId`** (not a
  single hardcoded EUR account) and share a per-run `bankId → listing` cache so the same bank is
  never listed twice in one run.
- **On unhandled phase failure:** fail-closed `ERROR_MONITORING` alert that the check itself
  could not run — absence of a match alert is **not** evidence of a clean state. Phases are
  independent try/catch blocks so a Phase-1 failure still allows Phase 2 to run (and vice versa).

Kill-switch: disable process `VirtualIbanFrickIssuanceReconciliation` via the standard disabled-
processes setting.

#### Phase 1 — inspect stuck InFlight/Failed intents (alert-only)

1. Load Bank Frick issuance intents (`provider = 'Bank Frick'`) with status `InFlight` or `Failed`,
   then **exclude** permanently merge-superseded intents (`error` contains
   `MERGE_SUPERSEDED_MARKER`) — those are permanently retired.
2. Group remaining intents by `bankId` and list Frick vIBANs for that bank's reference IBAN
   (`FrickVibanProvider.listByReferenceAccount`).
3. For each eligible intent, compare the listing's `description` set to the intent's current
   `requestReference`:
   - **Listing match** (object already exists under the current reference) → collect for an
     `ERROR_MONITORING` alert; **change nothing** on the intent. Manual operator follow-through
     required (no auto-cleanup at Bank Frick).
   - **Not found, fully validated, and older than the safety threshold** → keep the intent
     `InFlight`/`Failed`, keep the same reference, and send
     `Frick vIBAN reconciliation Phase 1: listing does not prove create absence`. Manual
     reconciliation is required; no automatic retry is enabled, even when the listing started
     after the locally bounded HTTP window.
   - **Not found but still fresh** (`intent.updated` younger than the threshold) → skip until a
     later run.
   - **Listing not fully validated** (per-entry validation drops) → treat as **inconclusive** for
     that bank: still surface any positive matches (they are evidence), leave every unmatched
     intent non-retryable, and send a separate incomplete-listing alert. Absence of a match alert
     is not a clean state.

The listing result carries `listingStartedAt` (captured immediately before page 0 is dispatched)
and `listingCompletedAt` (captured after the final page validates). Invalid/reversed timestamps fail
the bank for that run. For each intent, the code computes
`latestPossibleCreateProcessedAt = intent.updated + FRICK_CREATE_MAX_PROCESSING_MS`. Both timestamps
are included in the alert as operator context. They are not an automatic-retry precondition:
even a correctly ordered listing miss remains non-authoritative because Bank Frick provides no
authoritative “this create did not happen” operation.

`FRICK_CREATE_MAX_PROCESSING_MS = 90_000` is derived from
`BankFrickService.HTTP_TIMEOUT_MS = 30_000`:

- the locally bounded create HTTP attempt lasts at most 90s: original request (30s) +
  `/authorize` re-auth after 401 (30s) + one-shot retried request (30s). `requestSigned` has no
  further internal retry beyond that.
- **90s is not an upper bound on Bank Frick processing or on when its create side effect can
  occur.** Bank Frick may queue or finish work after the local HTTP attempt has ended.

The separate 30-minute `FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS` remains as a conservative delay
before escalating a listing miss to Operations. It does not change the intent.

#### Phase 2 — retired-reference orphan scan (alert-only)

Phase 2 scans only event rows whose durable provider snapshot is `Bank Frick`, then checks their
previously **retired** references and alerts when Bank Frick still shows an object under one. It is
**alert-only**: it never mutates intents or Bank Frick state.

**Where retired references come from** (writers of the durable markers in `nextError`):

1. **Historical Phase 1 resets from older builds** — parser-only legacy format:
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

- `CREATE_PATH_REFERENCE_MARKER` = `previousRequestReference=` — current writer format
  (deactivation-reopen + merge supersede) and historical Phase-1 reset format
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

It queries `virtual_iban_issuance_event` for Bank Frick transitions whose `nextError` text contains
either marker — **no `nextStatus` gate and no time bound**. Provider plus marker identifies a Frick
reference-retirement event: historical Phase-1 and current deactivation-reopen writers use
`nextStatus = Pending`;
merge-supersede uses `nextStatus = Failed` with the same `previousRequestReference=` marker so
permanently retired references stay under scan.

```sql
SELECT id, created, intentId, userDataId, currencyId, bankId, provider,
       previousStatus, nextStatus, nextError
FROM virtual_iban_issuance_event
WHERE provider = 'Bank Frick'
  AND (
    nextError LIKE '%previousRequestReference=%'
    OR nextError LIKE '%recovery listing found no match under requestReference=%'
  )
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
one hardcoded EUR reference account. For each distinct `bankId` on the intents (Phase 1) or
abandoned-reference events (Phase 2), the job resolves `Bank.iban` through the uncached
`BankService.getBankByIdUncached` database read, verifies `Bank.name === 'Bank Frick'`, and calls
`FrickVibanProvider.listByReferenceAccount` (no lifecycle-state filter). A reference-account IBAN
correction is therefore visible on the next run rather than after the repository cache expires.
Comparison is exact equality of listed `description` to the intent's current `requestReference`
(Phase 1) or the extracted abandoned reference (Phase 2). A missing IBAN or non-Frick bank throws
inside that bank's processing and is caught by the per-bank `try/catch` in both phases: only that
one bank is skipped (`sendPerBankFailureAlert`); every other bank in the same run continues
normally. Absence of a match alert for the skipped bank is **not** evidence of a clean state.

### What to do on a match (operator follow-up)

Applies to **Phase 1 listing matches** (stuck intent already present at Frick under the current
reference) and **Phase 2 orphan matches** (Frick still holds a vIBAN under a retired reference).
In both cases the job does **not** deactivate, delete, or auto-bind anything at Bank Frick —
and Phase 1 never reopens the local intent.

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

### Residual risk: committed account merge can lose a post-commit effect

The atomic merge transaction contains the account reassignment, slave `Merged` state, KYC-step
reassignment/cancellation, virtual-IBAN ownership/deduplication, issuance-intent reconciliation,
volumes, and merge logs. It does **not** contain the KYC approval continuation. That continuation
can reach Sumsub, merge-request mail, and KYC notifications, so it runs only after commit together
with document copying, account/KYC webhooks, and user notifications. A failure in any of those
effects cannot roll the database merge back.

The merge transaction writes two durable `KycLog` start rows whose `result` contains
`postCommitEffectsPending=<comma-separated effect names>`. After each effect succeeds, the service
writes a second pair of durable rows in one database transaction with
`postCommitEffectCompleted=<effect name>`. Application logs are observability only; they are not
used as the completion record.

Operator procedure:

1. Find the master/slave start rows and read `postCommitEffectsPending=`.
2. For the same merge, collect the durable `postCommitEffectCompleted=` rows from both accounts.
   A completion counts only when the matching marker exists on both accounts; the pair is written
   atomically, so a one-sided marker is an integrity incident.
3. For each effect still pending, verify the target system first: inspect the destination document
   store, webhook receiver, notification/mail provider, or KYC provider as applicable.
4. Replay only after that target-system check proves the effect did not complete. A process can die
   after the external system accepted an effect but before the durable completion transaction, so
   a missing durable marker is evidence of an unresolved effect, not proof that replay is safe.

Effect failures and durable-marker failures are logged at critical severity with `masterId`,
`slaveId`, and the exact effect name; remaining effects are still attempted. The committed merge
returns success because replaying the merge itself is impossible once the slave is `Merged`.

### Automatic retry boundary

The product-approved automatic retry remains, but only for conclusive evidence: preflight failure
before any create call, or Bank Frick's classified definite create rejection. An ambiguous create
or activation outcome stays non-retryable. Phase 1 listing matches are alert-only.
Phase 1 listing misses are alert-only; keep the existing `requestReference`. Require the manual
reconciliation procedure above. This prevents a non-authoritative listing miss from causing a second
irreversible Bank Frick account.
