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
```

For ad-hoc queries the endpoint expects a JSON DTO (no raw SQL). See the
`payload_*` builders in `scripts/db-debug.sh` for the request shape, and
`src/subdomains/generic/gs/dto/debug-query.dto.ts` for the full schema. The
per-table column allowlist lives in
`src/subdomains/generic/gs/dto/gs.dto.ts` (`DebugAllowedColumns`); a column
absent from a table's entry is unreachable from this endpoint.

## Security Notes

1. **Never commit** `.env` to git (it's in `.gitignore`)
2. The DEBUG role should only be granted to authorized personnel
3. All queries are logged with user identifier for audit (`Debug-query by <addr>: …`).
   WHERE leaf values are redacted in the audit log; structure (table / columns / ops) is preserved.
4. The endpoint accepts a structured JSON DTO only — no raw SQL is parsed, walked, or interpolated.
5. Identifiers (table, column, alias, aggregate, op, ORDER BY direction, jsonb path segment)
   are validated against an allowlist before being interpolated into SQL; values are bound as
   `$1..$N` parameters via TypeORM.
6. Tables and columns reachable from this endpoint are enumerated in `DebugAllowedColumns`
   (`src/subdomains/generic/gs/dto/gs.dto.ts`). Anything not listed there is unreachable;
   PII / secrets / free-form text are deliberately excluded.

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
- Verify every referenced column appears in that table's `columns` array
- jsonb path access (the `jsonb` select kind) is allowed only on columns listed in `jsonbColumns`
  (currently only `log.message`)
- If the JSON body is malformed at the DTO level (wrong `kind`, missing required field, value out
  of range) NestJS' ValidationPipe rejects with a 400 before the service runs
