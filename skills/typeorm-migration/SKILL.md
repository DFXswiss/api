---
name: typeorm-migration
description: Author a database migration in this TypeORM repo — generate it from the entity diff, hand-write schema migrations with the deterministic constraint naming, and follow the post-merge immutability rule. Use when an entity or column changes, or when writing a data (UPDATE/INSERT/DELETE) migration.
---

# TypeORM migration

Migrations are JavaScript files with timestamp-prefixed names under `migration/`, applied via TypeORM.
Every PR that changes an entity or column must include its migration.

## Prerequisite (one-time, local)

Generation runs against a data source that is git-ignored and developer-supplied: create
`migration/dev-data-source.ts` from the `app.module.ts` DB config with valid local connection values.
Without it, `npm run migration` fails.

## Generate from an entity diff

1. Change the entity classes.
2. `npm run build` **and** ensure the local DB has all prior migrations applied — generation diffs the
   entities against the live DB, so a stale build or DB produces a wrong diff.
3. `npm run migration <PascalName>` — this runs
   `typeorm migration:generate migration/<PascalName> -o -d migration/dev-data-source.ts`. The `-o`
   flag emits **JavaScript**, so migration files are `.js`, not `.ts`.
4. Verify the generated SQL by hand before committing.

The file is named `<timestamp>-<PascalName>.js`; the exported class `name` is `<PascalName><timestamp>`.
Implement both `up(queryRunner)` and `down(queryRunner)` with raw SQL via `queryRunner.query(\`...\`)`.

## Hand-written migrations

- **Data-only** (UPDATE / INSERT / DELETE, no schema change): write freely.
- **Schema** (tables / columns / constraints / indexes): constraint and index names **must** match
  TypeORM's deterministic naming, or the schema diverges from what the entities expect and the next
  generated diff will fight it. See `reference.md` in this skill folder for the exact hashing
  algorithm and the per-prefix length table.

## Immutability (enforced by CI)

Never modify, rename, or delete a migration after it is merged to DEV — add a follow-up migration
instead. CI (`.github/workflows/api-migration-check.yaml`) fails any modify/delete/rename under
`migration/` (except `migration/seed/`, which is mutable). Adding a new migration file is allowed.
