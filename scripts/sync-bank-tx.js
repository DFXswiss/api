#!/usr/bin/env node

/**
 * Script to sync bank_tx data from production to local database
 * Usage: node scripts/sync-bank-tx.js
 */

const https = require('https');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.db-debug') });

const API_URL = process.env.DEBUG_API_URL || 'https://api.dfx.swiss/v1';
const DEBUG_ADDRESS = process.env.DEBUG_ADDRESS;
const DEBUG_SIGNATURE = process.env.DEBUG_SIGNATURE;

const BATCH_SIZE = 500;
const DATE_FROM = '2025-01-01T00:00:00.000Z';
const DATE_TO = '2025-12-31T23:59:59.999Z';

// Non-restricted columns for bank_tx (excluding FK columns: transactionId, batchId)
const COLUMNS = [
  'id', 'accountServiceRef', 'bookingDate', 'valueDate', 'txCount', 'endToEndId',
  'instructionId', 'txId', 'amount', 'currency', 'creditDebitIndicator',
  'instructedAmount', 'instructedCurrency', 'txAmount', 'txCurrency',
  'exchangeSourceCurrency', 'exchangeTargetCurrency', 'exchangeRate',
  'clearingSystemId', 'memberId', 'bankName', 'chargeAmount', 'chargeCurrency',
  'type', 'aba', 'accountingAmountBeforeFee', 'accountingFeeAmount',
  'accountingFeePercent', 'accountingAmountAfterFee', 'accountingAmountBeforeFeeChf',
  'accountingAmountAfterFeeChf', 'highRisk', 'chargeAmountChf',
  'senderChargeAmount', 'senderChargeCurrency', 'bankReleaseDate',
  'domainCode', 'familyCode', 'subFamilyCode', 'updated', 'created'
];

async function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function authenticate() {
  console.log('Authenticating...');
  const url = new URL(`${API_URL}/auth/signIn`);
  const response = await httpRequest({
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ address: DEBUG_ADDRESS, signature: DEBUG_SIGNATURE }));

  if (!response.accessToken) {
    throw new Error('Authentication failed: ' + JSON.stringify(response));
  }
  console.log('Authenticated successfully');
  return response.accessToken;
}

async function executeQuery(token, sql) {
  const url = new URL(`${API_URL}/gs/debug`);
  return httpRequest({
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, JSON.stringify({ sql }));
}

function escapeValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'number') return val.toString();
  // Escape single quotes
  return `'${String(val).replace(/'/g, "''")}'`;
}

function executeSql(sql) {
  try {
    execSync(`docker exec dfx-mssql /opt/mssql-tools18/bin/sqlcmd -U sa -P 'LocalDev2026@SQL' -d dfx -C -Q "${sql.replace(/"/g, '\\"')}"`, {
      stdio: 'pipe',
      maxBuffer: 50 * 1024 * 1024
    });
    return true;
  } catch (e) {
    console.error('SQL Error:', e.message);
    return false;
  }
}

async function main() {
  try {
    const token = await authenticate();

    // Get count
    console.log('\nCounting records...');
    const countResult = await executeQuery(token,
      `SELECT COUNT(*) as count FROM bank_tx WHERE valueDate >= '${DATE_FROM}' AND valueDate <= '${DATE_TO}'`
    );
    const totalCount = countResult[0].count;
    console.log(`Total records to sync: ${totalCount}`);

    // Get ID range
    const rangeResult = await executeQuery(token,
      `SELECT MIN(id) as minId, MAX(id) as maxId FROM bank_tx WHERE valueDate >= '${DATE_FROM}' AND valueDate <= '${DATE_TO}'`
    );
    const minId = rangeResult[0].minId;
    const maxId = rangeResult[0].maxId;
    console.log(`ID range: ${minId} - ${maxId}`);

    // Clear local table
    console.log('\nClearing local bank_tx table...');
    executeSql('SET QUOTED_IDENTIFIER ON; DELETE FROM bank_tx;');

    // Fetch and insert in batches
    let currentId = minId;
    let totalInserted = 0;

    while (currentId <= maxId) {
      const sql = `SELECT ${COLUMNS.join(', ')} FROM bank_tx WHERE id >= ${currentId} AND id < ${currentId + BATCH_SIZE} AND valueDate >= '${DATE_FROM}' AND valueDate <= '${DATE_TO}' ORDER BY id`;

      console.log(`\nFetching batch starting at ID ${currentId}...`);
      const rows = await executeQuery(token, sql);

      if (rows.length === 0) {
        currentId += BATCH_SIZE;
        continue;
      }

      console.log(`Got ${rows.length} rows, inserting...`);

      // Insert in smaller chunks
      const chunkSize = 50;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const values = chunk.map(row => {
          const vals = COLUMNS.map(col => escapeValue(row[col]));
          return `(${vals.join(', ')})`;
        }).join(',\n');

        const insertSql = `SET QUOTED_IDENTIFIER ON; SET IDENTITY_INSERT bank_tx ON; INSERT INTO bank_tx (${COLUMNS.join(', ')}) VALUES ${values}; SET IDENTITY_INSERT bank_tx OFF;`;

        if (executeSql(insertSql)) {
          totalInserted += chunk.length;
        }
      }

      console.log(`Progress: ${totalInserted} / ${totalCount} (${Math.round(totalInserted/totalCount*100)}%)`);
      currentId += BATCH_SIZE;
    }

    console.log(`\n✅ Done! Inserted ${totalInserted} records.`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
