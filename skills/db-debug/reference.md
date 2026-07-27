# `/gs/debug` — reference

Read this before composing a non-trivial query. The endpoint accepts a **structured JSON query
description** (`DebugQueryDto`) — never raw SQL. Derive table and column names from the allowlist and
the TypeORM entities in this repository.

## Endpoint & safety
- The CLI posts a `DebugQueryDto` (structured JSON) to `POST /gs/debug` with a Bearer token obtained
  from `POST /auth` (DEBUG address + signature from the local `.env`, role `DEBUG`).
- No raw SQL crosses the wire. The service (`src/subdomains/generic/gs`) emits SQL manually: every
  identifier (table, column, alias, aggregate, op, order-by direction, jsonb path segment) is
  validated against an allowlist, and all leaf values are bound as parameters (`$1..$N`) — never
  interpolated — then executed with `dataSource.query` (not QueryBuilder). Writes / DDL are not
  expressible; read-only is structural.
- Reachable tables and columns are enumerated in `DebugAllowedColumns`
  (`src/subdomains/generic/gs/dto/gs.dto.ts`) — the **source of truth**. It drifts per migration:
  every migration that adds, renames, or removes a column on a debuggable table updates it. A table
  or column absent from that map is unreachable (PII / secrets / free-form text are deliberately
  excluded). The full DTO schema is `src/subdomains/generic/gs/dto/debug-query.dto.ts`.
- **Filter-only columns** (`filterOnlyColumns` on a table's `DebugTableSpec`): usable only as a
  WHERE leaf, never in select / order by / group by, and only with `=` (not `IN` — batching
  multiplies guessing throughput; one address per request, each separately audit-logged). Range,
  inequality, and pattern ops would turn the endpoint into an oracle. A filter-only column may
  not appear under a `NOT` node at any depth, including double negation (`NOT (mail = x)` is
  semantically `mail != x`). Equality is case-insensitive (`LOWER(col) = LOWER($n)`): it
  matches the application's own case-insensitive address identity (`getUsersByMail`
  resolves via `LOWER(mail)`), so the debug lookup answers the same question the
  application asks, and it tolerates the caller typing an address in a different case
  than stored. No `jsonbPath`. Intended for looking a record up by a value the
  caller already knows, without the endpoint ever disclosing that value. First instance:
  `user_data.mail` — resolve `userData.id`(s) from a known address; selecting `mail` is refused.
  One mail can map to several `user_data` rows; use a multi-row `limit` (e.g. 100), never 1.
  Ordinary allowlisted columns keep the full operator set; only filter-only columns are restricted.
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
  - Filter-only columns must not appear in `select` (plain, aggregate, or jsonb).
- `where` (optional): a tree of nodes, each with a `kind`:
  - `{"kind":"leaf","column":"x","op":"=","value":...}` — ops: `= != < <= > >= IN "NOT IN" LIKE
    ILIKE "IS NULL" "IS NOT NULL"`. `IN` / `NOT IN` take an array value; `IS NULL` / `IS NOT NULL`
    take no value; the rest take a scalar. On filter-only columns only `=` is allowed (not `IN`,
    not under any `NOT` node at any depth); equality is case-insensitive
    (`LOWER(col) = LOWER($n)`). Ordinary allowlisted columns keep the full operator set above.
  - `{"kind":"and","children":[...]}` / `{"kind":"or","children":[...]}` — up to 5 children each.
  - `{"kind":"not","child":{...}}`.
  - Caps: tree depth ≤ 5, ≤ 200 nodes, ≤ 50 leaf predicates, ≤ 100 values per IN list.
- `groupBy` (optional): array of columns or select-aliases (order preserved); filter-only columns
  are not allowed.
- `orderBy` (optional): array of `{"column":"x","direction":"ASC|DESC"}` (column or select-alias);
  filter-only columns are not allowed.
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
- `valid = false` when the jump versus the previous entry exceeds
  `Config.financeLogTotalBalanceChangeLimit` and that entry is under 15 minutes old (a larger gap
  suppresses the flag). `--anomalies` lists these rows.
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
- `user_data`: `id`, `status`, `kycStatus`, `kycLevel`, … (used by referral-tree status lookups).
  `mail` is **filter-only** (not in `columns`): WHERE `=` only (case-insensitive; not under
  `NOT`; no `IN`), never selected / ordered / grouped. CLI:
  `scripts/db-debug.sh --user-by-mail [N]` (default limit 100, integer 1..10000; trailing args
  rejected; interactive TTY prompts on stderr) or
  `scripts/db-debug.sh --user-by-mail [N] < address.txt`. Prefer interactive entry or a
  protected file — do not pipe via `echo` (that would put the address in echo's argv). The
  address is read from stdin, passed into `jq` via stdin (not `--arg`), and request bodies go
  to `curl` via `-d @-` — not in any process argv under that mode. An **inline**
  `--query '<json>'` is different: the complete DTO (including any mail value inside it) sits
  in the script's own argv and in shell history. For hand-built mail predicates, use
  `--query @file` or `--query -` (stdin / heredoc), not inline JSON. `--user-by-mail` is
  unaffected (address always from stdin). The script does not print the address; the payload
  echo redacts WHERE values. At a TTY the terminal may echo typed input into scrollback —
  accepted: the operator already knows the address; the guarantee is that the endpoint does
  not disclose unknown addresses and that the value does not reach process lists or logs that
  others read. Audit-log and error-path redaction hold under normal production config
  (`SQL_LOGGING` unset, so TypeORM query logging is off — see
  `src/shared/services/typeorm-logger.ts`). Enabling SQL query logging (`SQL_LOGGING`) makes
  TypeORM print bound parameters — including the address — for successful queries, which
  defeats that redaction. Equivalent DTO (post via `@file` or `-`, never as an inline argv
  string when it contains a real address):
  `{"table":"user_data","select":[{"kind":"column","column":"id"},{"kind":"column","column":"created"},{"kind":"column","column":"kycLevel"},{"kind":"column","column":"status"}],"where":{"kind":"leaf","column":"mail","op":"=","value":"<mail>"},"orderBy":[{"column":"id","direction":"ASC"}],"limit":100}`.
  Result is an array of rows — one mail can belong to several `user_data` records.
- `asset`: `id`, `name`, `blockchain`, `type`, … — resolve one with a `where` and-tree on
  `blockchain` + `name`, e.g. `{"kind":"and","children":[{"kind":"leaf","column":"blockchain","op":"=","value":"<chain>"},{"kind":"leaf","column":"name","op":"=","value":"<name>"}]}`.
