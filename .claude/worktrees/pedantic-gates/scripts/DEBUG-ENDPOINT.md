# Debug Endpoint Configuration

This document describes how to configure and use the debug endpoints for database and log access.

## Overview

The API provides two debug endpoints for authorized users with the `DEBUG` role:

| Endpoint | Purpose |
|----------|---------|
| `POST /gs/debug` | Execute SQL queries against the database |
| `POST /gs/debug/logs` | Query Azure Application Insights logs |

## Prerequisites

### 1. User with DEBUG Role

Your wallet address must have the `DEBUG` role assigned in the database. Contact an admin to grant this role.

### 2. Authentication Signature

Sign the DFX login message with your wallet to get a valid signature.

## Environment Variables

### For Database Access (`/gs/debug`)

No additional server-side configuration required. The endpoint uses the existing database connection.

**Client-side configuration** (in `scripts/.env.db-debug`):

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

### 1. Copy the sample environment file

```bash
cp scripts/.env.db-debug.sample scripts/.env.db-debug
```

### 2. Edit the configuration

```bash
# scripts/.env.db-debug
DEBUG_ADDRESS=0xYourWalletAddress
DEBUG_SIGNATURE=0xYourSignature
DEBUG_API_URL=https://api.dfx.swiss/v1
```

### 3. Test database access

```bash
./scripts/db-debug.sh "SELECT TOP 5 id, name FROM asset"
```

### 4. Test log access

```bash
./scripts/log-debug.sh exceptions
```

## Usage Examples

### Database Queries

```bash
# Default query (assets)
./scripts/db-debug.sh

# Custom SQL query
./scripts/db-debug.sh "SELECT TOP 10 id, status, created FROM buy_crypto ORDER BY id DESC"

# Aggregation
./scripts/db-debug.sh "SELECT status, COUNT(*) as count FROM buy_crypto GROUP BY status"
```

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

1. **Never commit** `.env.db-debug` to git (it's in `.gitignore`)
2. The DEBUG role should only be granted to authorized personnel
3. All queries are logged with user identifier for audit
4. Sensitive columns are automatically masked with `[RESTRICTED]`
5. Only SELECT queries are allowed (no INSERT, UPDATE, DELETE)
6. System schemas are blocked (sys, information_schema, etc.)

## Troubleshooting

### "Unauthorized" error

- Check that your wallet has the DEBUG role
- Verify your signature is valid and not expired
- Ensure you're using the correct API URL

### "Query execution failed" for database

- Check SQL syntax (use MSSQL/T-SQL syntax)
- Verify table and column names exist
- Ensure you're not accessing blocked columns

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
