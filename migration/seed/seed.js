const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// ============================================================================
// SAFETY CHECKS - Prevent accidental seeding of production databases
// ============================================================================

// Check 1: Only allow seeding in local environment
const allowedEnvironments = ['loc', 'local', undefined, ''];
const currentEnv = process.env.ENVIRONMENT;

if (!allowedEnvironments.includes(currentEnv)) {
  console.error('❌ SAFETY BLOCK: Seeding is only allowed in local environment!');
  console.error(`   Current ENVIRONMENT: ${currentEnv}`);
  console.error(`   Allowed: loc, local, or unset`);
  process.exit(1);
}

// Check 2: Only allow seeding to local/dev database hosts
const dbHost = process.env.SQL_HOST || 'localhost';
const allowedHostPatterns = [
  'localhost',
  '127.0.0.1',
  /^sql-dfx-api-loc/i, // Azure loc database
  /loc.*\.database\.windows\.net/i, // Any Azure loc database
];

const isHostAllowed = allowedHostPatterns.some((pattern) =>
  pattern instanceof RegExp ? pattern.test(dbHost) : dbHost === pattern,
);

if (!isHostAllowed) {
  console.error('❌ SAFETY BLOCK: Database host not in allowed list!');
  console.error(`   Current host: ${dbHost}`);
  console.error('   Allowed: localhost, 127.0.0.1, sql-dfx-api-loc*, *loc*.database.windows.net');
  process.exit(1);
}

console.log(`✓ Safety checks passed (env=${currentEnv || 'unset'}, host=${dbHost})`);

// ============================================================================

const config = {
  user: process.env.SQL_USERNAME || 'sa',
  password: process.env.SQL_PASSWORD || 'LocalDev2026@SQL',
  host: process.env.SQL_HOST || 'localhost',
  port: parseInt(process.env.SQL_PORT) || 5432,
  database: process.env.SQL_DB || 'dfx',
  // Local-only script (host is restricted above); default to no SSL, opt in via SQL_SSL=true.
  ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

const quoteIdent = (name) => `"${name}"`;

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];

  const parseRow = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]).filter((h) => h);
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      let val = (values[j] || '').trim();
      if (val === 'TRUE') val = true;
      else if (val === 'FALSE') val = false;
      else if (val === '') val = null;
      row[headers[j]] = val;
    }
    if (row.id) data.push(row);
  }
  return data;
}

async function seedTable(client, tableName, data, columns) {
  // Insert rows only when the table is empty (keeps re-runs idempotent)
  const countResult = await client.query(`SELECT COUNT(*) AS count FROM ${quoteIdent(tableName)}`);
  if (Number(countResult.rows[0].count) > 0) {
    console.log(`  ${tableName}: already has ${countResult.rows[0].count} rows, skipping insert`);
  } else {
    console.log(`  ${tableName}: inserting ${data.length} rows...`);

    for (const row of data) {
      const cols = columns.filter((c) => row[c] !== null && row[c] !== undefined);
      const vals = cols.map((c) => {
        const v = row[c];
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
        return v;
      });

      const sql = `INSERT INTO ${quoteIdent(tableName)} (${cols.map(quoteIdent).join(', ')}) VALUES (${vals.join(', ')})`;
      try {
        await client.query(sql);
      } catch (e) {
        // Ignore duplicate key errors silently
        if (!e.message.includes('duplicate key')) {
          console.log(`    Error row ${row.id}: ${e.message.substring(0, 60)}`);
        }
      }
    }
  }

  // Always advance the identity sequence past the highest id. Rows are inserted with
  // explicit ids, which do not bump the sequence, so a later auto-generated insert
  // would otherwise collide. Running this unconditionally keeps the sequence correct
  // even if an earlier run inserted rows but exited before reaching this point.
  await client.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${quoteIdent(tableName)}))`,
    [tableName],
  );
}

async function waitForTables(client, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.query('SELECT 1 FROM language LIMIT 1');
      return true;
    } catch (e) {
      if (i < maxRetries - 1) {
        console.log(`  Waiting for tables... (${i + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  return false;
}

async function main() {
  const seedDir = __dirname;

  console.log('Connecting to database...');
  let client;
  try {
    client = new Client(config);
    await client.connect();
  } catch (e) {
    console.log('Could not connect to database:', e.message);
    console.log('Skipping seed (database may not be ready yet)');
    process.exit(0);
  }

  console.log('Waiting for tables to be created...');
  const tablesReady = await waitForTables(client);
  if (!tablesReady) {
    console.log('Tables not ready after timeout. Run "npm run seed" after API starts.');
    await client.end();
    process.exit(0);
  }

  console.log('Seeding database...');

  // Wallet (must be first - other tables depend on it)
  const walletData = parseCSV(path.join(seedDir, 'wallet.csv'));
  await seedTable(client, 'wallet', walletData, [
    'id',
    'address',
    'name',
    'isKycClient',
    'displayName',
    'autoTradeApproval',
    'usesDummyAddresses',
    'displayFraudWarning',
  ]);

  // Language
  const langData = parseCSV(path.join(seedDir, 'language.csv'));
  await seedTable(client, 'language', langData, ['id', 'symbol', 'name', 'foreignName', 'enable']);

  // PriceRule (must be before Fiat and Asset due to FK constraints)
  const priceRuleData = parseCSV(path.join(seedDir, 'price_rule.csv'));
  await seedTable(client, 'price_rule', priceRuleData, [
    'id',
    'priceSource',
    'priceAsset',
    'priceReference',
    'check1Source',
    'check1Asset',
    'check1Reference',
    'check1Limit',
    'check2Source',
    'check2Asset',
    'check2Reference',
    'check2Limit',
    'currentPrice',
    'priceValiditySeconds',
    'assetDisplayName',
    'referenceDisplayName',
  ]);

  // Fiat
  const fiatData = parseCSV(path.join(seedDir, 'fiat.csv'));
  await seedTable(client, 'fiat', fiatData, [
    'id',
    'name',
    'buyable',
    'sellable',
    'cardBuyable',
    'cardSellable',
    'instantBuyable',
    'instantSellable',
    'approxPriceChf',
    'priceRuleId',
  ]);

  // Country
  const countryData = parseCSV(path.join(seedDir, 'country.csv'));
  await seedTable(client, 'country', countryData, [
    'id',
    'symbol',
    'name',
    'symbol3',
    'dfxEnable',
    'dfxOrganizationEnable',
    'lockEnable',
    'ipEnable',
    'yapealEnable',
    'fatfEnable',
    'nationalityEnable',
    'nationalityStepEnable',
    'bankTransactionVerificationEnable',
    'bankEnable',
    'cryptoEnable',
    'checkoutEnable',
  ]);

  // Asset - drop unique index that conflicts with NULL dexName values
  try {
    await client.query('DROP INDEX IF EXISTS "IDX_83f52471fd746482b83b20f51b"');
  } catch (e) {
    /* Index may not exist */
  }
  const assetData = parseCSV(path.join(seedDir, 'asset.csv'));
  await seedTable(client, 'asset', assetData, [
    'id',
    'name',
    'type',
    'buyable',
    'sellable',
    'chainId',
    'sellCommand',
    'dexName',
    'category',
    'blockchain',
    'uniqueName',
    'description',
    'comingSoon',
    'sortOrder',
    'approxPriceUsd',
    'ikna',
    'priceRuleId',
    'approxPriceChf',
    'cardBuyable',
    'cardSellable',
    'instantBuyable',
    'instantSellable',
    'financialType',
    'decimals',
    'paymentEnabled',
    'amlRuleFrom',
    'amlRuleTo',
    'approxPriceEur',
    'refundEnabled',
  ]);

  // IpLog (required for auth to work - needs at least one entry with old created date)
  const oldDate = new Date();
  oldDate.setFullYear(oldDate.getFullYear() - 1);

  const ipLogCount = await client.query('SELECT COUNT(*) AS count FROM ip_log');
  if (Number(ipLogCount.rows[0].count) === 0) {
    console.log('  ip_log: inserting 1 rows...');
    await client.query(
      `INSERT INTO ip_log (address, ip, country, url, result, created, updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['0x0000000000000000000000000000000000000000', '127.0.0.1', 'CH', '/v1/auth', true, oldDate, oldDate],
    );
  } else {
    console.log(`  ip_log: already has ${ipLogCount.rows[0].count} rows, fixing oldest entry date...`);
    // Ensure at least one entry has an old date (required for IpLogService.updateUserIpLogs)
    await client.query('UPDATE ip_log SET created = $1, updated = $1 WHERE id = (SELECT MIN(id) FROM ip_log)', [
      oldDate,
    ]);
  }

  // Fee (required for transaction fees)
  const feeData = parseCSV(path.join(seedDir, 'fee.csv'));
  await seedTable(client, 'fee', feeData, [
    'id',
    'label',
    'type',
    'rate',
    'accountType',
    'active',
    'fixed',
    'payoutRefBonus',
    'blockchainFactor',
    'paymentMethodsIn',
    'paymentMethodsOut',
  ]);

  // Bank (required for payment processing)
  const bankData = parseCSV(path.join(seedDir, 'bank.csv'));
  await seedTable(client, 'bank', bankData, [
    'id',
    'name',
    'iban',
    'bic',
    'currency',
    'receive',
    'send',
    'sctInst',
    'amlEnabled',
  ]);

  // Fix fiat priceRuleId links (always run to ensure consistency)
  console.log('  Fixing fiat price rule links...');
  const fiatRuleMapping = { CHF: 2, EUR: 39, USD: 1, AED: 45 };
  for (const [fiatName, ruleId] of Object.entries(fiatRuleMapping)) {
    await client.query(
      'UPDATE fiat SET "priceRuleId" = $1 WHERE name = $2 AND ("priceRuleId" IS NULL OR "priceRuleId" != $1)',
      [ruleId, fiatName],
    );
  }

  // Note: Deposit addresses are NOT seeded here.
  // They must be created via the API (/deposit endpoint) to ensure Alchemy webhook registration.
  // Run 'npm run setup' after API starts to create deposits properly.

  await client.end();
  console.log('Seed complete!');
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
