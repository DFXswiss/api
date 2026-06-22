---
name: db-debug
description: Read-only debugging of the production database via the scripts/db-debug.sh CLI (the /gs/debug endpoint). Use to inspect financial anomalies, total-balance history (FinancialDataLog), liquidity balances, an asset's balance history, referral chains or trees, or to run an ad-hoc read-only SQL SELECT against the Postgres database. SELECT-only — never writes.
---

# Database debug (read-only)

Read-only forensics against the production database through the `scripts/db-debug.sh` CLI. The
script authenticates itself (DEBUG address + signature from the local `.env`) and posts
SELECT-only SQL to the `/gs/debug` endpoint. The server enforces read-only access through SQL
AST validation (a single SELECT only — no UNION/INTO, no system schemas, no dangerous functions).

By default this targets **production** — the local `.env` sets `DEBUG_API_URL` (defaults to
`https://api.dfx.swiss/v1`); point it at another environment by setting `DEBUG_API_URL` in `.env`.

## How to run

Run the script from the repository root (it is executable and resolves its own `.env`):

```
scripts/db-debug.sh <mode|SQL> [args]
```

Run exactly this script. Use read-only `SELECT` statements only — never writes or DDL, and never
modify the script to perform them. If a request implies a write, refuse and explain why.

## Modes

| Command | Purpose |
| --- | --- |
| `--anomalies [N]` | FinancialDataLog rows with `valid = false` (default 20) |
| `--balance [N]` | recent total-balance history (default 20) |
| `--stats` | log statistics by system / subsystem / severity |
| `--asset-history <id\|Blockchain/Name> [N]` | balance history for one asset (default 10) |
| `--referral-chain <userDataId>` | referral chain upward |
| `--referral-tree <userDataId>` | full referral tree with status |
| `"<SQL>"` | ad-hoc read-only SELECT |
| `--help` | full usage |

## Liquidity balances

`liquidity_balance` has no dedicated mode yet. It is a snapshot table (one row per asset, updated
in place; `updated` is the last refresh). Current snapshot:

```
scripts/db-debug.sh 'SELECT lb.id, lb."assetId", a.name, a.blockchain, lb.amount, lb."availableAmount", lb."isDfxOwned", lb.updated FROM liquidity_balance lb LEFT JOIN asset a ON a.id = lb."assetId" ORDER BY lb.updated DESC'
```

## Writing SQL

Table names are snake_case; column names are camelCase and **must be wrapped in double quotes**
(`"assetId"`, `"isDfxOwned"`) — unquoted identifiers are folded to lowercase by Postgres and fail
with "column does not exist".

Before composing a non-trivial query, read `reference.md` in this skill folder for the `/gs/debug`
semantics, the FinancialDataLog / `balancesTotal` structure, and the `liquidity_balance` schema. It
is not loaded until read.
