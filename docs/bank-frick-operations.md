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

## 2. Raiffeisen/Yapeal reference-less entries after deploy

Before this change, Raiffeisen/Yapeal statement entries without a bank-provided reference could
be assigned a randomly generated `accountServiceRef` on each import, so the same underlying
entry could get a different synthetic reference every time it was seen. That randomness is now
removed (`Iso20022Service`), but any **already-imported** rows created under the old logic still
carry the old, non-reproducible references.

Because the new logic derives `accountServiceRef` deterministically for the same entry, the
first overlapping poll after this deploy will, for reference-less Raiffeisen/Yapeal entries that
fall inside the poll's overlap window, compute a reference that differs from what was already
stored in `bank_tx`. The `create()` dedup keys off `accountServiceRef`, so it will not recognize
these as duplicates of the old rows — expect a one-time batch of duplicate `bank_tx` entries for
those accounts until the overlap window has fully rolled past the old imports.

### Monitoring

- After deploy, watch `bank_tx` insert volume on Raiffeisen and Yapeal accounts for the first
  several poll cycles. A one-off bump limited to reference-less entries within the overlap
  window is expected; anything larger or sustained is not and should be investigated.
- Cross-check new rows against the pre-existing ones by amount, value date and counterparty to
  confirm they are the expected duplicates and not a genuine new-data issue.

### Cleanup

- Historical reference-less rows imported under the old random-reference logic are not
  retroactively corrected by this deploy. Once the one-time duplicate batch above has been
  confirmed, plan a manual cleanup pass (dedup/merge or archive the superseded rows) for the
  affected Raiffeisen/Yapeal accounts; do not run it automatically as part of the deploy.

## 3. Registry and default-off activation

The migration installs two disabled synthetic placeholders (`LI4200000FRICKCHF0001` and
`LI5600000FRICKEUR0001`) only so deployed databases have deterministic CHF/EUR rows to update.
They have `receive=false`, `send=false` and `sctInst=false`; they are not production accounts.
The local seed uses the same clearly synthetic, checksum-valid IBANs with the same disabled flags.

Before activation, Operations must:

1. Replace each synthetic IBAN with the team-provided CT account IBAN and confirm `BFRILI22`.
   Operating accounts are deliberately not registered under the same `(name, currency)` because
   existing selectors assume one Bank Frick row per currency.
2. Set `receive`, `send` and `sctInst` from the confirmed account-role matrix. Never infer these
   flags from currency.
   Before setting `send=true`, link the row to the correctly configured custody/liquidity asset and
   verify that its balance is refreshed; payout readiness deliberately requires that balance.
   Instant outputs additionally require `sctInst=true`; a row without that confirmed capability is
   excluded from instant routing.
3. Seed `lastBankFrickDate:<bankId>` before setting `receive=true`.
4. Leave `FiatOutputFrickTransmission` and `FiatOutputFrickStatusCheck` in the `disabledProcess`
   setting until the sandbox checklist below is complete. The migration adds both without
   removing or duplicating existing process switches.
5. Enable the status process before (or in the same controlled change as) transmission. If new
   payout creation is later stopped, keep status polling enabled until all existing Frick orders
   are terminal or reconciled.
6. Ensure exactly one sender bank is eligible for each currency/country route before enabling a
   Frick `send` flag. A Frick route alongside another eligible sender is deliberately treated as
   ambiguous and leaves the output unassigned until Operations makes the ownership decision
   explicit; existing non-Frick routing order remains unchanged.

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
