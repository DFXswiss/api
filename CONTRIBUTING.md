# DFX API — Contributing Guidelines

## Build & Test Commands

```bash
npm install
npm run format        # prettier --write
npm run lint          # eslint
npm run type-check    # tsc --noEmit
npm test              # jest
npm run migration <Name>   # generate migration from entity diff
```

Run `format`, `lint` and `type-check` before pushing.

## Database Migrations — CRITICAL

### Always generate, never hand-write schema migrations

Schema changes (new columns, tables, FK/PK/UNIQUE/DEFAULT constraints) **must** be produced by:

```bash
npm run migration <PascalName>
```

TypeORM writes deterministic hash-based constraint names
(e.g. `DF_f6ade72c09ca260e3ce42ba0781`). Hand-written migrations with
human-readable names (`DF_mros_reportCode`) drift from what TypeORM
expects and force a follow-up fix migration — see PR #3613.

**Workflow when adding a DB-backed feature:**

1. Change the entity file(s).
2. Run the app locally with a synced DB.
3. `npm run migration <PascalName>` — inspect the generated SQL.
4. Commit the generated migration file alongside the entity change.

### Exception: data-only migrations

Migrations that **only** run `UPDATE` / `INSERT` / `DELETE` (no schema
changes) may be hand-written — no constraints involved. See
`ActivateScryptBtcWithdraw` for the style.

### Migrations are immutable once on develop / main

Enforced by `.github/workflows/api-migration-check.yaml` (PR #3614).
If a migration turns out wrong after merge, add a **follow-up** migration
that rewrites/renames. Do not edit or rename the original file.

## Entity Patterns

### JSON-serialised columns

For arrays or structured data stored as JSON in a single column, use
the canonical pattern (see `buy-crypto.entity.ts` → `priceStepsObject` /
`creditorData`):

```ts
@Column({ length: 'MAX', nullable: true })
indicators?: string; // JSON string

get indicatorCodes(): string[] {
  return this.indicators ? JSON.parse(this.indicators) : [];
}

set indicatorCodes(codes: string[]) {
  this.indicators = JSON.stringify(codes);
}
```

Never expose the raw JSON string to business logic — always go through
the typed getter/setter.

### Nullable vs default

- New columns that existing rows can't populate → `nullable: true`.
- New columns with a domain default → `default: 'value'` (TypeORM adds
  a `DEFAULT` constraint and back-fills existing rows on MSSQL).

## DTO Patterns

- **Create DTOs** (`@IsOptional()`): accept `undefined` or `null`.
- **Update DTOs** (`@IsOptionalButNotNull()` from `shared/validators`):
  accept `undefined`, reject explicit `null`.
- For string arrays: `@IsArray()` + `@IsString({ each: true })`.
- For enum: `@IsEnum(YourEnum)`.

Keep DTO field order aligned with the entity field order for easy
scanning.

## Service Patterns

- `create`: destructure relation ids and JSON-backed fields out of the
  DTO, create the entity from the rest, then attach relations and call
  the typed setter for JSON fields. See `MrosService.create`.
- `update`: load the entity, `Object.assign(entity, rest)` for plain
  fields, use the typed setter for JSON fields when the DTO value is
  not `undefined`. See `MrosService.update`.

## Module Structure

```
src/subdomains/
  generic/        # shared domain models (user, kyc, support, ...)
  supporting/     # infrastructure-level domains (bank-tx, mros, recall, ...)
  core/           # business flows (buy-crypto, sell-crypto, ...)
```

Within a subdomain:

```
<domain>/
  dto/
  <domain>.entity.ts
  <domain>.repository.ts
  <domain>.service.ts
  <domain>.controller.ts
  <domain>.module.ts
```

## Git & PRs

- Branch from `develop`, never commit directly.
- Feature branches: `feat/<scope>-<topic>`, fixes: `fix/<scope>-<topic>`.
- Commit messages: imperative mood, no trailing period on the subject.
- Squash-and-merge when merging to `develop` — preserve atomic commits
  on the branch; the squash keeps only the PR title on `develop`.
- Release PRs (`develop` → `main`) are created automatically — never
  open them manually.

## Testing

- Jest with `--silent` by default (`npm test`).
- Tests live next to the subdomain they cover.
