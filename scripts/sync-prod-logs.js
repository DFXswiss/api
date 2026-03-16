#!/usr/bin/env node
// Syncs log entries from production API to local MSSQL database.
// Usage: node scripts/sync-prod-logs.js [--since DATE] [--batch-size N]

const sql = require('mssql');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Config ---
const SINCE = process.argv.find((a, i) => process.argv[i - 1] === '--since') || '2026-03-01';
const BATCH_SIZE = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--batch-size') || '100');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
const envVars = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) envVars[match[1]] = match[2];
});

const API_URL = envVars.DEBUG_API_URL || 'https://api.dfx.swiss/v1';
const DEBUG_ADDRESS = envVars.DEBUG_ADDRESS;
const DEBUG_SIGNATURE = envVars.DEBUG_SIGNATURE;

const LOCAL_DB = {
  server: envVars.SQL_HOST || 'localhost',
  port: parseInt(envVars.SQL_PORT || '1433'),
  user: envVars.SQL_USERNAME || 'sa',
  password: envVars.SQL_PASSWORD || 'LocalDev2026@SQL',
  database: envVars.SQL_DB || 'dfx',
  options: { encrypt: false, trustServerCertificate: true },
};

// --- HTTP helper ---
function apiRequest(urlPath, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, API_URL.endsWith('/') ? API_URL : API_URL + '/');
    const lib = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (apiRequest.token) {
      options.headers['Authorization'] = `Bearer ${apiRequest.token}`;
    }
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function authenticate() {
  console.log(`Authenticating to ${API_URL}...`);
  const res = await apiRequest('auth', 'POST', {
    address: DEBUG_ADDRESS,
    signature: DEBUG_SIGNATURE,
  });
  if (!res.accessToken) throw new Error('Auth failed: ' + JSON.stringify(res));
  apiRequest.token = res.accessToken;
  console.log('Authenticated.');
}

async function execSql(query) {
  return apiRequest('gs/debug', 'POST', { sql: query });
}

async function main() {
  // Authenticate
  await authenticate();

  // Get total count
  const countResult = await execSql(`SELECT COUNT(*) as cnt FROM log WHERE created >= '${SINCE}'`);
  const total = countResult[0].cnt;
  console.log(`Total log entries since ${SINCE}: ${total}`);

  // Connect to local DB
  console.log('Connecting to local DB...');
  const pool = await sql.connect(LOCAL_DB);

  // Check if identity insert needed
  const localCount = await pool.request().query('SELECT COUNT(*) as cnt FROM log');
  console.log(`Local log entries before sync: ${localCount.recordset[0].cnt}`);

  // Enable identity insert
  await pool.request().query('SET IDENTITY_INSERT log ON');

  let lastId = 0;
  let inserted = 0;
  let errors = 0;
  let batchNum = 0;
  const totalBatches = Math.ceil(total / BATCH_SIZE);

  console.log(`Fetching in batches of ${BATCH_SIZE} (using id cursor)...`);

  while (true) {
    batchNum++;
    const query = `SELECT TOP ${BATCH_SIZE} id, updated, created, system, subsystem, severity, message, category, valid FROM log WHERE created >= '${SINCE}' AND id > ${lastId} ORDER BY id ASC`;

    process.stdout.write(`\r  Batch ${batchNum}/${totalBatches} (inserted: ${inserted}/${total}, lastId: ${lastId})...`);

    let rows;
    let retries = 3;
    while (retries > 0) {
      try {
        rows = await execSql(query);
        break;
      } catch (e) {
        retries--;
        if (retries > 0) {
          process.stdout.write(`\n  Retry (${3 - retries}/3) after error: ${e.message}\n`);
          // Re-authenticate in case token expired
          try { await authenticate(); } catch {}
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.error(`\n  Failed batch ${batchNum} after 3 retries (lastId=${lastId}): ${e.message}`);
          errors++;
          rows = null;
        }
      }
    }
    if (!rows) {
      // Skip this batch range and try next
      lastId += 100;
      continue;
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    // Insert batch
    for (const row of rows) {
      try {
        const req = pool.request();
        req.input('id', sql.Int, row.id);
        req.input('updated', sql.DateTime2, row.updated);
        req.input('created', sql.DateTime2, row.created);
        req.input('system', sql.NVarChar(256), row.system);
        req.input('subsystem', sql.NVarChar(256), row.subsystem);
        req.input('severity', sql.NVarChar(256), row.severity);
        req.input('message', sql.NVarChar(sql.MAX), typeof row.message === 'string' ? row.message : JSON.stringify(row.message));
        req.input('category', sql.NVarChar(256), row.category || null);
        req.input('valid', sql.Bit, row.valid != null ? row.valid : null);

        await req.query(`
          SET IDENTITY_INSERT log ON;
          INSERT INTO log (id, updated, created, system, subsystem, severity, message, category, valid)
          VALUES (@id, @updated, @created, @system, @subsystem, @severity, @message, @category, @valid)
        `);
        inserted++;
      } catch (e) {
        if (e.message.includes('duplicate key') || e.message.includes('UNIQUE')) {
          // Skip duplicates
        } else {
          if (errors < 5) console.error(`\n  Insert error (id=${row.id}): ${e.message}`);
          errors++;
        }
      }
    }

    lastId = rows[rows.length - 1].id;
  }

  console.log(`\n\nDone!`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total in prod: ${total}`);

  // Verify
  const finalCount = await pool.request().query('SELECT COUNT(*) as cnt FROM log');
  console.log(`  Local log entries after sync: ${finalCount.recordset[0].cnt}`);

  await pool.close();
}

main().catch(e => { console.error(e); process.exit(1); });
