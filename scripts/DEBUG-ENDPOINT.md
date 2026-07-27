# Debug Endpoint Configuration

This document describes how to configure and use the debug endpoint for database access.

## Overview

The API provides a debug endpoint for authorized users with the `DEBUG` role:

| Endpoint         | Purpose                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `POST /gs/debug` | Run structured read-only queries against the database (allowlist-driven JSON DTO; no raw SQL) |

> **Where are the logs?** The former `/gs/debug/logs` endpoint (Azure Application Insights) was removed during the on-prem cutover. Container logs now live in **Grafana on dfx01** — Loki ingests all dfx-api stdout via the Alloy agent on dfxprd/dfxdev, retained ~30 days. Operators query it through the Grafana UI; ask an admin for access.

## Prerequisites

### 1. User with DEBUG Role

Your wallet address must have the `DEBUG` role assigned in the database. Contact an admin to grant this role.

### 2. Authentication Signature

Sign the DFX login message with your wallet to get a valid signature.

## Environment Variables

### For Database Access (`/gs/debug`)

No additional server-side configuration required. The endpoint uses the existing database connection.

**Client-side configuration** (in the repo-root `.env`; the migrated scripts read this file directly):

| Variable          | Required | Description                                   |
| ----------------- | -------- | --------------------------------------------- |
| `DEBUG_ADDRESS`   | Yes      | Your Ethereum wallet address with DEBUG role  |
| `DEBUG_SIGNATURE` | Yes      | Signature from signing the DFX login message  |
| `DEBUG_API_URL`   | No       | API URL (default: `https://api.dfx.swiss/v1`) |

## Local Setup

### 1. Add the debug credentials to the repo-root `.env`

The migrated shell scripts (`db-debug.sh`, `compare-balance-logs.sh`,
`inspect-asset-balance.sh`, `sum-asset-balances.sh`, `sync-prod-logs.js`) all
read these variables from `<repo-root>/.env`. Append:

```bash
DEBUG_ADDRESS=0xYourWalletAddress
DEBUG_SIGNATURE=0xYourSignature
DEBUG_API_URL=https://api.dfx.swiss/v1   # optional; defaults to prod
```

`DEBUG_SIGNATURE` is the signature of the DFX login message produced by signing
with the wallet at `DEBUG_ADDRESS`.

### 2. Test database access

```bash
./scripts/db-debug.sh                # default mode: assets summary
./scripts/db-debug.sh --balance 10   # last 10 FinancialDataLog totals
./scripts/db-debug.sh --help         # all predefined modes
```

## Usage Examples

### Database Queries

```bash
# Default query (assets summary)
./scripts/db-debug.sh

# FinancialDataLog anomalies (valid=false rows)
./scripts/db-debug.sh --anomalies 50

# Recent balance history
./scripts/db-debug.sh --balance 20

# Log statistics by system/subsystem/severity
./scripts/db-debug.sh --stats

# Asset balance history (by id or Blockchain/Name)
./scripts/db-debug.sh --asset-history 405 20
./scripts/db-debug.sh --asset-history Yapeal/EUR 20

# Referral chain / tree for a userDataId
./scripts/db-debug.sh --referral-chain 370625
./scripts/db-debug.sh --referral-tree  370625

# Resolve user_data id(s) from a mail you already know (filter-only; mail is never returned).
# Address on stdin — not in process argv; script does not print it; errors never echo
# submitted values; payload echo redacts WHERE values. Prefer interactive entry or a
# protected file over piping via `echo` (which would put the address in echo's argv).
./scripts/db-debug.sh --user-by-mail   # interactive: prompts "Mail address (input hidden): "
./scripts/db-debug.sh --user-by-mail < address.txt
./scripts/db-debug.sh --user-by-mail 50 < address.txt
```

For ad-hoc queries the endpoint expects a JSON DTO (no raw SQL). See the
`payload_*` builders in `scripts/db-debug.sh` for the request shape, and
`src/subdomains/generic/gs/dto/debug-query.dto.ts` for the full schema. The
per-table column allowlist lives in
`src/subdomains/generic/gs/dto/gs.dto.ts` (`DebugAllowedColumns`); a column
absent from a table's entry is unreachable from this endpoint.

### Filter-only columns

Most allowlisted columns may appear in `select` / `where` / `orderBy` / `groupBy` and accept
the full ordinary operator set. A **filter-only** column is narrower: it may appear only as a
WHERE leaf, only with `=` (not `IN` — batching multiplies guessing throughput; one address
per request, each separately audit-logged), never under a `NOT` node at any depth (including
double negation: `NOT (mail = x)` is semantically `mail != x`), and never in select, order by,
or group by. Equality is case-insensitive (`LOWER(col) = LOWER($n)`): it matches the
application's own case-insensitive address identity (`getUsersByMail` resolves via
`LOWER(mail)`), so the debug lookup answers the same question the application asks, and
it tolerates the caller typing an address in a different case than stored. The intent is
lookup by a value the caller already knows, without the endpoint ever disclosing that
value.

The first instance is `user_data.mail` (`filterOnlyColumns` on the `user_data` entry in
`DebugAllowedColumns`). Support needs to resolve a customer's `userData.id` from an address
they already have; the endpoint must not become a way to read addresses out. Selecting
`mail` (or ordering / grouping by it) is rejected with 400. One mail can map to several
`user_data` rows — the result is an array of matching rows (do not clamp `limit` to 1).

Convenience mode and equivalent raw DTO:

```bash
# Interactive (TTY prompts on stderr with input hidden) or from a protected file —
# avoid `echo … |` so the address never lands in an external process's argv.
./scripts/db-debug.sh --user-by-mail
./scripts/db-debug.sh --user-by-mail < address.txt

# Same query as an ad-hoc --query payload (mail bound as a JSON value; never returned).
# Prefer --query @file or --query - (stdin / heredoc) so the address is not in the shell's
# command line. An inline `--query '<json>'` places the full DTO — including the mail value
# — in the script's own argv and in shell history; do not use that form for sensitive values
# such as filter-only columns (e.g. user_data.mail). --user-by-mail is unaffected: it always
# reads the address from stdin.
./scripts/db-debug.sh --query - <<'EOF'
{
  "table": "user_data",
  "select": [
    {"kind": "column", "column": "id"},
    {"kind": "column", "column": "created"},
    {"kind": "column", "column": "kycLevel"},
    {"kind": "column", "column": "status"}
  ],
  "where": {"kind": "leaf", "column": "mail", "op": "=", "value": "user@example.com"},
  "orderBy": [{"column": "id", "direction": "ASC"}],
  "limit": 100
}
EOF
```

**Client argv and redaction guarantee (`scripts/db-debug.sh`):** Request bodies are sent to
`curl` via stdin (`-d @-`), so they never appear in curl's process arguments. That is not a
blanket guarantee for every form of input: an inline `--query '<json>'` still places the
complete DTO (including any value inside it) in the script's own argv and in shell history.
For ordinary non-sensitive queries that is fine; for any sensitive value — in particular a
filter-only column such as `user_data.mail` — use `--query @file` or `--query -` (stdin)
instead. `--user-by-mail` reads the address from stdin (not a positional argument). The
address is passed into `jq` via stdin (not `--arg`) and every request body is sent with
`curl … -d @-`. Under that mode the address is not placed in any process's argv. The script
does not print the address; error messages are value-free (no submitted limit, trailing arg,
or address is echoed); and the payload echo redacts WHERE leaf values (`<scalar>` /
`<array:N>`, matching `serializeDebugQueryForAudit`). At a TTY the prompt states that input
is hidden and read uses echo-off, so the address does not enter terminal scrollback; pipes
use plain read. Audit-log and error-path redaction hold under normal production config
(`SQL_LOGGING` unset, so TypeORM query logging is off — see the comment in
`src/shared/services/typeorm-logger.ts`). Enabling SQL query logging (`SQL_LOGGING`) makes
TypeORM print bound parameters — including the address — for successful queries, which
defeats that redaction. Optional `[N]` on `--user-by-mail` is an integer in `1..10000`
(server DTO cap); default remains 100; extra arguments are rejected by count.

## Security Notes

1. **Never commit** `.env` to git (it's in `.gitignore`)
2. The DEBUG role should only be granted to authorized personnel
3. Every debug request that passes DTO validation and reaches the service is audit-logged with
   the caller identifier (`Debug-query by <addr>: …`) before emit/execute — including ones later
   rejected for an unknown table or a disallowed column. Requests rejected by NestJS'
   ValidationPipe (e.g. `limit: 0`, invalid `kind`) never reach the service and produce no
   audit line. The log is the redacted DTO structure (table / select / where ops / columns);
   WHERE leaf values are replaced with `<scalar>` / `<array:N>` and never logged verbatim.
   Failed executions get a separate `… failed:` info line with value-free diagnostics only
   (SQLSTATE `code`, and when present `severity` / `routine`). The raw database error
   message is never logged — Postgres may echo bound parameter values in it, which would
   defeat WHERE-value redaction. Missing `code` is logged as `code=<unknown>`.

4. The endpoint accepts a structured JSON DTO only — no raw SQL is parsed, walked, or interpolated.
5. Identifiers (table, column, alias, aggregate, op, ORDER BY direction, jsonb path segment)
   are validated against an allowlist before being interpolated into a hand-built SQL string;
   values are bound as `$1..$N` parameters and executed via `dataSource.query` (not QueryBuilder).
6. Tables and columns reachable from this endpoint are enumerated in `DebugAllowedColumns`
   (`src/subdomains/generic/gs/dto/gs.dto.ts`). Anything not listed there is unreachable;
   PII / secrets / free-form text are deliberately excluded. Filter-only columns
   (`filterOnlyColumns`, e.g. `user_data.mail`) may be used only as WHERE leaves with `=`
   (not `IN`, not under `NOT`; equality is case-insensitive) and are never returned in results.

### Kill switch / revocation

- Flip `Process.GS_DEBUG` via `PUT /v1/setting/disabledProcesses` (ADMIN JWT). Disables
  `/gs/debug`; propagates in ~30s without restart.
- Revoke a specific JWT by adding its `address` to the `jwtAddressDenylist` setting (lowercase
  JSON array); refreshes in ~30s.

## Troubleshooting

### "Unauthorized" error

- Check that your wallet has the DEBUG role
- Verify your signature is valid and not expired
- Ensure you're using the correct API URL

### "Query execution failed" for database

- Verify the table is listed in `DebugAllowedColumns`
- Verify every referenced column appears in that table's `columns` array (or, for WHERE only,
  in `filterOnlyColumns` — filter-only columns cannot be selected / ordered / grouped)
- jsonb path access (the `jsonb` select kind) is allowed only on columns listed in `jsonbColumns`
  (currently only `log.message`)
- Filter-only columns accept only `=` in WHERE (not `IN`, not under any `NOT`); equality is
  case-insensitive; other operators are rejected
- If the JSON body is malformed at the DTO level (wrong `kind`, missing required field, value out
  of range) NestJS' ValidationPipe rejects with a 400 before the service runs
