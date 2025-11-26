/**
 * Scrypt API Test Script
 *
 * Tests all Scrypt API calls:
 * 1. getTotalBalances() - Fetch all balances
 * 2. getAvailableBalance(currency) - Fetch available balance for specific currency
 * 3. withdrawFunds(currency, amount, address, memo?) - Initiate withdrawal
 * 4. getWithdrawalStatus(clReqId) - Check withdrawal status
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/integration/exchange/services/__tests__/scrypt-api-test.ts
 *
 * Required environment variables:
 *   SCRYPT_WS_URL - WebSocket URL (default: wss://otc.scrypt.swiss/ws/v1)
 *   SCRYPT_API_KEY - API Key
 *   SCRYPT_API_SECRET - API Secret
 *
 * Optional (for withdrawal tests):
 *   SCRYPT_WITHDRAW_ADDRESS_USDT_SOL
 *   SCRYPT_WITHDRAW_ADDRESS_USDT_ETH
 *   SCRYPT_WITHDRAW_ADDRESS_BTC
 */

import { createHmac, randomUUID } from 'crypto';
import WebSocket from 'ws';

// --- Configuration ---
const config = {
  wsUrl: process.env.SCRYPT_WS_URL ?? 'wss://otc.scrypt.swiss/ws/v1',
  apiKey: process.env.SCRYPT_API_KEY ?? '',
  apiSecret: process.env.SCRYPT_API_SECRET ?? '',
};

// --- Interfaces ---
interface ScryptBalance {
  Currency: string;
  Amount: string;
  AvailableAmount: string;
  Equivalent?: {
    Currency: string;
    Amount: string;
    AvailableAmount: string;
  };
}

interface ScryptBalanceTransaction {
  TransactionID: string;
  ClReqID?: string;
  Currency: string;
  TransactionType: string;
  Status: string;
  Amount: string;
  Fee?: string;
  Created?: string;
  Updated?: string;
}

interface ScryptMessage {
  reqid?: number;
  type: string;
  ts?: string;
  data?: ScryptBalance[] | ScryptBalanceTransaction[];
  initial?: boolean;
  seqNum?: number;
  error?: string;
}

// --- Helper Functions ---
function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data !== undefined) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function logError(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ ${message}`);
  if (error) {
    console.error(error);
  }
}

function logSuccess(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ✅ ${message}`);
}

function logSection(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

// --- WebSocket Request Function ---
async function sendWebSocketRequest<T>(
  request: Record<string, unknown>,
  responseCondition: (message: ScryptMessage) => boolean,
  timeoutMs = 30000,
): Promise<ScryptMessage> {
  if (!config.apiKey || !config.apiSecret) {
    throw new Error('Scrypt API credentials not configured. Set SCRYPT_API_KEY and SCRYPT_API_SECRET.');
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Scrypt WebSocket timeout'));
    }, timeoutMs);

    const url = new URL(config.wsUrl);
    const host = url.host;
    const path = url.pathname;

    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000000Z');
    const signaturePayload = ['GET', timestamp, host, path].join('\n');
    const hmac = createHmac('sha256', config.apiSecret);
    hmac.update(signaturePayload);
    const signature = hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_');

    const headers = {
      ApiKey: config.apiKey,
      ApiSign: signature,
      ApiTimestamp: timestamp,
    };

    log(`Connecting to WebSocket: ${config.wsUrl}`);
    const ws = new WebSocket(config.wsUrl, { headers });

    ws.on('open', () => {
      log(`WebSocket connected, sending request: ${request.type}`);
      ws.send(JSON.stringify(request));
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message: ScryptMessage = JSON.parse(data.toString());
        log(`Message received: ${message.type}`, message);

        if (message.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          const errorMsg = typeof message.error === 'object'
            ? JSON.stringify(message.error)
            : message.error;
          reject(new Error(`Scrypt error: ${errorMsg}`));
          return;
        }

        if (responseCondition(message)) {
          clearTimeout(timeout);
          ws.close();
          resolve(message);
        }
      } catch (e) {
        logError('Failed to parse message', e);
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      logError('WebSocket error', error);
      reject(error);
    });

    ws.on('close', () => {
      log('WebSocket closed');
    });
  });
}

// --- API Test Functions ---

async function testGetTotalBalances(): Promise<Record<string, number>> {
  logSection('TEST: getTotalBalances()');

  const subscribeMessage = {
    reqid: Date.now(),
    type: 'subscribe',
    streams: [{ name: 'Balance' }],
  };

  const response = await sendWebSocketRequest<ScryptBalance[]>(
    subscribeMessage,
    (message) => message.type === 'Balance' && message.initial === true,
  );

  const balances = (response.data as ScryptBalance[]) ?? [];
  const totalBalances: Record<string, number> = {};

  for (const balance of balances) {
    totalBalances[balance.Currency] = parseFloat(balance.Amount) || 0;
  }

  logSuccess('getTotalBalances() completed');
  log('Total Balances:', totalBalances);

  return totalBalances;
}

async function testGetAvailableBalance(currency: string): Promise<number> {
  logSection(`TEST: getAvailableBalance('${currency}')`);

  const subscribeMessage = {
    reqid: Date.now(),
    type: 'subscribe',
    streams: [{ name: 'Balance', Currencies: [currency] }],
  };

  const response = await sendWebSocketRequest<ScryptBalance[]>(
    subscribeMessage,
    (message) => message.type === 'Balance' && message.initial === true,
  );

  const balances = (response.data as ScryptBalance[]) ?? [];
  const balance = balances.find((b) => b.Currency === currency);
  const availableAmount = balance ? parseFloat(balance.AvailableAmount) || 0 : 0;

  logSuccess(`getAvailableBalance('${currency}') completed`);
  log(`Available ${currency}:`, availableAmount);

  return availableAmount;
}

async function testFetchBalanceTransactions(): Promise<ScryptBalanceTransaction[]> {
  logSection('TEST: fetchBalanceTransactions()');

  const subscribeMessage = {
    reqid: Date.now(),
    type: 'subscribe',
    streams: [{ name: 'BalanceTransaction' }],
  };

  const response = await sendWebSocketRequest<ScryptBalanceTransaction[]>(
    subscribeMessage,
    (message) => message.type === 'BalanceTransaction' && message.initial === true,
  );

  const transactions = (response.data as ScryptBalanceTransaction[]) ?? [];

  logSuccess('fetchBalanceTransactions() completed');
  log(`Found ${transactions.length} transactions`);

  // Show last 5 transactions
  if (transactions.length > 0) {
    log('Last 5 transactions:', transactions.slice(-5));
  }

  return transactions;
}

async function testGetWithdrawalStatus(clReqId: string): Promise<ScryptBalanceTransaction | null> {
  logSection(`TEST: getWithdrawalStatus('${clReqId}')`);

  const transactions = await testFetchBalanceTransactions();
  const withdrawal = transactions.find((t) => t.ClReqID === clReqId && t.TransactionType === 'Withdrawal');

  if (withdrawal) {
    logSuccess(`Found withdrawal with clReqId: ${clReqId}`);
    log('Withdrawal details:', withdrawal);
  } else {
    log(`No withdrawal found for clReqId: ${clReqId}`);
  }

  return withdrawal ?? null;
}

interface WithdrawResult {
  id: string;
  status: string;
  transactionId?: string;
}

// Special WebSocket handler for withdrawal that subscribes and sends request
async function sendWithdrawRequest(
  withdrawRequest: Record<string, unknown>,
  clReqId: string,
): Promise<{ status: string; transactionId?: string }> {
  if (!config.apiKey || !config.apiSecret) {
    throw new Error('Scrypt API credentials not configured.');
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Scrypt WebSocket timeout'));
    }, 60000); // 60s timeout for withdrawal

    const url = new URL(config.wsUrl);
    const host = url.host;
    const path = url.pathname;

    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000000Z');
    const signaturePayload = ['GET', timestamp, host, path].join('\n');
    const hmac = createHmac('sha256', config.apiSecret);
    hmac.update(signaturePayload);
    const signature = hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_');

    const headers = {
      ApiKey: config.apiKey,
      ApiSign: signature,
      ApiTimestamp: timestamp,
    };

    log(`Connecting to WebSocket for withdrawal: ${config.wsUrl}`);
    const ws = new WebSocket(config.wsUrl, { headers });

    let subscribed = false;

    ws.on('open', () => {
      log('WebSocket connected, subscribing to BalanceTransaction stream...');
      // First subscribe to BalanceTransaction to receive updates
      const subscribeMessage = {
        reqid: Date.now(),
        type: 'subscribe',
        streams: [{ name: 'BalanceTransaction' }],
      };
      ws.send(JSON.stringify(subscribeMessage));
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        log(`Message received: ${message.type}`, message);

        if (message.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          const errorMsg = typeof message.error === 'object'
            ? JSON.stringify(message.error)
            : message.error;
          reject(new Error(`Scrypt error: ${errorMsg}`));
          return;
        }

        // After initial subscription, send the withdraw request
        if (message.type === 'BalanceTransaction' && message.initial === true && !subscribed) {
          subscribed = true;
          log('Subscribed to BalanceTransaction, sending withdrawal request...');
          ws.send(JSON.stringify(withdrawRequest));
          return;
        }

        // Look for our withdrawal in BalanceTransaction updates
        if (message.type === 'BalanceTransaction' && message.data) {
          const transactions = message.data as ScryptBalanceTransaction[];
          const ourWithdrawal = transactions.find(
            (t) => t.ClReqID === clReqId && t.TransactionType === 'Withdrawal',
          );

          if (ourWithdrawal) {
            log('Found our withdrawal transaction:', ourWithdrawal);
            clearTimeout(timeout);
            ws.close();
            resolve({
              status: ourWithdrawal.Status,
              transactionId: ourWithdrawal.TransactionID,
            });
          }
        }
      } catch (e) {
        logError('Failed to parse message', e);
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      logError('WebSocket error', error);
      reject(error);
    });

    ws.on('close', () => {
      log('WebSocket closed');
    });
  });
}

async function testWithdrawFunds(
  currency: string,
  amount: number,
  address: string,
  memo?: string,
): Promise<WithdrawResult> {
  logSection(`TEST: withdrawFunds('${currency}', ${amount}, '${address.slice(0, 10)}...')`);

  // Generate UUID-like ClReqID as per API docs
  const clReqId = randomUUID();

  // Build request exactly like the API docs example
  const withdrawRequest = {
    reqid: Date.now(),
    type: 'NewWithdrawRequest',
    data: [
      {
        Quantity: amount.toString(),
        Currency: currency,
        MarketAccount: 'default',
        RoutingInfo: {
          WalletAddress: address,
          Memo: memo ?? '',
          DestinationTag: '',
        },
        ClReqID: clReqId,
      },
    ],
  };

  log('Withdrawal request:', withdrawRequest);

  // Send withdrawal request and wait for BalanceTransaction update
  const response = await sendWithdrawRequest(withdrawRequest, clReqId);

  const result = {
    id: clReqId,
    status: response.status,
    transactionId: response.transactionId,
  };

  logSuccess('withdrawFunds() completed');
  log('Withdrawal initiated:', result);

  return result;
}

// --- Interactive Test Menu ---

async function runInteractiveTests(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Run all read-only tests
    logSection('RUNNING ALL READ-ONLY TESTS');

    try {
      await testGetTotalBalances();
    } catch (e) {
      logError('getTotalBalances() failed', e);
    }

    try {
      await testGetAvailableBalance('BTC');
    } catch (e) {
      logError('getAvailableBalance() failed', e);
    }

    try {
      await testGetAvailableBalance('USDT');
    } catch (e) {
      logError('getAvailableBalance() failed', e);
    }

    try {
      await testFetchBalanceTransactions();
    } catch (e) {
      logError('fetchBalanceTransactions() failed', e);
    }

    logSection('ALL READ-ONLY TESTS COMPLETED');
    return;
  }

  const command = args[0];

  switch (command) {
    case 'balances':
      await testGetTotalBalances();
      break;

    case 'available':
      if (!args[1]) {
        console.log('Usage: available <currency>');
        console.log('Example: available BTC');
        return;
      }
      await testGetAvailableBalance(args[1].toUpperCase());
      break;

    case 'transactions':
      await testFetchBalanceTransactions();
      break;

    case 'withdrawal-status':
      if (!args[1]) {
        console.log('Usage: withdrawal-status <clReqId>');
        console.log('Example: withdrawal-status dfx-withdraw-1234567890-abc123');
        return;
      }
      await testGetWithdrawalStatus(args[1]);
      break;

    case 'withdraw':
      if (!args[1] || !args[2] || !args[3]) {
        console.log('Usage: withdraw <currency> <amount> <address> [memo]');
        console.log('Example: withdraw USDT 10 0x1234...abcd');
        console.log('\n⚠️  WARNING: This will initiate a REAL withdrawal!');
        return;
      }
      console.log('\n⚠️  WARNING: This will initiate a REAL withdrawal!');
      console.log(`Currency: ${args[1]}`);
      console.log(`Amount: ${args[2]}`);
      console.log(`Address: ${args[3]}`);
      console.log(`Memo: ${args[4] || '(none)'}`);
      console.log('\nProceeding in 5 seconds... (Ctrl+C to cancel)\n');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await testWithdrawFunds(args[1].toUpperCase(), parseFloat(args[2]), args[3], args[4]);
      break;

    case 'help':
    default:
      console.log(`
Scrypt API Test Script
======================

Usage:
  npx ts-node -r tsconfig-paths/register src/integration/exchange/services/__tests__/scrypt-api-test.ts [command] [args]

Commands:
  (no args)           Run all read-only tests (balances, transactions)
  balances            Get all total balances
  available <curr>    Get available balance for a specific currency
  transactions        Get all balance transactions
  withdrawal-status <id>  Check status of a withdrawal by clReqId
  withdraw <curr> <amt> <addr> [memo]  Initiate a withdrawal (REAL!)
  help                Show this help message

Examples:
  # Run all read-only tests
  npx ts-node -r tsconfig-paths/register src/integration/exchange/services/__tests__/scrypt-api-test.ts

  # Get all balances
  npx ts-node -r tsconfig-paths/register src/integration/exchange/services/__tests__/scrypt-api-test.ts balances

  # Get available BTC balance
  npx ts-node -r tsconfig-paths/register src/integration/exchange/services/__tests__/scrypt-api-test.ts available BTC

  # Check withdrawal status
  npx ts-node -r tsconfig-paths/register src/integration/exchange/services/__tests__/scrypt-api-test.ts withdrawal-status dfx-withdraw-123456

  # Initiate withdrawal (BE CAREFUL!)
  npx ts-node -r tsconfig-paths/register src/integration/exchange/services/__tests__/scrypt-api-test.ts withdraw USDT 10 0x1234...

Environment Variables Required:
  SCRYPT_API_KEY      - Your Scrypt API key
  SCRYPT_API_SECRET   - Your Scrypt API secret
  SCRYPT_WS_URL       - WebSocket URL (optional, defaults to wss://otc.scrypt.swiss/ws/v1)
`);
  }
}

// --- Main ---
runInteractiveTests()
  .then(() => {
    console.log('\n✅ Test script finished');
    process.exit(0);
  })
  .catch((error) => {
    logError('Test script failed', error);
    process.exit(1);
  });
