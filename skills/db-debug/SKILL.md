---
name: db-debug
description: Read-only debugging of the production database via the scripts/db-debug.sh CLI (the structured /gs/debug endpoint). Use to inspect financial anomalies, total-balance history (FinancialDataLog), liquidity balances, an asset's balance history, referral chains or trees, resolve user_data id(s) from a known mail (filter-only), compare two balance-log snapshots, inspect one asset's balance structure, or run an ad-hoc read-only query against any allowlisted table with a structured JSON DTO. No raw SQL — read-only by construction, never writes.
---

# Database debug (read-only)

Read-only forensics against the production database through the `scripts/db-debug.sh` CLI. The
script authenticates itself (DEBUG address + signature from the local `.env`) and posts a
**structured JSON query** to the `/gs/debug` endpoint. There is no raw SQL: the request body is a
`DebugQueryDto` describing table, select items, an optional where-tree, group/order/limit, which the
service emits as a hand-built SELECT with bound `$1..$N` parameters (executed via
`dataSource.query`, not QueryBuilder). Writes and DDL are not expressible, and
every identifier must appear in the per-table allowlist (`DebugAllowedColumns` in
`src/subdomains/generic/gs/dto/gs.dto.ts`) — the source of truth, which drifts per migration.

By default this targets **production** — the local `.env` sets `DEBUG_API_URL` (defaults to
`https://api.dfx.swiss/v1`); point it at another environment by setting `DEBUG_API_URL` in `.env`.

## How to run

Run the script from the repository root (it is executable and resolves its own `.env`):

```
scripts/db-debug.sh <mode> [args]
```

Run exactly this script. It is read-only by construction — the endpoint only accepts the structured
query DTO, so writes and DDL cannot be expressed. Never modify the script to attempt otherwise; if a
request implies a write, refuse and explain why.

## Modes

| Command | Purpose |
| --- | --- |
| _(no args)_ | default query (recent assets) |
| `--anomalies [N]` | FinancialDataLog rows with `valid = false` (default 20) |
| `--balance [N]` | recent total-balance history (default 20) |
| `--stats` | log statistics by system / subsystem / severity |
| `--asset-history <id\|Blockchain/Name> [N]` | balance history for one asset (default 10) |
| `--referral-chain <userDataId>` | referral chain upward |
| `--referral-tree <userDataId>` | full referral tree with status |
| `--user-by-mail [N]` | resolve `user_data` id(s) from a known mail on stdin (filter-only; mail never returned; not in process argv; script does not print it; payload echo redacts WHERE values; TTY may echo typed input into scrollback — accepted; audit/error redaction holds when SQL query logging is off / prod `SQL_LOGGING` unset; default limit 100 positive integer, trailing args rejected; one mail can match several rows) |
| `--get <table> [col1,col2,...] [limit]` | ad-hoc: fetch columns (default `id,created,updated`) from any allowlisted table (default limit 100) |
| `--query <json\|@file\|->` | ad-hoc: POST an arbitrary structured DTO (inline JSON, `@file`, or `-` to read the DTO from stdin) |
| `--help` | full usage |

## Ad-hoc queries

Use `--get` for the common case (columns from one table) and `--query` for anything that needs a
where-tree, aggregate, jsonb path, group by, or order by. `--query` validates that its payload is
well-formed JSON (via `jq`) and fails loudly before contacting the endpoint.

```
# Latest 100 rows of a table, default columns id,created,updated
scripts/db-debug.sh --get user_data

# Specific columns and a limit
scripts/db-debug.sh --get buy_crypto id,created,amountInEur 50

# Resolve user_data id(s) from a mail you already know (filter-only; mail is never returned).
# Address on stdin — not in process argv; script does not print it; payload echo redacts
# WHERE values. Prefer interactive entry or a protected file over piping via `echo`
# (which would put the address in echo's argv).
scripts/db-debug.sh --user-by-mail   # interactive: prompts "Mail address: " on stderr
scripts/db-debug.sh --user-by-mail < address.txt
scripts/db-debug.sh --user-by-mail 50 < address.txt

# Arbitrary DTO inline
scripts/db-debug.sh --query '{"table":"asset","select":[{"kind":"column","column":"id"},{"kind":"column","column":"name"}],"where":{"kind":"leaf","column":"blockchain","op":"=","value":"Ethereum"},"orderBy":[{"column":"id","direction":"DESC"}],"limit":20}'

# Arbitrary DTO from a file, or from stdin
scripts/db-debug.sh --query @/tmp/query.json
cat query.json | scripts/db-debug.sh --query -
```

## Liquidity balances

`liquidity_balance` has no dedicated mode, but `--get` reads it directly. It is a snapshot table
(one row per asset, updated in place; `updated` is the last refresh). The endpoint has no JOINs, so
resolve asset names with a separate `asset` query. Current snapshot:

```
scripts/db-debug.sh --get liquidity_balance id,assetId,amount,availableAmount,isDfxOwned,updated 100
```

## Balance forensics (companion scripts)

Three companion scripts share the same `.env` auth and the same `log` / FinancialDataLog source, for
investigating total-balance steps (see the `valid` / suspicious-step heuristic in `reference.md`). A
`<log_id>` is the `log.id` of a FinancialDataLog entry — find candidates with `--balance` or
`--anomalies` above. All three are read-only — they only issue structured `/gs/debug` queries (no
writes); `sum-asset-balances.sh` also reads the `asset` table to resolve IDs.

| Command | Purpose |
| --- | --- |
| `scripts/compare-balance-logs.sh <log_id_1> <log_id_2>` | diff two snapshots: plus / minus / total deltas plus the top asset changes ranked by CHF impact |
| `scripts/inspect-asset-balance.sh <log_id> <asset_id>` | full plus / minus breakdown for one asset in a log entry (incl. the liquidity sub-structure) |
| `scripts/sum-asset-balances.sh <log_id> <financial_type>` | sum plus / minus / net CHF across assets of one `financialType` (per-asset `plusBalance.total` shown in the breakdown) |

## Composing a query

Table names are snake_case; column names are camelCase and **case-sensitive**. Both must appear in
the table's `DebugAllowedColumns` entry — anything not listed there is unreachable. `id`, `created`
and `updated` exist on every allowlisted table. `select` needs at least one item; each is a `column`,
a `jsonb` path (only on columns in `jsonbColumns`, currently just `log.message`), or an `aggregate`.
`where` is an optional tree of `leaf` / `and` / `or` / `not` nodes; `limit` is required.

Before composing a non-trivial query, read `reference.md` in this skill folder for the full DTO
shape, the where-tree operators and caps, the FinancialDataLog / `balancesTotal` structure, and the
`liquidity_balance` schema. It is not loaded until read.
