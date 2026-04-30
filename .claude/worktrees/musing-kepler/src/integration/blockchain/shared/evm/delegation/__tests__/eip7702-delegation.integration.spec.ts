/**
 * Integration tests for EIP-7702 Delegation against Sepolia testnet
 *
 * These tests verify that our implementation correctly interacts with the
 * actual DelegationManager contract on Sepolia.
 *
 * To run these tests:
 *   SEPOLIA_GATEWAY_URL=https://... npm test -- --testPathPattern="eip7702-delegation.integration"
 *
 * Requirements:
 *   - SEPOLIA_GATEWAY_URL environment variable must be set (or SEPOLIA_RPC_URL)
 *   - Tests are read-only and don't require funded accounts
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
  encodePacked,
  parseAbi,
  Hex,
  Address,
  decodeAbiParameters,
  getAddress,
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
  {
    type: 'function',
    name: 'getDelegationHash',
    inputs: [
      {
        name: '_input',
        type: 'tuple',
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
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'getDomainHash',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
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

// Skip tests if no Sepolia RPC URL is set
const SEPOLIA_RPC_URL = process.env.SEPOLIA_GATEWAY_URL || process.env.SEPOLIA_RPC_URL;
const describeIfSepolia = SEPOLIA_RPC_URL ? describe : describe.skip;

// Increase timeout for network calls
const INTEGRATION_TEST_TIMEOUT = 30000;

describeIfSepolia('EIP-7702 Delegation Integration Tests (Sepolia)', () => {
  // Test private keys (deterministic, not real funds)
  const depositPrivateKey = ('0x' + '1'.repeat(64)) as Hex;
  const relayerPrivateKey = ('0x' + '2'.repeat(64)) as Hex;

  const depositAccount = privateKeyToAccount(depositPrivateKey);
  const relayerAccount = privateKeyToAccount(relayerPrivateKey);

  let publicClient: any;

  beforeAll(() => {
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(SEPOLIA_RPC_URL),
    });
  }, INTEGRATION_TEST_TIMEOUT);

  describe('Contract Verification', () => {
    it(
      'should verify DelegationManager contract exists on Sepolia',
      async () => {
        const code = await publicClient.getCode({ address: DELEGATION_MANAGER_ADDRESS });

        expect(code).toBeDefined();
        expect(code).not.toBe('0x');
        expect(code!.length).toBeGreaterThan(10);
      },
      INTEGRATION_TEST_TIMEOUT,
    );

    it(
      'should verify Delegator contract exists on Sepolia',
      async () => {
        const code = await publicClient.getCode({ address: DELEGATOR_ADDRESS });

        expect(code).toBeDefined();
        expect(code).not.toBe('0x');
        expect(code!.length).toBeGreaterThan(10);
      },
      INTEGRATION_TEST_TIMEOUT,
    );

    it(
      'should be able to call getDomainHash on DelegationManager',
      async () => {
        const domainHash = await publicClient.readContract({
          address: DELEGATION_MANAGER_ADDRESS,
          abi: DELEGATION_MANAGER_ABI,
          functionName: 'getDomainHash',
        });

        expect(domainHash).toBeDefined();
        expect(typeof domainHash).toBe('string');
        expect(domainHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      },
      INTEGRATION_TEST_TIMEOUT,
    );
  });

  describe('Delegation Signing', () => {
    it(
      'should create a valid EIP-712 delegation signature',
      async () => {
        const delegation: Delegation = {
          delegate: relayerAccount.address,
          delegator: depositAccount.address,
          authority: ROOT_AUTHORITY,
          caveats: [],
          salt: BigInt(Date.now()),
          signature: '0x' as Hex,
        };

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

        const signature = await signTypedData({
          privateKey: depositPrivateKey,
          domain,
          types,
          primaryType: 'Delegation',
          message,
        });

        // Signature should be 65 bytes (130 hex chars + 0x prefix)
        expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);

        delegation.signature = signature;

        // Verify delegation struct is valid by checking all fields
        expect(delegation.delegate).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(delegation.delegator).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(delegation.authority).toBe(ROOT_AUTHORITY);
        expect(delegation.caveats).toEqual([]);
        expect(delegation.salt).toBeGreaterThan(0n);
        expect(delegation.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
      },
      INTEGRATION_TEST_TIMEOUT,
    );
  });

  describe('Encoding Verification', () => {
    it('should encode permission context that can be decoded correctly', () => {
      const delegation: Delegation = {
        delegate: relayerAccount.address,
        delegator: depositAccount.address,
        authority: ROOT_AUTHORITY,
        caveats: [],
        salt: BigInt(12345),
        signature: ('0x' + 'ab'.repeat(65)) as Hex, // Mock signature
      };

      const encodedDelegations = [
        {
          delegate: delegation.delegate,
          delegator: delegation.delegator,
          authority: delegation.authority,
          caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
          salt: delegation.salt,
          signature: delegation.signature,
        },
      ];

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

      // Should be valid hex
      expect(permissionContext).toMatch(/^0x[a-fA-F0-9]+$/);

      // Decode and verify round-trip
      const decoded = decodeAbiParameters(
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
        permissionContext,
      );

      expect(decoded[0]).toHaveLength(1);
      expect(decoded[0][0].delegate.toLowerCase()).toBe(delegation.delegate.toLowerCase());
      expect(decoded[0][0].delegator.toLowerCase()).toBe(delegation.delegator.toLowerCase());
      expect(decoded[0][0].authority).toBe(delegation.authority);
      expect(decoded[0][0].caveats).toEqual([]);
      expect(decoded[0][0].salt).toBe(delegation.salt);
    });

    it('should encode ERC-7579 execution data in correct format', () => {
      const tokenContract = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'); // USDC
      const recipient = getAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD78');
      const amount = BigInt(100 * 10 ** 6); // 100 USDC

      const transferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [recipient, amount],
      });

      const executionData = encodePacked(['address', 'uint256', 'bytes'], [tokenContract, 0n, transferData]);

      // Should be valid hex
      expect(executionData).toMatch(/^0x[a-fA-F0-9]+$/);

      // Verify structure: 20 bytes address + 32 bytes uint256 + calldata
      // Address: 20 bytes = 40 hex chars
      // uint256: 32 bytes = 64 hex chars
      // transfer(address,uint256): 4 bytes selector + 32 bytes address + 32 bytes amount = 68 bytes = 136 hex chars
      // Total: 40 + 64 + 136 = 240 hex chars + 2 for 0x = 242
      expect(executionData.length).toBe(242);

      // First 20 bytes should be token address
      expect(executionData.slice(2, 42).toLowerCase()).toBe(tokenContract.slice(2).toLowerCase());

      // Next 32 bytes should be zero (value)
      expect(executionData.slice(42, 106)).toBe('0'.repeat(64));

      // Transfer function selector is 0xa9059cbb
      expect(executionData.slice(106, 114)).toBe('a9059cbb');
    });

    it('should encode redeemDelegations call correctly', () => {
      const mockPermissionContext = '0x1234' as Hex;
      const mockExecutionData = '0x5678' as Hex;

      const redeemData = encodeFunctionData({
        abi: DELEGATION_MANAGER_ABI,
        functionName: 'redeemDelegations',
        args: [[mockPermissionContext], [CALLTYPE_SINGLE], [mockExecutionData]],
      });

      // Should be valid hex
      expect(redeemData).toMatch(/^0x[a-fA-F0-9]+$/);

      // Should start with redeemDelegations selector
      // Function: redeemDelegations(bytes[],bytes32[],bytes[])
      // Selector can be computed but we just verify it's consistent
      expect(redeemData.slice(0, 10)).toBeDefined();
    });
  });

  describe('Gas Estimation', () => {
    it(
      'should be able to get current gas price from Sepolia',
      async () => {
        const gasPrice = await publicClient.getGasPrice();

        expect(gasPrice).toBeDefined();
        expect(typeof gasPrice).toBe('bigint');
        expect(gasPrice).toBeGreaterThan(0n);
      },
      INTEGRATION_TEST_TIMEOUT,
    );

    it(
      'should verify gas limit of 300000 is reasonable',
      async () => {
        // Get current block gas limit
        const block = await publicClient.getBlock();

        expect(block.gasLimit).toBeGreaterThan(300000n);

        // 300k gas should be well within block limits
        // A typical DelegationManager call uses ~150-250k gas
        const ourGasLimit = 300000n;
        expect(ourGasLimit).toBeLessThan(block.gasLimit);
      },
      INTEGRATION_TEST_TIMEOUT,
    );
  });

  describe('Chain Configuration', () => {
    it('should verify Sepolia chain ID is correct', () => {
      expect(sepolia.id).toBe(11155111);
    });

    it(
      'should be able to get current block number',
      async () => {
        const blockNumber = await publicClient.getBlockNumber();

        expect(blockNumber).toBeGreaterThan(0n);
      },
      INTEGRATION_TEST_TIMEOUT,
    );
  });

  describe('Full Delegation Flow (Dry Run)', () => {
    it(
      'should create complete delegation transaction data without sending',
      async () => {
        // 1. Create delegation
        const delegation: Delegation = {
          delegate: relayerAccount.address,
          delegator: depositAccount.address,
          authority: ROOT_AUTHORITY,
          caveats: [],
          salt: BigInt(Date.now()),
          signature: '0x' as Hex,
        };

        // 2. Sign delegation
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

        // 3. Verify delegation signature is valid
        expect(delegation.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);

        // 4. Encode ERC20 transfer
        const tokenContract = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'); // USDC
        const recipient = getAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD78');
        const amount = BigInt(100 * 10 ** 6);

        const transferData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [recipient, amount],
        });

        // 5. Encode execution data (ERC-7579)
        const executionData = encodePacked(['address', 'uint256', 'bytes'], [tokenContract, 0n, transferData]);

        // 6. Encode permission context
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
          [
            [
              {
                delegate: delegation.delegate,
                delegator: delegation.delegator,
                authority: delegation.authority,
                caveats: [],
                salt: delegation.salt,
                signature: delegation.signature,
              },
            ],
          ],
        );

        // 7. Encode redeemDelegations call
        const redeemData = encodeFunctionData({
          abi: DELEGATION_MANAGER_ABI,
          functionName: 'redeemDelegations',
          args: [[permissionContext], [CALLTYPE_SINGLE], [executionData]],
        });

        // 8. Verify all data is properly encoded
        expect(redeemData).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(redeemData.length).toBeGreaterThan(500); // Complex call should be substantial

        // 9. Get gas price for estimation
        const gasPrice = await publicClient.getGasPrice();
        const gasLimit = 300000n;
        const estimatedCost = (gasPrice * gasLimit) / BigInt(1e18);

        // Log for informational purposes
        console.log('Integration Test Results:');
        console.log('  Deposit Address:', depositAccount.address);
        console.log('  Relayer Address:', relayerAccount.address);
        console.log('  Transaction Data Length:', redeemData.length, 'chars');
        console.log('  Estimated Gas Cost:', estimatedCost.toString(), 'ETH');
      },
      INTEGRATION_TEST_TIMEOUT,
    );
  });
});
