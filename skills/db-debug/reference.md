# `/gs/debug` — reference

Read this before composing a non-trivial query. Derive table and column names from the TypeORM
entities in this repository, not from the catalog (system schemas are blocked server-side).

## Endpoint & safety
- The CLI posts `{ "sql": "<SELECT>" }` to `POST /gs/debug` with a Bearer token obtained from
  `POST /auth` (DEBUG address + signature from the local `.env`, role `DEBUG`).
- The server guard (`src/subdomains/generic/gs/gs.service.ts`, `executeDebugQuery`) rejects
  anything but a single SELECT: no UNION/INTERSECT/EXCEPT, no SELECT INTO, no system schemas
  (`information_schema`, `pg_catalog`), no dangerous functions, no FOR XML/JSON, and blocked
  columns. Read-only is enforced server-side — stay SELECT-only regardless.
- The default target is production (`DEBUG_API_URL` in the local `.env`).
- Results are capped at 10000 rows: a query without `LIMIT` is auto-limited, and `LIMIT > 10000` is
  rejected. Page with an explicit `LIMIT` / `OFFSET` for larger scans.

## SQL conventions (PostgreSQL)
- Table names: snake_case (`user_data`, `log`, `asset`, `liquidity_balance`, `recommendation`).
- Column names: camelCase, case-sensitive — wrap them in double quotes (`"errorMessage"`,
  `"assetId"`, `"isDfxOwned"`). Inside single-quoted SQL on the shell the double quotes are literal.

## FinancialDataLog / balancesTotal (used by `--balance` / `--anomalies` / `--stats`)
- Stored in table `log`, `subsystem = 'FinancialDataLog'`, payload in `message` (JSON; query via
  `message::jsonb -> 'balancesTotal' ->> 'totalBalanceChf'`, etc.).
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

## liquidity_balance (snapshot, one row per asset, updated in place)
Entity: `src/subdomains/core/liquidity-management/entities/liquidity-balance.entity.ts`

| Column | Type | Meaning |
| --- | --- | --- |
| `id`, `created`, `updated` | — | from `IEntity`; `updated` is the last refresh |
| `"assetId"` | FK → `asset` | ManyToOne |
| `amount` | float, nullable | total balance |
| `"availableAmount"` | float, nullable | available balance |
| `"isDfxOwned"` | bool, default `true` | owned liquidity vs. customer holdings |

- Populated by the balance adapters (blockchain / bank / custom) in `liquidity-management`.
- Rows with `"isDfxOwned" = false` are custom-adapter balances, named `<userDataId>-<token>`.

## Other useful tables
- `recommendation`: `recommenderId`, `recommendedId`, `method`, `created` (referrals).
- `user_data`: `id`, `status`, `kycStatus`, … (used by referral-tree status lookups).
- `asset`: `id`, `name`, `blockchain`, `type`, … — resolve via
  `SELECT id, name, blockchain FROM asset WHERE blockchain = '<chain>' AND name = '<name>'`.
