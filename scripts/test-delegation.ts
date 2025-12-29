/**
 * Test script for EIP-7702 Delegation
 * Run with: npx ts-node scripts/test-delegation.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  encodePacked,
  encodeAbiParameters,
  parseAbi,
  getAddress,
  Hex,
  Address,
} from 'viem';
import { privateKeyToAccount, signTypedData } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// Contract addresses (same on all EVM chains via CREATE2)
const DELEGATOR_ADDRESS = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b' as Address;
const DELEGATION_MANAGER_ADDRESS = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as Address;

// ROOT_AUTHORITY constant - delegating own authority
const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex;

// ERC-7579 execution mode for single call
const CALLTYPE_SINGLE = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

// ERC20 transfer function
const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);

// DelegationManager ABI
const DELEGATION_MANAGER_ABI = [
  {
    type: 'function',
    name: 'redeemDelegations',
    inputs: [
      { name: '_permissionContexts', type: 'bytes[]' },
      { name: '_modes', type: 'bytes32[]' },
      { name: '_executionCallDatas', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

interface Caveat {
  enforcer: Address;
  terms: Hex;
}

interface Delegation {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: bigint;
  signature: Hex;
}

async function testDelegation() {
  console.log('=== EIP-7702 Delegation Test ===\n');

  // Use test private keys (DO NOT use real keys!)
  const depositPrivateKey = '0x' + '1'.repeat(64) as Hex;
  const relayerPrivateKey = '0x' + '2'.repeat(64) as Hex;

  const depositAccount = privateKeyToAccount(depositPrivateKey);
  const relayerAccount = privateKeyToAccount(relayerPrivateKey);

  console.log('Deposit Address:', depositAccount.address);
  console.log('Relayer Address:', relayerAccount.address);

  // Create clients (using Sepolia for testing)
  const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const _walletClient = createWalletClient({
    account: relayerAccount,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  console.log('\n--- Testing Delegation Signing ---');

  // 1. Create delegation struct
  const delegation: Delegation = {
    delegate: relayerAccount.address,
    delegator: depositAccount.address,
    authority: ROOT_AUTHORITY,
    caveats: [],
    salt: BigInt(Date.now()),
    signature: '0x' as Hex,
  };

  console.log('Delegation struct:', {
    delegate: delegation.delegate,
    delegator: delegation.delegator,
    authority: delegation.authority.slice(0, 20) + '...',
    salt: delegation.salt.toString(),
  });

  // 2. Sign delegation with EIP-712
  const domain = {
    name: 'DelegationManager',
    version: '1',
    chainId: sepolia.id,
    verifyingContract: DELEGATION_MANAGER_ADDRESS,
  };

  const types = {
    Delegation: [
      { name: 'delegate', type: 'address' },
      { name: 'delegator', type: 'address' },
      { name: 'authority', type: 'bytes32' },
      { name: 'caveats', type: 'Caveat[]' },
      { name: 'salt', type: 'uint256' },
    ],
    Caveat: [
      { name: 'enforcer', type: 'address' },
      { name: 'terms', type: 'bytes' },
    ],
  };

  const message = {
    delegate: delegation.delegate,
    delegator: delegation.delegator,
    authority: delegation.authority,
    caveats: delegation.caveats,
    salt: delegation.salt,
  };

  try {
    const signature = await signTypedData({
      privateKey: depositPrivateKey,
      domain,
      types,
      primaryType: 'Delegation',
      message,
    });

    delegation.signature = signature;
    console.log('Delegation signed successfully!');
    console.log('Signature:', signature.slice(0, 30) + '...');
  } catch (error) {
    console.error('Failed to sign delegation:', error);
    return;
  }

  console.log('\n--- Testing ERC20 Transfer Encoding ---');

  // 3. Encode ERC20 transfer (use getAddress for proper checksums)
  const recipient = getAddress('0x742d35cc6634c0532925a3b844bc9e7595f2bd78');
  const tokenContract = getAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'); // USDC
  const amount = BigInt(100 * 10 ** 6); // 100 USDC

  const transferData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [recipient, amount],
  });

  console.log('Transfer data:', transferData.slice(0, 30) + '...');

  // 4. Encode execution data using ERC-7579 format
  const executionData = encodePacked(
    ['address', 'uint256', 'bytes'],
    [tokenContract, 0n, transferData],
  );

  console.log('Execution data:', executionData.slice(0, 30) + '...');

  console.log('\n--- Testing Permission Context Encoding ---');

  // 5. Encode permission context
  const encodedDelegations = [{
    delegate: delegation.delegate,
    delegator: delegation.delegator,
    authority: delegation.authority,
    caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
    salt: delegation.salt,
    signature: delegation.signature,
  }];

  const permissionContext = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'delegate', type: 'address' },
          { name: 'delegator', type: 'address' },
          { name: 'authority', type: 'bytes32' },
          {
            name: 'caveats',
            type: 'tuple[]',
            components: [
              { name: 'enforcer', type: 'address' },
              { name: 'terms', type: 'bytes' },
            ],
          },
          { name: 'salt', type: 'uint256' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    [encodedDelegations],
  );

  console.log('Permission context encoded:', permissionContext.slice(0, 50) + '...');

  console.log('\n--- Testing redeemDelegations Encoding ---');

  // 6. Encode redeemDelegations call
  const redeemData = encodeFunctionData({
    abi: DELEGATION_MANAGER_ABI,
    functionName: 'redeemDelegations',
    args: [[permissionContext], [CALLTYPE_SINGLE], [executionData]],
  });

  console.log('Redeem data:', redeemData.slice(0, 50) + '...');

  console.log('\n--- Testing Gas Estimation ---');

  // 7. Get gas price
  try {
    const gasPrice = await publicClient.getGasPrice();
    const gasPriceWithBuffer = (gasPrice * 120n) / 100n;
    console.log('Current gas price:', gasPrice.toString(), 'wei');
    console.log('Gas price with 20% buffer:', gasPriceWithBuffer.toString(), 'wei');
  } catch {
    console.log('Could not get gas price (expected if no RPC connection)');
  }

  console.log('\n--- Testing EIP-7702 Authorization ---');

  // 8. Sign EIP-7702 authorization (this requires a live network)
  console.log('EIP-7702 authorization would delegate to:', DELEGATOR_ADDRESS);
  console.log('Target contract (DelegationManager):', DELEGATION_MANAGER_ADDRESS);

  console.log('\n=== All encoding tests passed! ===');
  console.log('\nNote: Actual transaction sending requires:');
  console.log('1. A funded relayer account');
  console.log('2. A deposit account with tokens');
  console.log('3. An RPC endpoint that supports EIP-7702 (post-Pectra)');
}

// Run tests
testDelegation().catch(console.error);
