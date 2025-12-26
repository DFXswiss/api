const fs = require('fs');
const path = require('path');
const mssql = require('mssql');

const config = {
  user: process.env.SQL_USERNAME || 'sa',
  password: process.env.SQL_PASSWORD || 'LocalDev123!',
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

  // Fiat
  const fiatData = parseCSV(path.join(seedDir, 'fiat.csv'));
  await seedTable(pool, 'fiat', fiatData, ['id', 'name', 'buyable', 'sellable', 'cardBuyable', 'cardSellable', 'instantBuyable', 'instantSellable', 'approxPriceChf']);

  // Country
  const countryData = parseCSV(path.join(seedDir, 'country.csv'));
  await seedTable(pool, 'country', countryData, ['id', 'symbol', 'name', 'dfxEnable', 'ipEnable', 'maerkiBaumannEnable', 'lockEnable', 'symbol3']);

  // Asset
  const assetData = parseCSV(path.join(seedDir, 'asset.csv'));
  await seedTable(pool, 'asset', assetData, ['id', 'name', 'type', 'blockchain', 'buyable', 'sellable', 'uniqueName', 'category', 'cardBuyable', 'cardSellable', 'instantBuyable', 'instantSellable', 'approxPriceChf']);

  // IpLog (required for auth to work)
  const ipLogData = parseCSV(path.join(seedDir, 'ip_log.csv'));
  await seedTable(pool, 'ip_log', ipLogData, ['id', 'address', 'ip', 'country', 'url', 'result']);

  // PriceRule (required for pricing) - referenceId excluded as it references assets not in seed data
  const priceRuleData = parseCSV(path.join(seedDir, 'price_rule.csv'));
  await seedTable(pool, 'price_rule', priceRuleData, ['id', 'priceSource', 'priceAsset', 'priceReference', 'check1Source', 'check1Asset', 'check1Reference', 'check1Limit', 'check2Source', 'check2Asset', 'check2Reference', 'check2Limit', 'currentPrice', 'priceValiditySeconds', 'assetDisplayName', 'referenceDisplayName']);

  await pool.close();
  console.log('Seed complete!');
}

main().catch(e => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
