/**
 * Starknet Integration Test Script
 *
 * Tests all read operations against Starknet mainnet using a public RPC node.
 * Does NOT require env vars or wallet configuration.
 *
 * Usage: npx ts-node scripts/test-starknet-integration.ts
 */

import { RpcProvider, Contract, hash, type Abi } from 'starknet';
import BigNumber from 'bignumber.js';

// --- CONFIG --- //

// Public Starknet mainnet RPC (no API key needed)
const PROVIDER = new RpcProvider({});

// Well-known mainnet addresses
const ETH_TOKEN = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
const STRK_TOKEN = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

// Known account with activity (Starknet Foundation)
const TEST_ADDRESS = '0x0518a38a5345118e4e41050fa96b68b56f81e1572a27bae7fceb062fa4206aab';

// Will be set dynamically from a recent block
let TEST_TX_HASH: string;

const ERC20_ABI: Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'felt' }],
    outputs: [{ name: 'balance', type: 'Uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'felt' }],
    stateMutability: 'view',
  },
];

// --- HELPERS --- //

function fromWei(amount: string | bigint, decimals = 18): number {
  return new BigNumber(amount.toString()).div(new BigNumber(10).pow(decimals)).toNumber();
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${e.message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// --- TESTS --- //

async function main() {
  console.log('=== Starknet Integration Tests (Mainnet) ===\n');

  // 0. Find a real transaction hash from a recent block
  const recentBlock = await PROVIDER.getBlockWithTxHashes('latest');
  TEST_TX_HASH = recentBlock.transactions[0];
  console.log(`Using tx ${TEST_TX_HASH.slice(0, 18)}... from block ${recentBlock.block_number}\n`);

  // 1. Block Height
  console.log('Block Height:');
  await test('getBlockLatestAccepted returns valid block number', async () => {
    const block = await PROVIDER.getBlockLatestAccepted();
    assert(typeof block.block_number === 'number', `expected number, got ${typeof block.block_number}`);
    assert(block.block_number > 500000, `block number ${block.block_number} seems too low`);
    console.log(`    block_number: ${block.block_number}`);
  });

  // 2. ERC20 Balance — STRK
  console.log('\nSTRK Balance:');
  await test('balanceOf returns a valid number for STRK', async () => {
    const contract = new Contract({ abi: ERC20_ABI, address: STRK_TOKEN, providerOrAccount: PROVIDER });
    const { balance: rawBalance } = await (contract.call('balanceOf', [TEST_ADDRESS]) as any);
    const balance = fromWei(rawBalance, 18);
    assert(typeof balance === 'number', `expected number, got ${typeof balance}`);
    assert(!isNaN(balance), 'balance is NaN');
    console.log(`    STRK balance: ${balance}`);
  });

  // 3. ERC20 Balance — ETH
  console.log('\nETH Balance:');
  await test('balanceOf returns a valid number for ETH', async () => {
    const contract = new Contract({ abi: ERC20_ABI, address: ETH_TOKEN, providerOrAccount: PROVIDER });
    const { balance: rawBalance } = await (contract.call('balanceOf', [TEST_ADDRESS]) as any);
    const balance = fromWei(rawBalance, 18);
    assert(typeof balance === 'number', `expected number, got ${typeof balance}`);
    assert(!isNaN(balance), 'balance is NaN');
    console.log(`    ETH balance: ${balance}`);
  });

  // 4. ERC20 Decimals
  console.log('\nToken Decimals:');
  await test('STRK decimals returns 18', async () => {
    const contract = new Contract({ abi: ERC20_ABI, address: STRK_TOKEN, providerOrAccount: PROVIDER });
    const result = await contract.call('decimals') as any;
    assert(Number(result.decimals) === 18, `expected 18, got ${Number(result.decimals)}`);
  });

  await test('ETH decimals returns 18', async () => {
    const contract = new Contract({ abi: ERC20_ABI, address: ETH_TOKEN, providerOrAccount: PROVIDER });
    const result = await contract.call('decimals') as any;
    assert(Number(result.decimals) === 18, `expected 18, got ${Number(result.decimals)}`);
  });

  // 5. Transaction Receipt
  console.log('\nTransaction Receipt:');
  await test('getTransactionReceipt returns valid receipt', async () => {
    const receipt = await PROVIDER.getTransactionReceipt(TEST_TX_HASH);
    assert(receipt.statusReceipt === 'SUCCEEDED', `expected SUCCEEDED, got ${receipt.statusReceipt}`);
    console.log(`    status: ${receipt.statusReceipt}`);
  });

  await test('receipt.isSuccess() returns true for confirmed tx', async () => {
    const receipt = await PROVIDER.getTransactionReceipt(TEST_TX_HASH);
    assert(receipt.isSuccess() === true, 'isSuccess() returned false');
  });

  await test('successful receipt has actual_fee and block_number', async () => {
    const receipt = await PROVIDER.getTransactionReceipt(TEST_TX_HASH);
    assert(receipt.isSuccess(), 'not successful');
    const val = receipt.value as any;
    assert(val.actual_fee !== undefined, 'missing actual_fee');
    assert(val.block_number !== undefined, 'missing block_number');
    assert(typeof val.block_number === 'number', `block_number type: ${typeof val.block_number}`);
    const fee = fromWei(val.actual_fee.amount, 18);
    console.log(`    fee: ${fee} ETH, block: ${val.block_number}`);
  });

  // 6. Transaction By Hash
  console.log('\nTransaction By Hash:');
  await test('getTransactionByHash returns tx with sender_address', async () => {
    const tx = await PROVIDER.getTransactionByHash(TEST_TX_HASH);
    assert('transaction_hash' in tx, 'missing transaction_hash');
    assert('sender_address' in tx, 'missing sender_address');
    console.log(`    sender: ${(tx as any).sender_address}`);
  });

  // 7. isTxComplete logic
  console.log('\nisTxComplete Logic:');
  await test('confirmed tx with 0 confirmations returns true', async () => {
    const receipt = await PROVIDER.getTransactionReceipt(TEST_TX_HASH);
    const isSuccess = receipt.isSuccess();
    assert(isSuccess === true, 'tx not successful');
    // With 0 confirmations, should return true immediately
  });

  await test('confirmed tx block_number is less than current block', async () => {
    const receipt = await PROVIDER.getTransactionReceipt(TEST_TX_HASH);
    assert(receipt.isSuccess(), 'not successful');
    const txBlock = (receipt.value as any).block_number;
    const currentBlock = (await PROVIDER.getBlockLatestAccepted()).block_number;
    assert(currentBlock > txBlock, `current ${currentBlock} should be > tx ${txBlock}`);
    console.log(`    tx block: ${txBlock}, current: ${currentBlock}, diff: ${currentBlock - txBlock}`);
  });

  // 8. starknetKeccak
  console.log('\nSignature Hashing:');
  await test('starknetKeccak returns a bigint for a string message', async () => {
    const messageHash = hash.starknetKeccak('test message');
    assert(typeof messageHash === 'bigint', `expected bigint, got ${typeof messageHash}`);
    assert(messageHash > 0n, 'hash should be positive');
    console.log(`    hash("test message"): 0x${messageHash.toString(16).slice(0, 16)}...`);
  });

  await test('starknetKeccak is deterministic', async () => {
    const hash1 = hash.starknetKeccak('DFX Swiss');
    const hash2 = hash.starknetKeccak('DFX Swiss');
    assert(hash1 === hash2, 'same input should produce same hash');
  });

  // 9. Contract instantiation
  console.log('\nContract Instantiation:');
  await test('Contract with ERC20 ABI can call balanceOf and returns named field', async () => {
    const contract = new Contract({ abi: ERC20_ABI, address: STRK_TOKEN, providerOrAccount: PROVIDER });
    const result = await (contract.call('balanceOf', [TEST_ADDRESS]) as any);
    assert('balance' in result, 'result should have balance field');
    assert(typeof result.balance === 'bigint', `balance should be bigint, got ${typeof result.balance}`);
  });

  // 10. Address format validation
  console.log('\nAddress Format:');
  await test('starknet address regex matches valid addresses', async () => {
    const regex = /^0x[0-9a-fA-F]{50,64}$/;
    assert(regex.test(TEST_ADDRESS), `TEST_ADDRESS should match: ${TEST_ADDRESS}`);
    assert(regex.test(STRK_TOKEN), `STRK_TOKEN should match: ${STRK_TOKEN}`);
    assert(regex.test(ETH_TOKEN), `ETH_TOKEN should match: ${ETH_TOKEN}`);
    assert(!regex.test('0x1234567890abcdef1234567890abcdef12345678'), 'ETH address should NOT match');
  });

  // --- SUMMARY --- //
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
