# `/gs/debug` — reference

Read this before composing a non-trivial query. The endpoint accepts a **structured JSON query
description** (`DebugQueryDto`) — never raw SQL. Derive table and column names from the allowlist and
the TypeORM entities in this repository.

## Endpoint & safety
- The CLI posts a `DebugQueryDto` (structured JSON) to `POST /gs/debug` with a Bearer token obtained
  from `POST /auth` (DEBUG address + signature from the local `.env`, role `DEBUG`).
- No raw SQL crosses the wire. The service (`src/subdomains/generic/gs`) compiles the DTO to SQL via
  TypeORM QueryBuilder: every identifier (table, column, alias, aggregate, op, order-by direction,
  jsonb path segment) is validated against an allowlist, and all leaf values are bound as parameters
  (`$1..$N`) — never interpolated. Writes / DDL are not expressible; read-only is structural.
- Reachable tables and columns are enumerated in `DebugAllowedColumns`
  (`src/subdomains/generic/gs/dto/gs.dto.ts`) — the **source of truth**. It drifts per migration:
  every migration that adds, renames, or removes a column on a debuggable table updates it. A table
  or column absent from that map is unreachable (PII / secrets / free-form text are deliberately
  excluded). The full DTO schema is `src/subdomains/generic/gs/dto/debug-query.dto.ts`.
- The default target is production (`DEBUG_API_URL` in the local `.env`).
- `limit` is required (1..10000); the service additionally clamps to its own max. Page larger scans
  with explicit `limit` + `offset`.

## DTO shape (`DebugQueryDto`)
- `table` (required): snake_case; must be a key in `DebugAllowedColumns`.
- `select` (required, 1..100 items): each item has a `kind`:
  - `{"kind":"column","column":"name"}` — a plain column.
  - `{"kind":"jsonb","column":"message","jsonbPath":"a.b.c","as":"alias"}` — extract a JSON path as
    text; allowed only on columns listed in `jsonbColumns` (currently only `log.message`). Path
    segments are dot-separated and each is regex-validated.
  - `{"kind":"aggregate","aggregate":"count|sum|min|max|avg","column":"id","as":"n"}`.
  - optional `as` on any item sets the output alias (also referenceable in `orderBy` / `groupBy`).
- `where` (optional): a tree of nodes, each with a `kind`:
  - `{"kind":"leaf","column":"x","op":"=","value":...}` — ops: `= != < <= > >= IN "NOT IN" LIKE
    ILIKE "IS NULL" "IS NOT NULL"`. `IN` / `NOT IN` take an array value; `IS NULL` / `IS NOT NULL`
    take no value; the rest take a scalar.
  - `{"kind":"and","children":[...]}` / `{"kind":"or","children":[...]}` — up to 5 children each.
  - `{"kind":"not","child":{...}}`.
  - Caps: tree depth ≤ 5, ≤ 200 nodes, ≤ 50 leaf predicates, ≤ 100 values per IN list.
- `groupBy` (optional): array of columns or select-aliases (order preserved).
- `orderBy` (optional): array of `{"column":"x","direction":"ASC|DESC"}` (column or select-alias).
- `limit` (required); `offset` (optional, ≥ 0).
- Column names are camelCase and case-sensitive; table names are snake_case.
- Response shape: `{"keys":[...],"rows":[[...], ...]}` — `keys` mirror the `as`-or-column order of
  `select`, and each row is parallel to `keys`.

## FinancialDataLog / balancesTotal (used by `--balance` / `--anomalies` / `--stats`)
- Stored in table `log`, `subsystem = 'FinancialDataLog'`, payload in `message`. Extract fields with
  the `jsonb` select kind, e.g. `{"kind":"jsonb","column":"message","jsonbPath":"balancesTotal.totalBalanceChf","as":"totalchf"}`.
- `balancesTotal`: `totalBalanceChf = plusBalanceChf - minusBalanceChf`; plus = assets held,
  minus = liabilities owed to customers, each valued at its current `priceChf`.
- Customer flow is balance-neutral (a deposit raises plus and minus equally; completing the order
  lowers both). So `totalBalanceChf` approximates operating equity and moves only via:
  (1) fees / operating profit, (2) FX drift on open orders, (3) an error or realized loss.
  A sudden negative step is suspicious rather than customer activity.
- `valid = false` when the current total is neither within one
  `Config.financeLogTotalBalanceChangeLimit` band of the last VALID entry nor part of a stable
  plateau (current total + its `Config.financeLogStabilityWindow - 1` immediate predecessors all
  within one such band). There is no time-based escape — a persisting invalid level stays
  `valid = false` until it stabilises into a plateau (auto-adopted, tagged
  `validatedByStability`) or an operator runs the audited `PUT /log/financial/validity` sweep.
  `--anomalies` lists these rows.
- Reference: `BalancesTotal` in `src/subdomains/supporting/log/dto/log.dto.ts` and `LogJobService`.
- The companion scripts (`compare-balance-logs.sh`, `inspect-asset-balance.sh`, `sum-asset-balances.sh`)
  read these same `message` snapshots by `log.id`: diff two entries, inspect one asset's plus/minus
  structure, or sum plus/minus/net CHF across assets of one `financialType`. See SKILL.md →
  "Balance forensics".

## liquidity_balance (snapshot, one row per asset, updated in place)
Entity: `src/subdomains/core/liquidity-management/entities/liquidity-balance.entity.ts`

| Column | Type | Meaning |
| --- | --- | --- |
| `id`, `created`, `updated` | — | from `IEntity`; `updated` is the last refresh |
| `assetId` | FK → `asset` | ManyToOne |
| `amount` | float, nullable | total balance |
| `availableAmount` | float, nullable | available balance |
| `isDfxOwned` | bool, default `true` | owned liquidity vs. customer holdings |

- Populated by the balance adapters (blockchain / bank / custom) in `liquidity-management`.
- Rows with `isDfxOwned = false` are custom-adapter balances, named `<userDataId>-<token>`.
- The endpoint has no JOINs; resolve asset names with a separate `asset` query.

## Other useful tables
- `recommendation`: `recommenderId`, `recommendedId`, `method`, `created` (referrals).
- `user_data`: `id`, `status`, `kycStatus`, … (used by referral-tree status lookups).
- `asset`: `id`, `name`, `blockchain`, `type`, … — resolve one with a `where` and-tree on
  `blockchain` + `name`, e.g. `{"kind":"and","children":[{"kind":"leaf","column":"blockchain","op":"=","value":"<chain>"},{"kind":"leaf","column":"name","op":"=","value":"<name>"}]}`.
