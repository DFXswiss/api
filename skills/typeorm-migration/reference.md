# TypeORM constraint naming + migration rules — reference

## Deterministic constraint naming (hand-written schema migrations)

A hand-written schema migration must name constraints and indexes exactly as TypeORM's
`DefaultNamingStrategy` would, otherwise the next generated diff will try to "fix" them. The name is:

```
<prefix>_ + sha1(tableName + '_' + columnNames.sort().join('_')).substring(0, N)
```

Columns are sorted before hashing. The prefix and length `N`:

| Prefix | N  | Constraint type |
| ------ | -- | --------------- |
| `PK_`  | 27 | Primary key     |
| `FK_`  | 27 | Foreign key     |
| `UQ_`  | 27 | Unique          |
| `DF_`  | 27 | Default         |
| `REL_` | 26 | Relation        |
| `IDX_` | 26 | Index           |
| `CHK_` | 26 | Check           |

(N = 27 for PK / FK / UQ / DF; N = 26 for REL / IDX / CHK.)

## File shape

- JavaScript, timestamp-prefixed: e.g. `1756463340213-AddFeatureName.js`.
- Exports a class whose `name` concatenates the PascalName and the timestamp
  (`AddFeatureName1756463340213`), with `up(queryRunner)` and `down(queryRunner)` using raw SQL.
- `npm run migration <Name>` runs `typeorm migration:generate migration/<Name> -o -d
  migration/dev-data-source.ts`; the `-o` flag is why the output is `.js`.

## Generation prerequisites

- `migration/dev-data-source.ts` (git-ignored) must exist locally, built from the `app.module.ts` DB
  config with valid connection values.
- Run `npm run build` and apply all prior migrations to the local DB **before** generating, or the
  entity-vs-DB diff is wrong.

## Immutability

- Never modify / rename / delete a migration after merge to DEV — add a follow-up migration.
- Enforced by `.github/workflows/api-migration-check.yaml` (job "Migration immutability"): it fails on
  any modified / deleted / renamed file under `migration/` except `migration/seed/**` (the seed is
  actively maintained, not immutable). Adding a new migration file is allowed.
- Data-only migrations (no schema change) may be hand-written freely; only schema migrations must
  follow the naming algorithm above.
