/**
 * Live EIP-7702 Delegation Test on Sepolia
 *
 * Prerequisites:
 * - RELAYER_PRIVATE_KEY: Wallet with Sepolia ETH for gas
 * - DEPOSIT_PRIVATE_KEY: Wallet with test tokens to transfer
 * - TOKEN_ADDRESS: ERC20 token contract on Sepolia
 * - RECIPIENT_ADDRESS: Where to send tokens
 *
 * Run with:
 *   RELAYER_PRIVATE_KEY=0x... DEPOSIT_PRIVATE_KEY=0x... \
 *   TOKEN_ADDRESS=0x... RECIPIENT_ADDRESS=0x... AMOUNT=1 \
 *   npx ts-node scripts/test-delegation-live.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  encodePacked,
  encodeAbiParameters,
  parseAbi,
  formatUnits,
  Hex,
  Address,
} from 'viem';
import { privateKeyToAccount, signTypedData } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// Contract addresses (MetaMask Delegation Framework v1.3.0)
const DELEGATOR_ADDRESS = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b' as Address;
const DELEGATION_MANAGER_ADDRESS = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as Address;

// Constants
const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex;
const CALLTYPE_SINGLE = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

// ABIs
const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

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

interface Delegation {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: { enforcer: Address; terms: Hex }[];
  salt: bigint;
  signature: Hex;
}

async function main() {
  console.log('=== EIP-7702 Live Delegation Test (Sepolia) ===\n');

  // Get environment variables
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY as Hex;
  const depositPrivateKey = process.env.DEPOSIT_PRIVATE_KEY as Hex;
  const tokenAddress = process.env.TOKEN_ADDRESS as Address;
  const recipientAddress = process.env.RECIPIENT_ADDRESS as Address;
  const amount = process.env.AMOUNT || '1';

  // Validate inputs
  if (!relayerPrivateKey || !relayerPrivateKey.startsWith('0x')) {
    console.error('❌ RELAYER_PRIVATE_KEY required (with 0x prefix)');
    process.exit(1);
  }
  if (!depositPrivateKey || !depositPrivateKey.startsWith('0x')) {
    console.error('❌ DEPOSIT_PRIVATE_KEY required (with 0x prefix)');
    process.exit(1);
  }
  if (!tokenAddress || !tokenAddress.startsWith('0x')) {
    console.error('❌ TOKEN_ADDRESS required');
    process.exit(1);
  }
  if (!recipientAddress || !recipientAddress.startsWith('0x')) {
    console.error('❌ RECIPIENT_ADDRESS required');
    process.exit(1);
  }

  // Create accounts
  const relayerAccount = privateKeyToAccount(relayerPrivateKey);
  const depositAccount = privateKeyToAccount(depositPrivateKey);

  console.log('Relayer Address:', relayerAccount.address);
  console.log('Deposit Address:', depositAccount.address);
  console.log('Token Address:', tokenAddress);
  console.log('Recipient:', recipientAddress);
  console.log('Amount:', amount);

  // Create clients
  const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://1rpc.io/sepolia';

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account: relayerAccount,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  // Check balances
  console.log('\n--- Checking Balances ---');

  const relayerEthBalance = await publicClient.getBalance({ address: relayerAccount.address });
  console.log('Relayer ETH:', formatUnits(relayerEthBalance, 18), 'ETH');

  if (relayerEthBalance === 0n) {
    console.error('❌ Relayer has no ETH for gas!');
    process.exit(1);
  }

  // Get token info
  const [decimals, symbol, depositTokenBalance] = await Promise.all([
    publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' } as any),
    publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'symbol' } as any),
    publicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [depositAccount.address] } as any),
  ]) as [number, string, bigint];

  console.log('Token:', symbol, `(${decimals} decimals)`);
  console.log('Deposit Balance:', formatUnits(depositTokenBalance, Number(decimals)), symbol);

  const amountWei = BigInt(Math.floor(parseFloat(amount) * 10 ** Number(decimals)));

  if (depositTokenBalance < amountWei) {
    console.error(`❌ Insufficient token balance! Need ${amount} ${symbol}, have ${formatUnits(depositTokenBalance, Number(decimals))}`);
    process.exit(1);
  }

  // 1. Create delegation
  console.log('\n--- Creating Delegation ---');

  const delegation: Delegation = {
    delegate: relayerAccount.address,
    delegator: depositAccount.address,
    authority: ROOT_AUTHORITY,
    caveats: [],
    salt: BigInt(Date.now()),
    signature: '0x' as Hex,
  };

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

  delegation.signature = await signTypedData({
    privateKey: depositPrivateKey,
    domain,
    types,
    primaryType: 'Delegation',
    message: {
      delegate: delegation.delegate,
      delegator: delegation.delegator,
      authority: delegation.authority,
      caveats: delegation.caveats,
      salt: delegation.salt,
    },
  });

  console.log('Delegation signed ✅');

  // 3. Encode ERC20 transfer
  const transferData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [recipientAddress, amountWei],
  });

  // 4. Encode execution data (ERC-7579)
  const executionData = encodePacked(
    ['address', 'uint256', 'bytes'],
    [tokenAddress, 0n, transferData],
  );

  // 5. Encode permission context
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
    [[{
      delegate: delegation.delegate,
      delegator: delegation.delegator,
      authority: delegation.authority,
      caveats: [],
      salt: delegation.salt,
      signature: delegation.signature,
    }]],
  );

  // 6. Encode redeemDelegations call
  const redeemData = encodeFunctionData({
    abi: DELEGATION_MANAGER_ABI,
    functionName: 'redeemDelegations',
    args: [[permissionContext], [CALLTYPE_SINGLE], [executionData]],
  });

  // 7. Sign EIP-7702 authorization
  console.log('\n--- Signing EIP-7702 Authorization ---');

  const authorization = await walletClient.signAuthorization({
    account: depositAccount,
    contractAddress: DELEGATOR_ADDRESS,
  });

  console.log('Authorization signed ✅');

  // 8. Estimate gas
  console.log('\n--- Estimating Gas ---');

  const [gasPrice, block] = await Promise.all([
    publicClient.getGasPrice(),
    publicClient.getBlock(),
  ]);
  const baseFee = block.baseFeePerGas || gasPrice;
  const maxPriorityFeePerGas = 1000000n; // 0.001 gwei tip
  const maxFeePerGas = (baseFee * 120n) / 100n + maxPriorityFeePerGas;

  let gasEstimate: bigint;
  try {
    gasEstimate = await publicClient.estimateGas({
      account: relayerAccount,
      to: DELEGATION_MANAGER_ADDRESS,
      data: redeemData,
      authorizationList: [authorization],
    } as any);
  } catch (e: any) {
    console.error('❌ Gas estimation failed:', e.message);
    console.log('\nThis might indicate:');
    console.log('- The RPC does not support EIP-7702 yet');
    console.log('- The delegation parameters are incorrect');
    console.log('- The deposit account needs to be set up differently');
    process.exit(1);
  }

  const gasLimit = (gasEstimate * 120n) / 100n;
  const estimatedCost = formatUnits(maxFeePerGas * gasLimit, 18);

  console.log('Gas Estimate:', gasEstimate.toString());
  console.log('Gas Limit (with buffer):', gasLimit.toString());
  console.log('Max Fee Per Gas:', formatUnits(maxFeePerGas, 9), 'gwei');
  console.log('Estimated Cost:', estimatedCost, 'ETH');

  // 9. Send transaction
  console.log('\n--- Sending Transaction ---');
  console.log(`Transferring ${amount} ${symbol} from ${depositAccount.address} to ${recipientAddress}`);

  const txHash = await walletClient.sendTransaction({
    to: DELEGATION_MANAGER_ADDRESS,
    data: redeemData,
    authorizationList: [authorization],
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  } as any);

  console.log('\n✅ Transaction sent!');
  console.log('TX Hash:', txHash);
  console.log('Explorer:', `https://sepolia.etherscan.io/tx/${txHash}`);

  // 10. Wait for confirmation
  console.log('\n--- Waiting for Confirmation ---');

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === 'success') {
    console.log('✅ Transaction confirmed!');
    console.log('Block:', receipt.blockNumber.toString());
    console.log('Gas Used:', receipt.gasUsed.toString());

    // Check new balances
    const newDepositBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [depositAccount.address],
    } as any) as bigint;

    const recipientBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [recipientAddress],
    } as any) as bigint;

    console.log('\n--- Final Balances ---');
    console.log('Deposit Balance:', formatUnits(newDepositBalance, Number(decimals)), symbol);
    console.log('Recipient Balance:', formatUnits(recipientBalance, Number(decimals)), symbol);
  } else {
    console.error('❌ Transaction failed!');
    process.exit(1);
  }

  console.log('\n=== Test Complete ===');
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
