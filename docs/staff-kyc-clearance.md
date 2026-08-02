# Staff KYC clearance

Elevated endpoints — every `RoleGuard` whose entry roles are all gated (`KycGatedRoles`: `Admin`,
`Debug`, `Compliance`, `Support`, `RealUnit`, plus the super-roles that satisfy them, e.g.
`SuperAdmin`) — require two things from the caller: the role itself **and** that an identified
person is behind the account, expressed as a non-empty `verifiedName`.

There is **no KYC-level requirement**. `verifiedName` is only ever written by an identity-verified
path (bank-data verification) or a reviewed migration — never by customer self-service — so the
presence of the name is the authoritative identification signal on its own.

Clearance flows through two cron steps: `StaffKycClearanceService.syncStaffKycClearance`
(`@DfxCron(EVERY_MINUTE)`) derives the cleared account ids from the DB — staff users whose
`user_data.verifiedName` is non-blank — and writes them to the `staffKycClearance` setting;
`ProcessService.resyncStaffKycClearance` (`@DfxCron(EVERY_30_SECONDS)`) then primes the in-memory set
that `RoleGuard` actually reads. A database change therefore takes effect within about 90 seconds
(up to one minute for the DB scan plus up to 30 seconds for the prime) — no re-login and no deploy
needed once the name is in the database.

## Why an account is refused

A staff account with a role but no `verifiedName` is denied every elevated endpoint. The refusal is
deliberate and fail-closed; the response carries the machine-readable code `STAFF_KYC_REQUIRED`.
This is the expected state for a newly-granted staff role, and for any account whose identification
was never recorded.

## Regaining access — submit a migration PR

**An affected staff member regains access by having a `verifiedName` set on their account, and the
way to do that is a migration PR.** A one-off manual database edit is not the path: the change must
be reviewed and reproducible like any other schema/data change.

1. Open a PR against the api repo that adds a new migration under `migration/` (never modify an
   existing one — `api-migration-check.yaml` blocks that). The migration runs a guarded, idempotent
   `UPDATE user_data SET "verifiedName" = … WHERE id = … AND BTRIM(COALESCE("verifiedName", ''), <BlankChars>) = ''`.
   The closing assertion must check the **clearance predicate itself** — that
   `… WHERE id = … AND BTRIM("verifiedName", <BlankChars>) <> ''` yields exactly one row — and never
   equality with the supplied name. The goal state is a cleared account, not a particular spelling, and
   an equality assertion fails whichever precondition it is paired with: against a blankness
   precondition (the shape of the first such migration) it throws when an identity-verified path wrote a
   different but perfectly valid name in the meantime; against its own negation it does the opposite and
   silently overwrites that name.

   The precondition must then be the **exact negation** of that assertion **including the NULL case** —
   `BTRIM(COALESCE("verifiedName", ''), <BlankChars>) = ''`, not
   `BTRIM("verifiedName", <BlankChars>) = ''`. Without the `COALESCE`, NULL yields NULL rather than
   true, so the ordinary un-backfilled account is neither repaired nor accepted. Use the same
   `BlankChars` set as `StaffKycClearanceService`. A narrower `"verifiedName" IS NULL` precondition has
   the mirror-image flaw: it leaves a present-but-blank name (a lone tab, a non-breaking space) as a
   state the migration refuses to repair and then refuses to accept.

   The `UPDATE` must be coupled to a durable before/after audit row — a `log` insert (`system` `'User'`,
   `subsystem` `'StaffVerifiedNameBackfill'`, `severity` `'Info'`) in the same statement via a
   data-modifying CTE, with the update conditioned on `EXISTS (SELECT 1 FROM "audit")` so the column
   cannot change unaudited. `verifiedName` is PII; CONTRIBUTING treats unaudited mutation of it as
   blocking.

   Every one of these mistakes is boot-fatal rather than merely wrong: `migrationsTransactionMode`
   defaults to `all`, so the throw rolls back the whole release's migration batch and fails
   `DataSource.initialize()`.

2. **A real person's name is PII and must not be hard-coded in this public repo.** The migration
   reads the value from a deployment variable (e.g. `process.env.STAFF_VERIFIED_NAME_<id>`), set in the
   production config. On PRD the variable is **mandatory**: the migration throws when it is absent,
   rather than silently recording a no-op — so the value has to be live in the production environment
   before the migration is merged to `develop`. `auto-release-pr.yaml` keeps a `develop` → `main`
   release PR open continuously — every `develop` push either opens one or lands on the one already
   open — so `develop` is the last point at which the order can still be arranged. A non-personal
   service designation (for a machine account that cannot complete a personal
   identification) is not PII and may appear inline. The concrete name↔account mapping is recorded in
   the private operations repo, not here.
3. Merge the PR through the normal review, then release `develop → main`. The production deploy runs
   pending migrations automatically when `SQL_MIGRATE=true` (see `migrationsRun` in
   `src/config/config.ts`) — no shell access to the database is involved.
4. Within about 90 seconds of the deploy (the two cron steps above) the clearance set is re-derived
   and the account's elevated endpoints answer normally again.

## Revoking access

Removing a staff member's `verifiedName` (or their role) drops them out of the clearance query on
the next cron run, within about 90 seconds — again with no deploy or token rotation. Clearance is never
auto-revoked by the migration's `down()`; removal is always a deliberate action.
