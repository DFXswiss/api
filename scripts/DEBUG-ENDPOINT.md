# Debug Endpoint Configuration

This document describes how to configure and use the debug endpoints for database and log access.

## Overview

The API provides two debug endpoints for authorized users with the `DEBUG` role:

| Endpoint | Purpose |
|----------|---------|
| `POST /gs/debug` | Run structured read-only queries against the database (allowlist-driven JSON DTO; no raw SQL) |
| `POST /gs/debug/logs` | Query Azure Application Insights logs |

## Prerequisites

### 1. User with DEBUG Role

Your wallet address must have the `DEBUG` role assigned in the database. Contact an admin to grant this role.

### 2. Authentication Signature

Sign the DFX login message with your wallet to get a valid signature.

## Environment Variables

### For Database Access (`/gs/debug`)

No additional server-side configuration required. The endpoint uses the existing database connection.

**Client-side configuration** (in the repo-root `.env`; the migrated scripts read this file directly):

| Variable | Required | Description |
|----------|----------|-------------|
| `DEBUG_ADDRESS` | Yes | Your Ethereum wallet address with DEBUG role |
| `DEBUG_SIGNATURE` | Yes | Signature from signing the DFX login message |
| `DEBUG_API_URL` | No | API URL (default: `https://api.dfx.swiss/v1`) |

### For Log Access (`/gs/debug/logs`)

**Server-side configuration** (in production `.env`):

| Variable | Required | Description | Where to find |
|----------|----------|-------------|---------------|
| `APPINSIGHTS_APP_ID` | Yes | Application Insights App ID | Azure Portal |
| `AZURE_TENANT_ID` | Yes | Azure AD Tenant ID | Azure Portal |
| `AZURE_CLIENT_ID` | Yes | Azure AD App Registration Client ID | Azure Portal |
| `AZURE_CLIENT_SECRET` | Yes | Azure AD App Registration Secret | Azure Portal |

## Azure Portal Configuration

### Step 1: Get Application Insights App ID

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Application Insights** → Your resource
3. In the left menu, click **Configure** → **API Access**
4. Copy the **Application ID** (NOT the Instrumentation Key!)

```
APPINSIGHTS_APP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Step 2: Get Azure AD Tenant ID

1. Go to **Azure Active Directory** → **Overview**
2. Copy the **Tenant ID**

```
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Step 3: Create App Registration

1. Go to **Azure Active Directory** → **App registrations**
2. Click **New registration**
3. Name: `DFX API Debug` (or similar)
4. Supported account types: Single tenant
5. Click **Register**
6. Copy the **Application (client) ID**

```
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Step 4: Create Client Secret

1. In your App Registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Description: `Debug endpoint access`
4. Expiry: Choose appropriate duration
5. Click **Add**
6. **Copy the secret value immediately** (it won't be shown again!)

```
AZURE_CLIENT_SECRET=your-secret-value
```

### Step 5: Grant API Permissions

1. In your App Registration, go to **API permissions**
2. Click **Add a permission**
3. Select **APIs my organization uses**
4. Search for `Application Insights API`
5. Select **Delegated permissions** or **Application permissions**
6. Check **Data.Read**
7. Click **Add permissions**
8. Click **Grant admin consent for [Your Tenant]**

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

### 3. Test log access

```bash
./scripts/log-debug.sh exceptions
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

### Log Queries

```bash
# Recent exceptions (last hour)
./scripts/log-debug.sh exceptions

# Failed requests (last 24 hours)
./scripts/log-debug.sh failures --hours 24

# Slow dependencies (>2000ms)
./scripts/log-debug.sh slow 2000

# Search traces
./scripts/log-debug.sh traces "error"

# Traces by operation ID
./scripts/log-debug.sh operation "abc12345-1234-1234-1234-123456789abc"

# Custom events
./scripts/log-debug.sh events "UserLogin"
```

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

* Flip `Process.GS_DEBUG` via `PUT /v1/setting/disabledProcesses` (ADMIN JWT). Disables both
  `/gs/debug` and `/gs/debug/logs`; propagates in ~30s without restart.
* Revoke a specific JWT by adding its `address` to the `jwtAddressDenylist` setting (lowercase
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

### "Query execution failed" for logs

- Verify Azure environment variables are set on the server
- Check that the App Registration has correct permissions
- Ensure admin consent was granted for API permissions

## Available Log Templates

| Template | Description | Required Parameters |
|----------|-------------|---------------------|
| `exceptions-recent` | Recent exceptions | - |
| `request-failures` | Failed HTTP requests | - |
| `dependencies-slow` | Slow external calls | `durationMs` |
| `traces-by-message` | Search trace messages | `messageFilter` |
| `traces-by-operation` | Traces by operation ID | `operationId` |
| `custom-events` | Custom events by name | `eventName` |
