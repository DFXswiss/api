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

This integration has no bank-provided ingestion cursor. If an entry becomes visible with a booking
date **older than the overlap window already covered**, the watermark will not pick it up on its own
— this requires a manual rewind. Conversely, an idle account whose first fetch is empty retains its
seeded value; this is deliberate and is why initial seeding is mandatory.

### When to intervene

- Support/Finance reports a booking that is missing from `bank_tx` and its booking date is older
  than the currently stored watermark.
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
5. Expect every entry between the rewound watermark and the original one to be re-fetched. Existing
   rows hit the `create()` dedup (`ConflictException`) and the Frick import loop silently treats that
   exception as handled; this path exposes no dedicated duplicate-conflict counter or per-conflict
   log. Do not interpret the absence of an error log as evidence that no duplicates were fetched.
   Instead, verify that no duplicate rows appear and that the watermark catches back up.
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

The upsert and watermark seed are idempotent. `sendPriority=2000` is worse than the incumbent banks'
backfilled `1000`, but the automatic payout-bank selector excludes Bank Frick regardless of priority.
Activation therefore makes the Frick processes available for outputs explicitly assigned to a Frick
account; it does not make Frick an automatic fallback. The migration deliberately enables the two
payout processes; this runbook must not describe them as default-off after that migration has run.

The later production-only `migration/1784500000000-AddBankFrickCustodyAssets.js` creates the
`Frick/EUR` and `Frick/CHF` custody assets, fills only null `Bank.assetId` links on active Frick rows,
checks that no active Frick row remains unlinked, and adds active observe-only liquidity rules. Those
rules refresh balances but have no configured fund-moving action.

### 3.2 Verification and rollback boundary

After deployment, verify both rows, their non-epoch watermark keys, the two process settings, each
row's expected custody-asset link, and a successful balance refresh before treating the rail as
operational. A Frick row with `send=true` must also have `receive=true`; otherwise its booked debit
cannot reconcile and release reserved liquidity.
`sctInst=false` prevents generic instant-bank selection, but the payout selector excludes Frick
regardless; it does not block an explicitly assigned Frick output whose `isInstant=true`, which the
Frick service maps to `SEPA_INSTANT`.

The migration's `down()` is suitable only before the new rows have been used. It re-adds both
disabled-process sentinels, restores dormant legacy names, deletes the seeded watermarks, and
deletes the two new bank rows. Existing foreign-key references make that final delete fail loudly.
If an account has routed production traffic, rollback is an Operations reconciliation procedure,
not a plain migration revert.

The custody-asset migration's `down()` removes its rules, unlinks the bank rows and deletes the two
assets. The final delete fails if liquidity-balance, ledger or other foreign-key rows already use an
asset; after use, rolling back that wiring is likewise an Operations procedure.

### 3.3 Sender assignment boundary

Do not lower `Bank.sendPriority` expecting that to cut automatic traffic over to Frick.
`FiatOutputService.selectPayoutBank` unconditionally removes Bank Frick rows (and Frick personal
IBANs) from automatic selection; priority ranks the remaining incumbent senders, and equal incumbent
priorities retain their existing order rather than failing as a tie. A Frick payout must already have
its `accountIban` / `bank` explicitly assigned at creation or by an operator. If new Frick payout
creation is later stopped, keep status polling enabled until existing orders are terminal or
reconciled.

`BankService.getBankInternal` orders duplicate `(name, currency)` rows newest-first but prefers an
asset-linked row because that link owns bank-transaction attribution. Only when no row is
asset-linked does the newest row win. This is deterministic defense in depth; the production
migration's legacy-row rename remains the primary collision removal.

Deposit-side cutover (CHF): `BankService.getBank`'s BANK-payment-method rule routes both EUR and
CHF bank transfers to their respective receiving Bank Frick row (`getBankInternal(IbanBankName.FRICK,
currency)`), and `VirtualIbanService.getOrCreateFrickForUser` issues personal IBANs in both
currencies through the same Frick-specific claim/recovery machinery. Existing Yapeal CHF personal
IBANs remain active and receiving (grandfathered); only new issuance moves to Frick. Payouts are
unaffected by this cutover: `FiatOutputService.selectPayoutBank` still excludes Bank Frick from
automatic selection for both currencies exactly as it already did for EUR, so an operator or an
explicit assignment remains required to send from a Frick account.

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

**vIBAN transport contract (bodyless GET Content-Type):** Bodyless vIBAN GET calls (list and detail)
must **omit** the `Content-Type` request header entirely. Production evidence: Bank Frick's vIBAN
gateway returns a signed HTTP 200 when no `Content-Type` is sent, but the production Azure
Application Gateway in front of it returns an **unsigned HTTP 403** when `Content-Type: */*` is
present. Mutating vIBAN requests (create POST, activation-approval PUT) remain signed
`Content-Type: application/json`. Request signing (`Signature` / `algorithm`) and fail-closed
response signature verification are unchanged for all vIBAN methods. The standard WebAPI path is
deliberately different and still sends `Content-Type: */*` on bodyless GETs.

`BankFrickService.isAvailable()` requires the base URL, API key, customer identifier, private signing
key and server verification key. Every request signs the exact serialized body. Every response
remains raw text until its detached `Signature` and `algorithm` headers have been verified
(`rsa-sha512`, `rsa-sha384` or `rsa-sha256`); only then is JSON parsed. A missing configuration
value or response header, unsupported algorithm or signature mismatch fails closed.

### 4.1 Personal-IBAN API rollback floor

Before enabling `FRICK_VBAN_API_URL`, record the API revision that includes both provider-aware
virtual-IBAN lookup and provider-aware recipient rendering. From the moment the first Bank Frick
personal IBAN has been persisted, the API must not be rolled back below that revision. Older API
revisions select an active virtual IBAN without excluding Bank Frick and render the customer as its
account holder. Clearing `FRICK_VBAN_API_URL` only stops new issuance; it does not hide rows already
stored in `virtual_iban`.

Run this read-only query before any API rollback. A `true` result means the rollback floor is active
and the target revision must carry the provider-aware lookup and recipient rendering:

```sql
SELECT EXISTS (
  SELECT 1
  FROM virtual_iban AS vi
  INNER JOIN virtual_iban_issuance_event AS vie ON vie."nextVirtualIbanId" = vi.id
  WHERE vie.provider = 'Bank Frick'
) AS "frickPersonalIbanHasExisted";
```

The query proves that at least one currently persisted `virtual_iban` row is linked to an immutable
issuance event whose provider snapshot is Bank Frick. It deliberately includes inactive and
deactivated rows and remains true if the mutable `bank` row was renamed, reclassified or replaced.
It does **not** prove that the linked vIBAN is currently active, that its current bank row is Frick,
or that a `false` result means Frick was never used. Manual deletion/archival, missing historical
issuance events or damaged audit data can all remove that evidence. In those cases use the
deployment/audit record and keep the rollback floor unless absence can be established. This is an
irreversible deployment boundary, not a check that an older revision happens to be safe for the
currently active subset.

The floor is provider-scoped, not currency-scoped: the guard query above filters on
`vie.provider = 'Bank Frick'` alone, so it already applies from the moment the first Bank Frick CHF
personal IBAN is persisted, exactly as it does for EUR — the query needs no change for the CHF
deposit cutover.

## 5. Payout and reconciliation decisions

- EUR uses `SEPA` or `SEPA_INSTANT`; instant is never sent for non-EUR.
- EUR creation requires a SEPA-country creditor IBAN. The automated-bank country allowlist
  (`Country.yapealEnable`) is applied while selecting an incumbent sender, but that selector excludes
  Frick; an explicitly assigned Frick output is not rechecked against that allowlist before creation.
  A non-SEPA creditor route fails before a Bank Frick order is created.
- CHF uses Bank Frick `FOREIGN` because that is the selected JSON contract. A missing creditor BIC
  is resolved through SepaTools and accepted only when exactly one unique candidate exists. The
  default charge is `SHA`; an explicit `BEN`/`OUR`/`SHA` value is preserved.
- Every bank reference begins with `DFX-FO-<fiatOutputId>` and is capped at 140 characters. User
  remittance text follows the stable identifier, so the statement echo remains unique.
- Approval uses a safely representable Bank Frick `orderId` where available. It falls back to the
  OpenAPI `customIds` selector when JSON cannot represent the int64 safely.
- With `FRICK_APPROVE_WITHOUT_TAN=false`, the application does not call the automatic approval
  endpoint. Any order that remains `PREPARED` is tracked by the independent status poll and requires
  operator approval in the Bank Frick portal. Enable automatic approval only after Bank Frick has
  confirmed the backend TAN exemption.
- Reconciliation accepts exactly one debit transaction with the same normalized source account and
  currency, a net-of-charge amount within `0.005`, creation no earlier than the output's
  `isReadyDate`, and either the space-normalized bank reference or exact end-to-end ID. Zero matches
  wait; multiple matches fail closed and never mark the output complete.

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
6. Exercise 401 re-authorization and invalid response signatures on read-only calls, plus ambiguous
   BIC, ambiguous bank match, empty statement and import-persistence failure; verify that the relevant
   local monetary state and cursors remain unchanged. Do not infer from an invalid response signature
   after a mutating request that Bank Frick rejected the mutation: reconcile that request by its
   stable identifier before retrying.
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
rejection, the missing-bank-reference guard, and bank-charge parsing) live in exactly this file.
The branch-coverage gate mechanically requires tests to execute every instrumented branch; it does
not by itself prove the asserted behavior is correct. The cost - a future, unrelated
Yapeal/Raiffeisen-only change could fail CI on an uncovered branch it didn't intend to touch - is
accepted deliberately in exchange for that protection. If this ever becomes a real blocker, the
long-term fix is to split the Frick-specific strict-mode parsing into its own file with its own gate,
not to lower this threshold.

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
and both hourly orphan-reconciliation phases apply only to `provider = 'Bank Frick'`. This boundary
is currency-agnostic by construction — every stage scopes by provider, not by currency — so it
already covers Bank Frick CHF personal IBANs exactly as it covers EUR ones, with no separate
currency-specific logic required. The generic Yapeal issuance path — used for currencies outside
Frick's roster, and, since the CHF deposit cutover moved new CHF issuance to Frick, now also the
path under which already-active grandfathered Yapeal CHF personal IBANs remain — retains its
pre-feature direct create/save flow: it does not acquire a Frick issuance lock, create an
intent/event, write a retired-reference marker, or enter the Frick scanner. Both phases group work
by the immutable
`[provider, referenceAccountIban, referenceAccountReceive]` snapshot and validate that the snapshot
is Frick, has a non-empty reference-account IBAN and was receive-enabled before any Frick API call.
They do not load the current `Bank` row. Renaming, reclassifying or replacing that row therefore
does not change the reference account against which an already-created intent or event is
reconciled; finalization has a separate current-row check described below.

Yapeal still has the pre-existing weakness that an external create cannot be undone and has no
reference-based reconciliation protocol. This change intentionally does not introduce a second
recovery design for that provider; restoring pre-feature customer behavior takes precedence.

### Request path is fail-closed

On the customer request path, an empty Frick recovery listing is **not** treated as proof of
non-existence (a concurrent create may still be mid-flight at Bank Frick). `VirtualIbanService`
therefore **never** resets the intent, rotates `requestReference`, or re-enters issuance after an
empty listing: it fails the call (`ServiceUnavailableException`) and leaves the intent row
exactly as the create attempt left it (`InFlight` / `Failed`). The hourly reconciliation job also
never repeats the create. The customer-facing buy flow immediately falls back to the referenced
collection account while the hourly job resolves the intent automatically.

Automatic retry still exists where the evidence is conclusive. A failed preflight occurs before
the create call and may reset the intent to `Pending`; a classified `VibanNotCreatedError` means the
create was definitely rejected or definitely not dispatched (pre-dispatch/setup failure, selected
pre-connect transport failures, or a non-408 HTTP 4xx) and may also reset the same reference to
`Pending`. Timeouts, connection resets, activation failures, recovery-listing failures, and every
listing miss are ambiguous and never arm an automatic retry.

### Hourly reconciliation job (Phase 1 → completed-intent cleanup → Phase 2)

`VirtualIbanFrickIssuanceReconciliationService.reconcileRetiredIssuanceReferences`
(`@DfxCron` process `VirtualIbanFrickIssuanceReconciliation`) automatically recovers stuck intents,
cleans up duplicates under completed Frick intents, and cleans up retired references. A listing
match is positive evidence; listing absence remains non-authoritative and therefore never enables a
second create:

- **Schedule:** every hour (`CronExpression.EVERY_HOUR`)
- **Rail guard:** silent no-op when `FrickVibanProvider.isAvailable()` is false (vIBAN rail not
  configured)
- **`timeout: 1800` (resumption, not abort):** LockClass (`src/shared/utils/lock.ts`) treats 1800s
  as a _resumption threshold_, not a hard abort of a still-running previous tick. A run older than
  1800s no longer blocks a new hour-tick, so two overlapping invocations are possible. Intent
  transitions are locked and idempotent, external cleanup always targets an exact vIBAN, and no
  path arms another create.
- **Shared listing cache:** Phase 1, completed-intent cleanup, and Phase 2 list Frick vIBANs for each
  immutable reference-account snapshot (not a single hardcoded EUR account). Successful results share
  a per-run `referenceAccountIban → listing` cache across all three stages, so different bank IDs with
  the same snapshotted IBAN reuse that result. Failed listing calls are not cached and can be
  attempted again.
- **Monitoring:** ambiguous Bank Frick outcomes and every failed automatic action are written at
  `ERROR`. The job sends no additional monitoring mail. Stages are independent try/catch blocks so
  a Phase-1 failure still allows completed-intent cleanup and Phase 2 to run (and vice versa).

Kill-switch: disable process `VirtualIbanFrickIssuanceReconciliation` via the standard disabled-
processes setting.

#### Phase 1 — automatically recover stuck InFlight/Failed intents

1. Load Bank Frick issuance intents (`provider = 'Bank Frick'`) with status `InFlight` or `Failed`,
   then **exclude** permanently merge-superseded intents (`error` contains
   `MERGE_SUPERSEDED_MARKER`) — those are permanently retired.
2. Group remaining intents by the immutable
   `[provider, referenceAccountIban, referenceAccountReceive]` snapshot and list Frick vIBANs for
   that snapshotted reference-account IBAN (`FrickVibanProvider.listByReferenceAccount`).
3. For each eligible intent, compare the listing's `description` to the intent's current
   `requestReference`:
   - **One PREPARED/ACTIVE match** → approve activation if required and finalize the existing vIBAN
     locally under the issuance lock.
   - **Several PREPARED/ACTIVE matches** → finalize (or confirm) exclusively the deterministic
     canonical winner (earliest `createdAt`, then `vban`). Phase 1 **never** deactivates duplicates.
     Duplicates are handled only by the subsequent completed-intent cleanup once the intent is
     `COMPLETED` with persisted `externalIban` as canonical.
   - **Not found and older than 30 minutes** → keep the intent non-retryable and emit `ERROR` because
     Bank Frick's result remains inconclusive.
   - **Not found and older than 24 hours** → only when this run's listing for the intent's snapshot
     group was successful, time-valid, and `fullyValidated`: transition the intent to terminal
     `Fallback`, retire its request reference for Phase 2, and continue serving the collection
     account. This is a business cutoff, not proof that Bank Frick created nothing; it never enables
     another create. Incomplete, failed, or time-invalid listings **exclude** the 24-hour fallback
     for every intent in that group for this run.
   - **Not found but still fresh** (`intent.updated` younger than the threshold) → skip until a
     later run.
   - **Listing not fully validated** (per-entry validation drops) → treat as **inconclusive** for
     that snapshot group: still surface any positive matches (they are evidence), leave every
     unmatched intent non-retryable, emit `ERROR`, and **do not arm** the 24-hour fallback for this
     run. Phase 2 continues scanning any previously retired references indefinitely.

The listing result carries `listingStartedAt` (captured immediately before page 0 is dispatched)
and `listingCompletedAt` (captured after the final page validates). In Phase 1, invalid/reversed
timestamps fail that snapshot group for the run and likewise exclude fallback for that group.
The absence log context includes the count of inconclusive intents. `listingCompletedAt` is
checked for a valid `Date` and for not preceding `listingStartedAt`; it establishes no temporal
coverage of the create window. These times are not an automatic-retry precondition: even a
correctly ordered listing miss remains non-authoritative because Bank Frick provides no
authoritative “this create did not happen” operation.

A conservative **local** upper-bound estimate for the create attempt is **120 seconds**, derived
from `BankFrickService.HTTP_TIMEOUT_MS = 30_000`:

- authorization preflight before the create call can consume 30s;
- the locally bounded create HTTP attempt then lasts at most 90s: original request (30s) +
  `/authorize` re-auth after 401 (30s) + one-shot retried request (30s). `requestSigned` has no
  further internal retry beyond that.
- **120s is not a Bank Frick SLA or processing deadline**, not an upper bound on when Bank Frick’s
  create side effect can occur, and not a retry or automatic-fallback precondition. Bank Frick may
  queue or finish work after the local HTTP attempt has ended. The estimate is for operator
  planning only (e.g. draining the local create window before changing a reference account).

The 30-minute `FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS` controls when an inconclusive miss becomes
an `ERROR`; the 24-hour `FRICK_AUTOMATIC_FALLBACK_THRESHOLD_MS` bounds recovery before terminal
fallback (only after a successful, time-valid, fully validated listing in that run).

#### Completed-intent duplicate cleanup

Runs immediately after Phase 1 in the same hourly tick. Sole permanently retryable path that
deactivates non-canonical Frick vIBANs under a completed issuance:

1. Load Bank Frick intents with status `Completed`.
2. Group by the same immutable reference-account snapshot and reuse the shared listing cache.
3. Require a successful, time-valid, fully validated listing; otherwise emit `ERROR` and skip
   deactivation for that bank snapshot this run.
4. For each intent, treat persisted `externalIban` as the sole canonical. Fail closed (no
   deactivation) when `externalIban` is missing, the listing has a cross-account mismatch, or the
   canonical IBAN is absent from a fully validated list.
5. Deactivate only other PREPARED / ACTIVE / DEACTIVATION_REQUESTED entries under the same technical
   description. Before every external deactivation, call
   `isIbanProtectedFromReconciliationDeactivation`; protected IBANs are refused with a PII-safe
   `ERROR` and left untouched.
6. Each distinct duplicate IBAN is acted on at most once per run. Failures leave the `Completed`
   intent untouched so the next hourly run retries — no free-text log is used as durable state.

This stage is the only duplicate cleanup after multi-match Phase-1 recovery: Phase 1 finalizes the
winner; completed-intent cleanup then deactivates unprotected non-canonicals against the persisted
canonical.

#### Phase 2 — automatic retired-reference cleanup

Phase 2 scans only event rows whose durable provider snapshot is `Bank Frick`, then checks their
previously **retired** references. A PREPARED, ACTIVE or DEACTIVATION_REQUESTED vIBAN found under a
retired reference is automatically deactivated and the deactivation is approved. An already
DEACTIVATED object is a completed cleanup and causes no further mutation.

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
5. **Automatic collection-account fallback** — after 24 hours without a recoverable match, Phase 1
   transitions the intent to `Fallback` and writes
   `automatic-collection-account-fallback; previousRequestReference=<old>`.

Markers (shared constants on `VirtualIbanService`):

- `CREATE_PATH_REFERENCE_MARKER` = `previousRequestReference=` — current writer format
  (deactivation-reopen + merge supersede + automatic collection-account fallback) and historical
  Phase-1 reset format
- `RECOVERY_PATH_REFERENCE_MARKER` = `recovery listing found no match under requestReference=` —
  retained so Phase 2 still parses any historical events from older builds
- `MERGE_SUPERSEDED_MARKER` = `merge-superseded` — permanent retirement marker written only by the
  merge-fail path; `finalizeFrickIssuance` and Phase 1 refuse to complete/reopen over it

The request path never retires references; only locked state transitions do.

**No rolling lookback window:** every matching issuance-event transition is loaded and kept under
scan indefinitely. A still-unresolved abandoned reference must keep being checked and cleaned up;
silent-forgetting after a day count is intentionally not used. These events are expected
to be rare recovery / deactivation / merge artifacts.

Per immutable snapshot group (using Phase 1's reference-account-IBAN cache): if the listing is fully
validated, any abandoned reference whose `description` appears is a match; if the listing is not
fully validated, positive matches are still cleaned up but unmatched abandoned references are not
treated as clean. Failed cleanup is logged at `ERROR` and retried by the next hourly run.

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
parsed and is logged at `ERROR`; it is not treated as a Frick listing match.

### What it reconciles against

Phase 1, completed-intent cleanup, and Phase 2 list Bank Frick virtual IBANs **per immutable
reference-account snapshot and across every lifecycle state**, not against one hardcoded EUR
reference account. Every intent captures `referenceAccountIban` and `referenceAccountReceive` when
it is created; every issuance event copies the same values. Preflight, create, request recovery,
finalization checks, Phase 1, completed-intent cleanup, and Phase 2 all use that snapshot.
Reconciliation never switches an in-flight or historical issuance to a newly edited `Bank.iban`.
Comparison is exact equality of listed `description` to the intent's current `requestReference`
(Phase 1 / completed-intent cleanup) or the extracted abandoned reference (Phase 2). A missing IBAN,
a receive-disabled snapshot or a non-Frick provider snapshot throws inside that snapshot group's
processing and is caught by the group-level `try/catch`. That group is logged at `ERROR` and skipped;
every other snapshot group in the same run continues normally.

Before changing a Frick reference-account IBAN or disabling its receive state, Operations must:

1. stop new Frick personal-IBAN issuance;
2. wait for the 120-second local create window to drain;
3. reconcile every `Pending`, `InFlight`, and `Failed` intent against its stored
   `referenceAccountIban`, including Phase-2 retired references;
4. confirm incoming-payment monitoring remains active for every snapshotted reference account;
5. only then change the Bank row and re-enable issuance.

Finalization reloads the Bank row and refuses to expose a newly finalized vIBAN if provider, IBAN,
or receive-enabled state differs from the intent snapshot. The old snapshot remains the
reconciliation authority even after such a refusal.

### Match handling

Phase 1 automatically binds the selected live match (deterministic canonical winner only; never
deactivates duplicates). Completed-intent cleanup deactivates unprotected non-canonical duplicates
under `Completed` intents (canonical = persisted `externalIban`). Phase 2 automatically deactivates
retired-reference matches. Operations only investigates when one of these automatic actions itself
logs an `ERROR`.

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
used as the completion record. A failed effect instead receives
`postCommitEffectFailed=<effect name>`; it never receives a completion marker. Effect-marker rows
contain only the master/slave account IDs and the marker, not customer email addresses or names.

Operator procedure:

1. Find the master/slave start rows and read `postCommitEffectsPending=`.
2. For the same merge, collect the durable `postCommitEffectCompleted=` rows from both accounts.
   A completion counts only when the matching marker exists on both accounts; the pair is written
   atomically, so a one-sided marker is an integrity incident.
3. Collect `postCommitEffectFailed=` rows. They are explicit failed attempts, remain unresolved,
   and do not count as completion.
4. For each effect still pending, verify the target system first: inspect the destination document
   store, webhook receiver, notification/mail provider, or KYC provider as applicable.
5. Replay only when target-system evidence is sufficient to conclude the effect did not complete.
   If the target cannot establish that, keep the effect classified as ambiguous and require an
   idempotent replay mechanism or specific operational approval. A process can die after the
   external system accepted an effect but before the durable completion transaction, so a
   missing durable marker is evidence of an unresolved effect, not proof that replay is safe.

Effect failures and durable-marker failures are logged at critical severity with `masterId`,
`slaveId`, and the exact effect name; remaining effects are still attempted. The committed merge
returns success because replaying the merge itself is impossible once the slave is `Merged`.

### Automatic retry boundary

The product-approved automatic retry remains, but only for conclusive evidence: preflight failure
before any create call, or a classified definite create rejection or definitely non-dispatched
create outcome. An ambiguous create or activation outcome stays non-retryable. Phase 1 listing
matches recover the existing external object (canonical winner only); they never issue a second
create and never deactivate duplicates. Duplicate cleanup runs only via completed-intent cleanup
against persisted `externalIban`. Phase 1 listing misses keep the existing `requestReference` during
recovery and transition to terminal `Fallback` after 24 hours only after a successful, time-valid,
fully validated listing in that run. Phase 2 then scans that retired reference indefinitely and
automatically deactivates any delayed object. This prevents a non-authoritative listing miss from
causing a second irreversible Bank Frick account without requiring routine manual reconciliation.
