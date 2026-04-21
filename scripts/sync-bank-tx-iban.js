#!/usr/bin/env node

/**
 * Sync bank_tx.accountIban from Production to Local DB
 *
 * This script:
 * 1. Fetches accountIban values from production DB via debug endpoint (SELECT only)
 * 2. Updates the local DB directly via mssql connection
 *
 * Usage:
 *   node scripts/sync-bank-tx-iban.js
 *
 * Requirements:
 *   - .env.db-debug with DEBUG_ADDRESS and DEBUG_SIGNATURE
 *   - Local SQL Server running with credentials from .env
 *   - Production API accessible
 */

const fs = require('fs');
const path = require('path');
const mssql = require('mssql');

// Load db-debug environment
const dbDebugEnvFile = path.join(__dirname, '.env.db-debug');
if (!fs.existsSync(dbDebugEnvFile)) {
  console.error('Error: .env.db-debug not found');
  process.exit(1);
}

const dbDebugEnv = {};
fs.readFileSync(dbDebugEnvFile, 'utf-8').split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    dbDebugEnv[key.trim()] = valueParts.join('=').trim();
  }
});

// Load main .env for local DB credentials
const mainEnvFile = path.join(__dirname, '..', '.env');
if (!fs.existsSync(mainEnvFile)) {
  console.error('Error: .env not found');
  process.exit(1);
}

const mainEnv = {};
fs.readFileSync(mainEnvFile, 'utf-8').split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    mainEnv[match[1].trim()] = match[2].trim();
  }
});

const PROD_API_URL = dbDebugEnv.DEBUG_API_URL || 'https://api.dfx.swiss/v1';
const DEBUG_ADDRESS = dbDebugEnv.DEBUG_ADDRESS;
const DEBUG_SIGNATURE = dbDebugEnv.DEBUG_SIGNATURE;

// Local DB config
const localDbConfig = {
  server: mainEnv.SQL_HOST || 'localhost',
  port: parseInt(mainEnv.SQL_PORT || '1433'),
  user: mainEnv.SQL_USERNAME || 'sa',
  password: mainEnv.SQL_PASSWORD,
  database: mainEnv.SQL_DB || 'dfx',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

async function getToken(apiUrl, address, signature) {
  const response = await fetch(`${apiUrl}/auth/signIn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  });
  const data = await response.json();
  if (!data.accessToken) {
    throw new Error(`Auth failed for ${apiUrl}: ${JSON.stringify(data)}`);
  }
  return data.accessToken;
}

async function executeQuery(apiUrl, token, sql) {
  const response = await fetch(`${apiUrl}/gs/debug`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ sql }),
  });
  const data = await response.json();
  if (data.statusCode && data.statusCode >= 400) {
    throw new Error(`Query failed: ${data.message}`);
  }
  return data;
}

async function main() {
  console.log('=== Sync bank_tx.accountIban from Production to Local ===\n');

  // Connect to local DB
  console.log('Connecting to local database...');
  console.log(`  Server: ${localDbConfig.server}:${localDbConfig.port}`);
  console.log(`  Database: ${localDbConfig.database}`);

  let pool;
  try {
    pool = await mssql.connect(localDbConfig);
    console.log('✓ Local database connected\n');
  } catch (e) {
    console.error('Failed to connect to local database:', e.message);
    process.exit(1);
  }

  // Get production token
  console.log('Authenticating to Production...');
  const prodToken = await getToken(PROD_API_URL, DEBUG_ADDRESS, DEBUG_SIGNATURE);
  console.log('✓ Production authenticated\n');

  // Get distinct accountIbans from production with their IDs
  console.log('Fetching accountIban data from Production...');

  const BATCH_SIZE = 1000;
  let lastId = 0;
  let totalUpdated = 0;
  let hasMore = true;

  while (hasMore) {
    console.log(`\nFetching batch after id ${lastId}...`);

    // Get batch of IDs with their accountIban from production (using TOP + WHERE id > lastId)
    const prodData = await executeQuery(
      PROD_API_URL,
      prodToken,
      `SELECT TOP ${BATCH_SIZE} id, accountIban FROM bank_tx WHERE accountIban IS NOT NULL AND id > ${lastId} ORDER BY id`
    );

    if (!Array.isArray(prodData) || prodData.length === 0) {
      console.log('No more data to fetch.');
      hasMore = false;
      break;
    }

    console.log(`Fetched ${prodData.length} records from production.`);

    // Group by accountIban to minimize updates
    const byIban = {};
    for (const row of prodData) {
      if (!row.accountIban) continue;
      if (!byIban[row.accountIban]) {
        byIban[row.accountIban] = [];
      }
      byIban[row.accountIban].push(row.id);
      if (row.id > lastId) lastId = row.id;
    }

    // Update local DB directly
    for (const [iban, ids] of Object.entries(byIban)) {
      const idList = ids.join(',');

      try {
        const request = pool.request();
        request.input('iban', mssql.NVarChar, iban);
        await request.query(`UPDATE bank_tx SET accountIban = @iban WHERE id IN (${idList})`);
        totalUpdated += ids.length;
        process.stdout.write(`\r  Updated ${totalUpdated} records...`);
      } catch (e) {
        console.error(`\nFailed to update IDs for IBAN ${iban}: ${e.message}`);
      }
    }

    if (prodData.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  // Close connection
  await pool.close();

  console.log(`\n\n=== Sync Complete ===`);
  console.log(`Total records updated: ${totalUpdated}`);

  // Verify the result
  console.log('\n=== Verification ===');
  console.log('Run this to check Maerki Baumann CHF 2025:');
  console.log('  curl -s "http://localhost:3000/v1/accounting/balance-sheet/CH3408573177975200001/2025" -H "Authorization: Bearer $TOKEN" | jq .');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
