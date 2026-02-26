#!/usr/bin/env node

/**
 * Migrate yearlyBalances from old format to new format
 *
 * Old format: { "2025": { "opening": 2437.57, "closing": 0 } }
 * New format: { "2024": 2437.57, "2025": 0 }
 *
 * Opening balance is now calculated as previous year's closing balance
 */

const mssql = require('mssql');
const fs = require('fs');
const path = require('path');

const mainEnvFile = path.join(__dirname, '..', '.env');
const mainEnv = {};
fs.readFileSync(mainEnvFile, 'utf-8').split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) mainEnv[match[1].trim()] = match[2].trim();
});

const config = {
  server: mainEnv.SQL_HOST || 'localhost',
  port: parseInt(mainEnv.SQL_PORT || '1433'),
  user: mainEnv.SQL_USERNAME || 'sa',
  password: mainEnv.SQL_PASSWORD,
  database: mainEnv.SQL_DB || 'dfx',
  options: { encrypt: false, trustServerCertificate: true },
};

async function migrateBalances() {
  const pool = await mssql.connect(config);

  const result = await pool.request().query('SELECT id, name, iban, yearlyBalances FROM bank WHERE yearlyBalances IS NOT NULL');

  console.log('Migrating yearlyBalances to new format...');
  console.log('Old format: {"2025": {"opening": X, "closing": Y}}');
  console.log('New format: {"2024": X, "2025": Y}  (opening = previous year closing)\n');

  for (const bank of result.recordset) {
    const oldBalances = JSON.parse(bank.yearlyBalances);
    const newBalances = {};

    for (const [year, data] of Object.entries(oldBalances)) {
      if (typeof data === 'object' && data !== null) {
        // Old format: { opening: X, closing: Y }
        const { opening, closing } = data;

        // Store closing for this year
        if (closing !== undefined) {
          newBalances[year] = closing;
        }

        // Store opening as previous year's closing
        if (opening && opening !== 0) {
          const prevYear = (parseInt(year) - 1).toString();
          newBalances[prevYear] = opening;
        }
      } else {
        // Already in new format (just a number)
        newBalances[year] = data;
      }
    }

    const newJson = JSON.stringify(newBalances);

    console.log(bank.name + ' (' + bank.iban + '):');
    console.log('  Old: ' + bank.yearlyBalances);
    console.log('  New: ' + newJson);

    await pool.request()
      .input('id', mssql.Int, bank.id)
      .input('balances', mssql.NVarChar, newJson)
      .query('UPDATE bank SET yearlyBalances = @balances WHERE id = @id');
  }

  console.log('\nMigration complete!');

  const verify = await pool.request().query('SELECT name, iban, yearlyBalances FROM bank WHERE yearlyBalances IS NOT NULL');
  console.log('\nVerification:');
  verify.recordset.forEach(b => console.log('  ' + b.name + ': ' + b.yearlyBalances));

  await pool.close();
}

migrateBalances().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
