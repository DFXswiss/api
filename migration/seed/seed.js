const fs = require('fs');
const path = require('path');
const mssql = require('mssql');

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
  /^sql-dfx-api-loc/i,           // Azure loc database
  /loc.*\.database\.windows\.net/i, // Any Azure loc database
];

const isHostAllowed = allowedHostPatterns.some(pattern =>
  pattern instanceof RegExp ? pattern.test(dbHost) : dbHost === pattern
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
  server: process.env.SQL_HOST || 'localhost',
  port: parseInt(process.env.SQL_PORT) || 1433,
  database: process.env.SQL_DB || 'dfx',
  options: {
    encrypt: process.env.SQL_ENCRYPT === 'true',
    trustServerCertificate: true
  }
};

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
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

  const headers = parseRow(lines[0]).filter(h => h);
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

async function seedTable(pool, tableName, data, columns) {
  // Check if table has data
  const countResult = await pool.request().query(`SELECT COUNT(*) as count FROM ${tableName}`);
  if (countResult.recordset[0].count > 0) {
    console.log(`  ${tableName}: already has ${countResult.recordset[0].count} rows, skipping`);
    return;
  }

  console.log(`  ${tableName}: inserting ${data.length} rows...`);

  for (const row of data) {
    const cols = columns.filter(c => row[c] !== null && row[c] !== undefined);
    const vals = cols.map(c => {
      const v = row[c];
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
      return v;
    });

    const sql = `SET IDENTITY_INSERT ${tableName} ON; INSERT INTO ${tableName} (${cols.join(',')}) VALUES (${vals.join(',')}); SET IDENTITY_INSERT ${tableName} OFF;`;
    try {
      await pool.request().query(sql);
    } catch (e) {
      // Ignore duplicate key errors silently
      if (!e.message.includes('duplicate key')) {
        console.log(`    Error row ${row.id}: ${e.message.substring(0, 60)}`);
      }
    }
  }
}

async function waitForTables(pool, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await pool.request().query('SELECT TOP 1 * FROM language');
      return true;
    } catch (e) {
      if (i < maxRetries - 1) {
        console.log(`  Waiting for tables... (${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  return false;
}

async function main() {
  const seedDir = __dirname;

  console.log('Connecting to database...');
  let pool;
  try {
    pool = await mssql.connect(config);
  } catch (e) {
    console.log('Could not connect to database:', e.message);
    console.log('Skipping seed (database may not be ready yet)');
    process.exit(0);
  }

  console.log('Waiting for tables to be created...');
  const tablesReady = await waitForTables(pool);
  if (!tablesReady) {
    console.log('Tables not ready after timeout. Run "npm run seed" after API starts.');
    await pool.close();
    process.exit(0);
  }

  console.log('Seeding database...');

  // Wallet (must be first - other tables depend on it)
  const walletData = parseCSV(path.join(seedDir, 'wallet.csv'));
  await seedTable(pool, 'wallet', walletData, ['id', 'address', 'name', 'isKycClient', 'displayName', 'autoTradeApproval', 'usesDummyAddresses', 'displayFraudWarning']);

  // Language
  const langData = parseCSV(path.join(seedDir, 'language.csv'));
  await seedTable(pool, 'language', langData, ['id', 'symbol', 'name', 'foreignName', 'enable']);

  // PriceRule (must be before Fiat and Asset due to FK constraints)
  const priceRuleData = parseCSV(path.join(seedDir, 'price_rule.csv'));
  await seedTable(pool, 'price_rule', priceRuleData, ['id', 'priceSource', 'priceAsset', 'priceReference', 'check1Source', 'check1Asset', 'check1Reference', 'check1Limit', 'check2Source', 'check2Asset', 'check2Reference', 'check2Limit', 'currentPrice', 'priceValiditySeconds', 'assetDisplayName', 'referenceDisplayName']);

  // Fiat
  const fiatData = parseCSV(path.join(seedDir, 'fiat.csv'));
  await seedTable(pool, 'fiat', fiatData, ['id', 'name', 'buyable', 'sellable', 'cardBuyable', 'cardSellable', 'instantBuyable', 'instantSellable', 'approxPriceChf', 'priceRuleId']);

  // Country
  const countryData = parseCSV(path.join(seedDir, 'country.csv'));
  await seedTable(pool, 'country', countryData, ['id', 'symbol', 'name', 'dfxEnable', 'ipEnable', 'maerkiBaumannEnable', 'lockEnable', 'symbol3']);

  // Asset - drop unique index that conflicts with NULL dexName values
  try {
    await pool.request().query('DROP INDEX IF EXISTS IDX_83f52471fd746482b83b20f51b ON asset');
  } catch (e) { /* Index may not exist */ }
  const assetData = parseCSV(path.join(seedDir, 'asset.csv'));
  await seedTable(pool, 'asset', assetData, [
    'id', 'name', 'type', 'buyable', 'sellable', 'chainId', 'sellCommand', 'dexName',
    'category', 'blockchain', 'uniqueName', 'description', 'comingSoon', 'sortOrder',
    'approxPriceUsd', 'ikna', 'priceRuleId', 'approxPriceChf', 'cardBuyable', 'cardSellable',
    'instantBuyable', 'instantSellable', 'financialType', 'decimals', 'paymentEnabled',
    'amlRuleFrom', 'amlRuleTo', 'approxPriceEur', 'refundEnabled'
  ]);

  // IpLog (required for auth to work - needs at least one entry with old created date)
  const oldDate = new Date();
  oldDate.setFullYear(oldDate.getFullYear() - 1);

  const ipLogCount = await pool.request().query('SELECT COUNT(*) as count FROM ip_log');
  if (ipLogCount.recordset[0].count === 0) {
    console.log('  ip_log: inserting 1 rows...');
    await pool.request()
      .input('address', mssql.NVarChar, '0x0000000000000000000000000000000000000000')
      .input('ip', mssql.NVarChar, '127.0.0.1')
      .input('country', mssql.NVarChar, 'CH')
      .input('url', mssql.NVarChar, '/v1/auth')
      .input('result', mssql.Bit, 1)
      .input('created', mssql.DateTime2, oldDate)
      .input('updated', mssql.DateTime2, oldDate)
      .query('INSERT INTO ip_log (address, ip, country, url, result, created, updated) VALUES (@address, @ip, @country, @url, @result, @created, @updated)');
  } else {
    console.log(`  ip_log: already has ${ipLogCount.recordset[0].count} rows, fixing oldest entry date...`);
    // Ensure at least one entry has an old date (required for IpLogService.updateUserIpLogs)
    await pool.request()
      .input('oldDate', mssql.DateTime2, oldDate)
      .query('UPDATE ip_log SET created = @oldDate, updated = @oldDate WHERE id = (SELECT MIN(id) FROM ip_log)');
  }

  // Fee (required for transaction fees)
  const feeData = parseCSV(path.join(seedDir, 'fee.csv'));
  await seedTable(pool, 'fee', feeData, ['id', 'label', 'type', 'rate', 'accountType', 'active', 'fixed', 'payoutRefBonus', 'blockchainFactor', 'paymentMethodsIn', 'paymentMethodsOut']);

  // Bank (required for payment processing)
  const bankData = parseCSV(path.join(seedDir, 'bank.csv'));
  await seedTable(pool, 'bank', bankData, ['id', 'name', 'iban', 'bic', 'currency', 'receive', 'send', 'sctInst', 'amlEnabled']);

  // Fix fiat priceRuleId links (always run to ensure consistency)
  console.log('  Fixing fiat price rule links...');
  const fiatRuleMapping = { CHF: 2, EUR: 39, USD: 1, AED: 45 };
  for (const [fiatName, ruleId] of Object.entries(fiatRuleMapping)) {
    await pool.request()
      .input('ruleId', mssql.Int, ruleId)
      .input('name', mssql.NVarChar, fiatName)
      .query('UPDATE fiat SET priceRuleId = @ruleId WHERE name = @name AND (priceRuleId IS NULL OR priceRuleId != @ruleId)');
  }

  // Note: Deposit addresses are NOT seeded here.
  // They must be created via the API (/deposit endpoint) to ensure Alchemy webhook registration.
  // Run 'npm run setup' after API starts to create deposits properly.

  await pool.close();
  console.log('Seed complete!');
}

main().catch(e => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
