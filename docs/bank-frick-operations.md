# Bank Frick — Operations Runbook

Operational notes for the Bank Frick statement import (`BankTxService.checkFrickTransactions`,
`src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service.ts`). Covers the watermark
backfill procedure and a one-time monitoring note for the reference-less-entry deploy.

## 1. Bank Frick watermark backfill

### Background

The poller tracks progress per receiving Bank Frick account via the setting key
`lastBankFrickDate:<bankId>` (`bankId` = the `Bank` row id, not the IBAN). After every fully
processed fetch — including an empty statement — the watermark advances to
`min(now, latest booking date of the processed entries) − FRICK_WATERMARK_OVERLAP_DAYS`, and
never moves backwards. The overlap (currently 2 days) exists so that ordinary bank-side
reporting lag or a race between multiple running instances does not skip entries. Duplicate
re-fetches inside the overlap window are expected and are absorbed by the existing `create()`
dedup, which rejects re-inserts of the same `accountServiceRef` with a `ConflictException`.

Bank Frick does not expose an ingestion cursor. If an entry becomes visible with a booking
date **older than the overlap window already covered**, the watermark will not pick it up on
its own — this requires a manual rewind.

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
exist yet and defaults to the epoch (`1970-01-01`) on first poll — the service will attempt to
pull the account's entire history. For an account with material transaction volume, seed the
setting key explicitly **before** flipping `Bank.receive` to `true`, to the earliest date you
actually want imported (or `now`, if only new activity should be picked up going forward), so
the first poll does not trigger an unbounded historical pull.

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
