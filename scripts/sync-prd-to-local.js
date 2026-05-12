#!/usr/bin/env node

/**
 * Sync production data to local MSSQL for reconciliation testing.
 *
 * Uses the debug API endpoint (same as db-debug.sh) to read from PRD,
 * then inserts into the local database via the mssql package.
 *
 * Usage: node scripts/sync-prd-to-local.js [--since 2026-03-01]
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');

// --- Config ---
const ENV_FILE = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(ENV_FILE, 'utf-8');

function envVar(name) {
  const match = envContent.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : undefined;
}

const DEBUG_ADDRESS = envVar('DEBUG_ADDRESS');
const DEBUG_SIGNATURE = envVar('DEBUG_SIGNATURE');
const DEBUG_API_URL = envVar('DEBUG_API_URL') || 'https://api.dfx.swiss/v1';

const LOCAL_DB = {
  server: envVar('SQL_HOST') || 'localhost',
  port: parseInt(envVar('SQL_PORT') || '1433'),
  user: envVar('SQL_USERNAME') || 'sa',
  password: envVar('SQL_PASSWORD'),
  database: envVar('SQL_DB') || 'dfx',
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000,
};

const SINCE = process.argv.includes('--since')
  ? process.argv[process.argv.indexOf('--since') + 1]
  : '2026-03-01';

// --- API helpers ---
let authToken = null;

async function authenticate() {
  const res = await fetch(`${DEBUG_API_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: DEBUG_ADDRESS, signature: DEBUG_SIGNATURE }),
  });
  const data = await res.json();
  if (!data.accessToken) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  authToken = data.accessToken;
  console.log('Authenticated with PRD API');
}

async function queryPrd(sqlQuery) {
  const res = await fetch(`${DEBUG_API_URL}/gs/debug`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ sql: sqlQuery }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PRD query failed (${res.status}): ${text}`);
  }
  return res.json();
}

// --- SQL value escaping ---
function escapeValue(val, col) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    return `'${val.replace(/'/g, "''")}'`;
  }
  return `N'${String(val).replace(/'/g, "''")}'`;
}

// --- Sync logic ---
async function syncTable(pool, { name, query, upsert }) {
  console.log(`\n--- Syncing ${name} ---`);
  console.log(`  Query: ${query.substring(0, 120)}...`);

  const rows = await queryPrd(query);
  console.log(`  Fetched ${rows.length} rows from PRD`);

  if (rows.length === 0) return;

  const cols = Object.keys(rows[0]);
  const BATCH_SIZE = upsert ? 20 : 30;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // Build a single SQL batch: SET IDENTITY_INSERT ON, then all INSERTs, then OFF
    let sqlBatch = `SET IDENTITY_INSERT [${name}] ON;\n`;

    for (const row of batch) {
      const colNames = cols.map((c) => `[${c}]`).join(', ');
      const values = cols.map((c) => escapeValue(row[c], c)).join(', ');

      if (upsert) {
        // MERGE for reference tables (avoids FK issues on DELETE)
        const setClauses = cols
          .filter((c) => c !== 'id')
          .map((c) => `target.[${c}] = ${escapeValue(row[c], c)}`)
          .join(', ');
        sqlBatch += `MERGE [${name}] AS target USING (SELECT ${row.id} AS id) AS source ON target.id = source.id `;
        sqlBatch += `WHEN MATCHED THEN UPDATE SET ${setClauses} `;
        sqlBatch += `WHEN NOT MATCHED THEN INSERT (${colNames}) VALUES (${values});\n`;
      } else {
        // Simple INSERT, skip on duplicate
        sqlBatch += `BEGIN TRY INSERT INTO [${name}] (${colNames}) VALUES (${values}); END TRY BEGIN CATCH IF ERROR_NUMBER() != 2627 AND ERROR_NUMBER() != 2601 THROW; END CATCH;\n`;
      }
    }

    sqlBatch += `SET IDENTITY_INSERT [${name}] OFF;\n`;

    try {
      await pool.request().query(sqlBatch);
      inserted += batch.length;
    } catch (err) {
      // On batch failure, try row-by-row
      for (const row of batch) {
        const colNames = cols.map((c) => `[${c}]`).join(', ');
        const values = cols.map((c) => escapeValue(row[c], c)).join(', ');

        let rowSql;
        if (upsert) {
          const setClauses = cols
            .filter((c) => c !== 'id')
            .map((c) => `target.[${c}] = ${escapeValue(row[c], c)}`)
            .join(', ');
          rowSql = `SET IDENTITY_INSERT [${name}] ON; MERGE [${name}] AS target USING (SELECT ${row.id} AS id) AS source ON target.id = source.id WHEN MATCHED THEN UPDATE SET ${setClauses} WHEN NOT MATCHED THEN INSERT (${colNames}) VALUES (${values}); SET IDENTITY_INSERT [${name}] OFF;`;
        } else {
          rowSql = `SET IDENTITY_INSERT [${name}] ON; INSERT INTO [${name}] (${colNames}) VALUES (${values}); SET IDENTITY_INSERT [${name}] OFF;`;
        }

        try {
          await pool.request().query(rowSql);
          inserted++;
        } catch (rowErr) {
          if (rowErr.message.includes('duplicate') || rowErr.message.includes('UNIQUE') || rowErr.message.includes('PRIMARY')) {
            skipped++;
          } else {
            console.error(`  Row id=${row.id}: ${rowErr.message.substring(0, 150)}`);
          }
        }
      }
    }
  }

  console.log(`  Inserted/updated: ${inserted}, skipped (duplicates): ${skipped}`);
}

// --- Table definitions ---
function getTables() {
  return [
    // Reference data — MERGE (upsert) to avoid FK constraint issues
    {
      name: 'asset',
      query: `SELECT id, name, uniqueName, dexName, type, category, blockchain, chainId, decimals, buyable, sellable, cardBuyable, cardSellable, instantBuyable, instantSellable, paymentEnabled, refEnabled, refundEnabled, personalIbanEnabled, comingSoon, approxPriceUsd, approxPriceChf, approxPriceEur, financialType, sortOrder, created, updated FROM asset`,
      upsert: true,
    },
    {
      name: 'bank',
      query: `SELECT id, name, iban, bic, currency, receive, send, sctInst, amlEnabled, assetId, created, updated FROM bank`,
      upsert: true,
    },
    {
      name: 'liquidity_management_rule',
      query: `SELECT id, context, status, targetAssetId, targetFiatId, minimal, optimal, maximal, [limit], reactivationTime, delayActivation, sendNotifications, created, updated FROM liquidity_management_rule`,
      upsert: true,
    },

    {
      name: 'liquidity_management_action',
      query: `SELECT id, system, command, tag, params, onSuccessId, onFailId, created, updated FROM liquidity_management_action`,
      upsert: true,
    },

    // Time-scoped data — INSERT (skip duplicates)
    {
      name: 'liquidity_management_pipeline',
      query: `SELECT id, status, ruleId, type, minAmount, maxAmount, ordersProcessed, created, updated FROM liquidity_management_pipeline WHERE created >= '${SINCE}'`,
    },
    {
      name: 'liquidity_management_order',
      query: `SELECT id, status, minAmount, maxAmount, inputAmount, outputAmount, inputAsset, outputAsset, pipelineId, actionId, previousOrderId, correlationId, previousCorrelationIds, errorMessage, created, updated FROM liquidity_management_order WHERE created >= '${SINCE}'`,
    },
    {
      name: 'payout_order',
      query: `SELECT id, context, correlationId, chain, assetId, amount, destinationAddress, status, transferTxId, payoutTxId, preparationFeeAssetId, preparationFeeAmount, preparationFeeAmountChf, payoutFeeAssetId, payoutFeeAmount, payoutFeeAmountChf, created, updated FROM payout_order WHERE created >= '${SINCE}'`,
    },
    {
      name: 'exchange_tx',
      query: `SELECT id, exchange, type, externalId, externalCreated, externalUpdated, status, amount, amountChf, feeAmount, feeCurrency, feeAmountChf, method, asset, currency, address, txId, [order], pair, orderType, price, cost, vol, margin, leverage, tradeId, symbol, side, created, updated FROM exchange_tx WHERE created >= '${SINCE}'`,
    },
    {
      name: 'bank_tx_batch',
      query: `SELECT id, identification, sequenceNumber, creationDate, fromDate, toDate, duplicate, iban, balanceBeforeAmount, balanceBeforeCurrency, balanceBeforeCdi, balanceAfterAmount, balanceAfterCurrency, balanceAfterCdi, totalCount, totalAmount, totalCdi, creditCount, creditAmount, debitCount, debitAmount, created, updated FROM bank_tx_batch WHERE created >= '${SINCE}'`,
    },
    {
      name: 'bank_tx',
      query: `SELECT id, accountServiceRef, bookingDate, valueDate, amount, currency, creditDebitIndicator, instructedAmount, instructedCurrency, exchangeRate, chargeAmount, chargeCurrency, accountIban, type, batchId, txId, endToEndId, created, updated FROM bank_tx WHERE created >= '${SINCE}'`,
    },
    {
      name: 'crypto_input',
      query: `SELECT TOP 5000 id, inTxId, outTxId, returnTxId, status, amount, chargebackAmount, forwardFeeAmount, forwardFeeAmountChf, assetId, blockHeight, isConfirmed, purpose, action, txType, created, updated FROM crypto_input WHERE created >= '${SINCE}'`,
    },

    // Financial logs
    {
      name: 'log',
      query: `SELECT id, system, subsystem, severity, message, category, valid, created, updated FROM log WHERE subsystem = 'FinancialDataLog' AND severity = 'Info' AND created >= '${SINCE}' ORDER BY id DESC`,
    },
  ];
}

// --- Main ---
async function main() {
  console.log(`=== PRD → Local Sync (since ${SINCE}) ===\n`);

  await authenticate();

  console.log(`Connecting to local DB at ${LOCAL_DB.server}:${LOCAL_DB.port}/${LOCAL_DB.database}...`);
  const pool = await sql.connect(LOCAL_DB);
  console.log('Connected to local DB');

  // Disable FK checks for self-referencing tables
  await pool.request().query('EXEC sp_MSforeachtable "ALTER TABLE ? NOCHECK CONSTRAINT ALL"');
  console.log('FK constraints disabled');

  const tables = getTables();

  for (const table of tables) {
    try {
      await syncTable(pool, table);
    } catch (err) {
      console.error(`\nFailed to sync ${table.name}: ${err.message.substring(0, 300)}`);
    }
  }

  // Re-enable FK checks
  await pool.request().query('EXEC sp_MSforeachtable "ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL"');
  console.log('\nFK constraints re-enabled');

  await pool.close();
  console.log('\n=== Sync complete ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
