#!/usr/bin/env node

/**
 * DFX API Local Development Setup
 *
 * This script handles the complete local setup:
 * 1. Generates a random admin seed (mnemonic)
 * 2. Prompts for Alchemy API key (optional for full webhook support)
 * 3. Updates .env with generated values
 * 4. Waits for API to be ready
 * 5. Registers admin user via /auth endpoint
 * 6. Sets admin role in database
 * 7. Creates deposit addresses via /deposit endpoint (registers with Alchemy)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
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

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptWithDefault(question, defaultValue) {
  const answer = await prompt(`${question} [${defaultValue}]: `);
  return answer || defaultValue;
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

async function createDeposits(accessToken, blockchain, count) {
  const response = await fetch(`${API_URL}/v1/deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ blockchain, count }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create deposits: ${response.status} - ${error}`);
  }
}

async function main() {
  log('\n========================================', colors.bright);
  log('  DFX API Local Development Setup', colors.bright);
  log('========================================\n', colors.bright);

  // Step 1: Generate ALL wallet seeds
  logStep('1/6', 'Generating Wallet Seeds');

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

  // Step 2: Alchemy API Key
  logStep('2/6', 'Alchemy Configuration');

  let alchemyKey = readEnvValue('ALCHEMY_AUTH_TOKEN');

  if (!alchemyKey) {
    log('');
    log('  Alchemy is required for automatic deposit address monitoring.', colors.yellow);
    log('  You can create a free Alchemy Auth Token at: https://dashboard.alchemy.com/', colors.yellow);
    log('  (Press Enter to skip - deposits will work but webhooks won\'t)', colors.yellow);
    log('');

    alchemyKey = await prompt('  Enter Alchemy Auth Token: ');

    if (alchemyKey) {
      updateEnvFile({ 'ALCHEMY_AUTH_TOKEN': alchemyKey });
      logSuccess('Alchemy Auth Token saved to .env');
    } else {
      logInfo('Skipping Alchemy configuration (manual sync will be needed)');
    }
  } else {
    logSuccess('Alchemy Auth Token already configured');
  }

  // Step 3: Start API
  logStep('3/6', 'Starting API');

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

  // Step 5: Register Admin User
  logStep('4/6', 'Registering Admin User');

  try {
    const signMessage = await getSignMessage(adminWallet.address);
    logSuccess('Got sign message from API');

    // Sign the message
    const wallet = new ethers.Wallet(adminWallet.privateKey);
    const signature = await wallet.signMessage(signMessage);
    logSuccess('Message signed');

    // Register user
    const authResponse = await registerUser(adminWallet.address, signature);
    logSuccess(`User registered (ID: ${authResponse.accessToken ? 'received JWT' : 'no token'})`);

    // Store access token for deposit creation
    var accessToken = authResponse.accessToken;
  } catch (error) {
    logError(`Failed to register admin: ${error.message}`);
    process.exit(1);
  }

  // Step 6: Set Admin Role
  logStep('5/6', 'Setting Admin Role');

  try {
    const user = await setAdminRole(adminWallet.address);
    logSuccess(`User ${user.id} role set to: ${user.role}`);
  } catch (error) {
    logError(`Failed to set admin role: ${error.message}`);
    process.exit(1);
  }

  // Need to re-authenticate to get admin token
  try {
    const signMessage = await getSignMessage(adminWallet.address);
    const wallet = new ethers.Wallet(adminWallet.privateKey);
    const signature = await wallet.signMessage(signMessage);
    const authResponse = await registerUser(adminWallet.address, signature);
    accessToken = authResponse.accessToken;
    logSuccess('Re-authenticated with admin role');
  } catch (error) {
    logError(`Failed to re-authenticate: ${error.message}`);
    process.exit(1);
  }

  // Step 7: Create Deposit Addresses
  logStep('6/6', 'Creating Deposit Addresses');

  const depositCount = parseInt(await promptWithDefault('  How many deposit addresses to create?', '5'));

  if (depositCount > 0) {
    try {
      logInfo('Creating EVM deposit addresses (Ethereum + all EVM chains)...');
      await createDeposits(accessToken, 'Ethereum', depositCount);
      logSuccess(`Created ${depositCount} EVM deposit addresses`);

      if (alchemyKey) {
        logSuccess('Deposit addresses registered with Alchemy webhooks');
      } else {
        logInfo('Note: Webhooks not configured (Alchemy key missing)');
      }
    } catch (error) {
      logError(`Failed to create deposits: ${error.message}`);
      logInfo('You can create deposits later via the API');
    }
  } else {
    logInfo('Skipping deposit address creation');
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
