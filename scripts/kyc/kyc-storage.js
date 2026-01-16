/**
 * This script shows KYC files stored in the database.
 * In local development mode, KYC files are loaded from scripts/kyc/dummy-files/.
 *
 * Usage: node scripts/kyc/kyc-storage.js
 */

const mssql = require('mssql');

const dbConfig = {
  user: process.env.SQL_USERNAME || 'sa',
  password: process.env.SQL_PASSWORD || 'LocalDev2026@SQL',
  server: 'localhost',
  port: parseInt(process.env.SQL_PORT) || 1433,
  database: process.env.SQL_DB || 'dfx',
  options: { encrypt: false, trustServerCertificate: true }
};

async function main() {
  console.log('KYC Storage Seeder');
  console.log('==================\n');

  console.log('Note: In local development mode, KYC files are stored in-memory.');
  console.log('They need to be uploaded via the KYC flow or manually inserted.\n');

  // Get KYC file info from database
  const pool = await mssql.connect(dbConfig);

  const files = await pool.request().query(`
    SELECT kf.id, kf.uid, kf.name, kf.type, kf.userDataId, ud.mail
    FROM kyc_file kf
    JOIN user_data ud ON kf.userDataId = ud.id
    ORDER BY kf.id
  `);

  console.log('KYC Files in database:');
  console.log('======================');

  for (const file of files.recordset) {
    const ext = file.name.split('.').pop().toLowerCase();
    const contentType = ext === 'pdf' ? 'application/pdf' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';

    console.log(`  ${file.name}`);
    console.log(`    UID: ${file.uid}`);
    console.log(`    Type: ${file.type}`);
    console.log(`    User: ${file.mail}`);
    console.log(`    Content-Type: ${contentType}`);
    console.log('');
  }

  console.log('\n========================================');
  console.log('Note:');
  console.log('========================================');
  console.log('');
  console.log('In local development mode, KYC files are automatically');
  console.log('loaded from scripts/kyc/dummy-files/ by the azure-storage');
  console.log('service when the requested file is not in memory storage.');
  console.log('');

  await pool.close();
}

main().catch(console.error);
