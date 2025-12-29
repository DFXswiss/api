#!/usr/bin/env node

/**
 * DFX API Local Development Setup
 *
 * This script handles the complete local setup:
 * 1. Generates all wallet seeds (19 seeds/keys)
 * 2. Starts API in background
 * 3. Registers admin user via /auth endpoint
 * 4. Sets admin role in database
 * 5. Seeds deposit addresses directly in database
 *
 * Note: Alchemy webhooks are not used in local development (localhost is not reachable).
 * Deposit addresses are seeded directly into the database instead.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ethers } = require('ethers');
const mssql = require('mssql');

// ============================================================================
// SAFETY CHECKS - Prevent accidental execution against production
// ============================================================================

const allowedEnvironments = ['loc', 'local', undefined, ''];
const currentEnv = process.env.ENVIRONMENT;

if (!allowedEnvironments.includes(currentEnv)) {
  console.error('❌ SAFETY BLOCK: Setup is only allowed in local environment!');
  console.error(`   Current ENVIRONMENT: ${currentEnv}`);
  console.error('   Allowed: loc, local, or unset');
  process.exit(1);
}

const dbHost = process.env.SQL_HOST || 'localhost';
const allowedHostPatterns = [
  'localhost',
  '127.0.0.1',
  /^sql-dfx-api-loc/i,
  /loc.*\.database\.windows\.net/i,
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

// ============================================================================

const ENV_FILE = path.join(__dirname, '..', '.env');
const ENV_EXAMPLE = path.join(__dirname, '..', '.env.local.example');
const API_URL = 'http://localhost:3000';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n[${step}] ${message}`, colors.cyan);
}

function logSuccess(message) {
  log(`  ✓ ${message}`, colors.green);
}

function logError(message) {
  log(`  ✗ ${message}`, colors.red);
}

function logInfo(message) {
  log(`  ${message}`, colors.yellow);
}


function generateMnemonic() {
  const wallet = ethers.Wallet.createRandom();
  return wallet.mnemonic.phrase;
}

function getAddressFromMnemonic(mnemonic, index = 0) {
  const hdPath = `m/44'/60'/0'/0/${index}`;
  const wallet = ethers.Wallet.fromMnemonic(mnemonic, hdPath);
  return { address: wallet.address, privateKey: wallet.privateKey };
}

function updateEnvFile(updates) {
  let content = '';

  // Read existing content or template
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, 'utf8');
  } else if (fs.existsSync(ENV_EXAMPLE)) {
    content = fs.readFileSync(ENV_EXAMPLE, 'utf8');
  }

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const newLine = `${key}=${value}`;

    if (regex.test(content)) {
      content = content.replace(regex, newLine);
    } else {
      content += `\n${newLine}`;
    }
  }

  fs.writeFileSync(ENV_FILE, content);
}

function readEnvValue(key) {
  if (!fs.existsSync(ENV_FILE)) return null;
  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1] : null;
}

async function waitForApi(maxRetries = 60, delayMs = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${API_URL}/v1/auth/signMessage?address=0x0000000000000000000000000000000000000000`);
      if (response.ok) return true;
    } catch (e) {
      // API not ready yet
    }

    if (i < maxRetries - 1) {
      process.stdout.write(`\r  Waiting for API... (${i + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.log('');
  return false;
}

/**
 * Wait for critical database tables to be created by TypeORM synchronization
 * and for the seed to complete. This prevents race conditions where we try
 * to register a user before tables exist.
 */
async function waitForDatabaseReady(maxRetries = 60, delayMs = 2000) {
  const config = {
    user: process.env.SQL_USERNAME || 'sa',
    password: process.env.SQL_PASSWORD || 'LocalDev123!',
    server: process.env.SQL_HOST || 'localhost',
    port: parseInt(process.env.SQL_PORT) || 1433,
    database: process.env.SQL_DB || 'dfx',
    options: {
      encrypt: process.env.SQL_ENCRYPT === 'true',
      trustServerCertificate: true,
    },
  };

  // Critical tables that must exist for auth to work
  const requiredTables = ['user', 'user_data', 'wallet', 'ip_log', 'language', 'country', 'fiat', 'asset'];

  let pool;
  try {
    pool = await mssql.connect(config);
  } catch (e) {
    logError(`Could not connect to database: ${e.message}`);
    return false;
  }

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Check if all required tables exist
      const tableCheck = await pool.request().query(`
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME IN (${requiredTables.map(t => `'${t}'`).join(',')})
      `);

      const existingTables = tableCheck.recordset.map(r => r.TABLE_NAME);
      const missingTables = requiredTables.filter(t => !existingTables.includes(t));

      if (missingTables.length === 0) {
        // All tables exist, now check if seed data is present
        const seedCheck = await pool.request().query(`
          SELECT
            (SELECT COUNT(*) FROM wallet) as wallets,
            (SELECT COUNT(*) FROM language) as languages,
            (SELECT COUNT(*) FROM ip_log) as ipLogs
        `);

        const { wallets, languages, ipLogs } = seedCheck.recordset[0];

        if (wallets > 0 && languages > 0 && ipLogs > 0) {
          await pool.close();
          return true;
        }

        process.stdout.write(`\r  Waiting for seed data... (${i + 1}/${maxRetries}) [wallet:${wallets}, language:${languages}, ip_log:${ipLogs}]`);
      } else {
        process.stdout.write(`\r  Waiting for tables... (${i + 1}/${maxRetries}) [missing: ${missingTables.slice(0, 3).join(', ')}${missingTables.length > 3 ? '...' : ''}]`);
      }
    } catch (e) {
      process.stdout.write(`\r  Waiting for database... (${i + 1}/${maxRetries})`);
    }

    await new Promise(r => setTimeout(r, delayMs));
  }

  await pool.close();
  console.log('');
  return false;
}

function startApi() {
  const logFile = fs.openSync(path.join(__dirname, '..', 'api.log'), 'w');

  const apiProcess = spawn('npm', ['run', 'start:local'], {
    cwd: path.join(__dirname, '..'),
    detached: true,
    stdio: ['ignore', logFile, logFile],
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  // Unref so the parent can exit independently
  apiProcess.unref();

  // Save PID for later cleanup
  fs.writeFileSync(path.join(__dirname, '..', '.api.pid'), apiProcess.pid.toString());

  return apiProcess.pid;
}

async function getSignMessage(address) {
  const response = await fetch(`${API_URL}/v1/auth/signMessage?address=${address}`);
  if (!response.ok) {
    throw new Error(`Failed to get sign message: ${response.status}`);
  }
  const data = await response.json();
  return data.message;
}

async function registerUser(address, signature) {
  const response = await fetch(`${API_URL}/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to register user: ${response.status} - ${error}`);
  }

  return response.json();
}

async function setAdminRole(address) {
  const config = {
    user: process.env.SQL_USERNAME || 'sa',
    password: process.env.SQL_PASSWORD || 'LocalDev123!',
    server: process.env.SQL_HOST || 'localhost',
    port: parseInt(process.env.SQL_PORT) || 1433,
    database: process.env.SQL_DB || 'dfx',
    options: {
      encrypt: process.env.SQL_ENCRYPT === 'true',
      trustServerCertificate: true,
    },
  };

  const pool = await mssql.connect(config);

  // Set role to Admin
  await pool.request()
    .input('address', mssql.NVarChar, address)
    .input('role', mssql.NVarChar, 'Admin')
    .query('UPDATE [user] SET role = @role WHERE address = @address');

  // Verify
  const result = await pool.request()
    .input('address', mssql.NVarChar, address)
    .query('SELECT id, address, role FROM [user] WHERE address = @address');

  await pool.close();

  return result.recordset[0];
}

async function seedDepositAddresses(adminSeed, count) {
  const config = {
    user: process.env.SQL_USERNAME || 'sa',
    password: process.env.SQL_PASSWORD || 'LocalDev123!',
    server: process.env.SQL_HOST || 'localhost',
    port: parseInt(process.env.SQL_PORT) || 1433,
    database: process.env.SQL_DB || 'dfx',
    options: {
      encrypt: process.env.SQL_ENCRYPT === 'true',
      trustServerCertificate: true,
    },
  };

  const pool = await mssql.connect(config);

  // Generate deposit addresses from EVM_DEPOSIT_SEED
  const evmDepositSeed = readEnvValue('EVM_DEPOSIT_SEED');
  if (!evmDepositSeed) {
    throw new Error('EVM_DEPOSIT_SEED not found in .env');
  }

  // EVM blockchains that share deposit addresses (semicolon-separated)
  const evmBlockchains = [
    'Ethereum', 'Sepolia', 'BinanceSmartChain', 'Arbitrum',
    'Optimism', 'Polygon', 'Base', 'Gnosis', 'Haqq', 'CitreaTestnet'
  ];
  const blockchainsStr = evmBlockchains.join(';');

  let insertedCount = 0;

  for (let i = 0; i < count; i++) {
    const hdPath = `m/44'/60'/0'/0/${i}`;
    const wallet = ethers.Wallet.fromMnemonic(evmDepositSeed, hdPath);
    const address = wallet.address;

    try {
      const result = await pool.request()
        .input('address', mssql.NVarChar, address)
        .input('blockchains', mssql.NVarChar, blockchainsStr)
        .input('accountIndex', mssql.Int, i)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM deposit WHERE address = @address)
          INSERT INTO deposit (address, blockchains, accountIndex, created, updated)
          VALUES (@address, @blockchains, @accountIndex, GETDATE(), GETDATE())
        `);
      if (result.rowsAffected[0] > 0) {
        insertedCount++;
      }
    } catch (e) {
      // Ignore duplicates
    }
  }

  await pool.close();
  return insertedCount;
}

async function main() {
  log('\n========================================', colors.bright);
  log('  DFX API Local Development Setup', colors.bright);
  log('========================================\n', colors.bright);

  // Step 1: Generate ALL wallet seeds
  logStep('1/5', 'Generating Wallet Seeds');

  const seedsToGenerate = [
    'ADMIN_SEED',
    'EVM_DEPOSIT_SEED',
    'EVM_CUSTODY_SEED',
    'SOLANA_WALLET_SEED',
    'TRON_WALLET_SEED',
    'CARDANO_WALLET_SEED',
    'PAYMENT_EVM_SEED',
    'PAYMENT_SOLANA_SEED',
    'PAYMENT_TRON_SEED',
    'PAYMENT_CARDANO_SEED',
  ];

  const privateKeysToGenerate = [
    'ETH_WALLET_PRIVATE_KEY',
    'SEPOLIA_WALLET_PRIVATE_KEY',
    'BSC_WALLET_PRIVATE_KEY',
    'OPTIMISM_WALLET_PRIVATE_KEY',
    'BASE_WALLET_PRIVATE_KEY',
    'ARBITRUM_WALLET_PRIVATE_KEY',
    'POLYGON_WALLET_PRIVATE_KEY',
    'GNOSIS_WALLET_PRIVATE_KEY',
    'CITREA_TESTNET_WALLET_PRIVATE_KEY',
  ];

  let generatedCount = 0;

  // Generate mnemonic seeds
  for (const seedName of seedsToGenerate) {
    if (!readEnvValue(seedName)) {
      updateEnvFile({ [seedName]: generateMnemonic() });
      generatedCount++;
    }
  }

  // Generate private keys (share one key for all EVM chains)
  let sharedEvmKey = readEnvValue('ETH_WALLET_PRIVATE_KEY');
  if (!sharedEvmKey) {
    sharedEvmKey = ethers.Wallet.createRandom().privateKey;
    for (const keyName of privateKeysToGenerate) {
      updateEnvFile({ [keyName]: sharedEvmKey });
      generatedCount++;
    }
  }

  if (generatedCount > 0) {
    logSuccess(`Generated ${generatedCount} wallet seeds/keys`);
  } else {
    logSuccess('All wallet seeds already configured');
  }

  // Get admin wallet for later steps
  const adminSeed = readEnvValue('ADMIN_SEED');
  const adminWallet = getAddressFromMnemonic(adminSeed);
  logSuccess(`Admin address: ${adminWallet.address}`);

  // Step 2: Start API
  logStep('2/5', 'Starting API');

  const apiPid = startApi();
  logSuccess(`API started in background (PID: ${apiPid})`);
  logInfo('Logs: api.log');

  const apiReady = await waitForApi();
  console.log(''); // New line after progress

  if (!apiReady) {
    logError('API failed to start. Check api.log for errors.');
    process.exit(1);
  }

  logSuccess('API is ready');

  // Step 2b: Wait for database tables and seed data
  logStep('2b/5', 'Waiting for Database');

  const dbReady = await waitForDatabaseReady();
  console.log(''); // New line after progress

  if (!dbReady) {
    logError('Database not ready after timeout. Check api.log for errors.');
    process.exit(1);
  }

  logSuccess('Database tables and seed data ready');

  // Step 3: Register Admin User (with retry logic)
  logStep('3/5', 'Registering Admin User');

  const maxRegistrationRetries = 5;
  let registrationSuccess = false;

  for (let attempt = 1; attempt <= maxRegistrationRetries; attempt++) {
    try {
      const signMessage = await getSignMessage(adminWallet.address);
      if (attempt === 1) logSuccess('Got sign message from API');

      // Sign the message
      const wallet = new ethers.Wallet(adminWallet.privateKey);
      const signature = await wallet.signMessage(signMessage);
      if (attempt === 1) logSuccess('Message signed');

      // Register user
      const authResponse = await registerUser(adminWallet.address, signature);
      logSuccess(`User registered (ID: ${authResponse.accessToken ? 'received JWT' : 'no token'})`);
      registrationSuccess = true;
      break;

    } catch (error) {
      if (attempt < maxRegistrationRetries) {
        logInfo(`Attempt ${attempt}/${maxRegistrationRetries} failed: ${error.message.substring(0, 50)}...`);
        logInfo('Retrying in 3 seconds...');
        await new Promise(r => setTimeout(r, 3000));
      } else {
        logError(`Failed to register admin after ${maxRegistrationRetries} attempts: ${error.message}`);
        process.exit(1);
      }
    }
  }

  if (!registrationSuccess) {
    logError('Failed to register admin user');
    process.exit(1);
  }

  // Step 4: Set Admin Role
  logStep('4/5', 'Setting Admin Role');

  try {
    const user = await setAdminRole(adminWallet.address);
    logSuccess(`User ${user.id} role set to: ${user.role}`);
  } catch (error) {
    logError(`Failed to set admin role: ${error.message}`);
    process.exit(1);
  }

  // Step 5: Seed Deposit Addresses
  logStep('5/5', 'Seeding Deposit Addresses');

  const depositCount = 5;

  try {
    const inserted = await seedDepositAddresses(adminSeed, depositCount);
    logSuccess(`Seeded ${inserted} deposit addresses (each supporting 10 EVM blockchains)`);
  } catch (error) {
    logError(`Failed to seed deposits: ${error.message}`);
    logInfo('You can seed deposits manually later');
  }

  // Done!
  log('\n========================================', colors.green);
  log('  Setup Complete!', colors.green);
  log('========================================\n', colors.green);

  log('Your local DFX API is ready to use:\n');
  log(`  API URL:       ${API_URL}`);
  log(`  Swagger:       ${API_URL}/swagger`);
  log(`  Admin Address: ${adminWallet.address}`);
  log('');
  log('Next steps:');
  log('  - Start the services frontend: cd ../services && npm start');
  log('  - Open http://localhost:3001 in your browser');
  log('');
  log('API Management:');
  log('  - Stop API:  kill $(cat .api.pid)');
  log('  - View logs: tail -f api.log');
  log('');
}

main().catch((error) => {
  logError(`Setup failed: ${error.message}`);
  console.error(error);
  process.exit(1);
});
