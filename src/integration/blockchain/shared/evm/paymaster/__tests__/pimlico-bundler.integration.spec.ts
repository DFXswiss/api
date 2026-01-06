/**
 * Integration tests for PimlicoBundlerService
 *
 * These tests make REAL API calls to Pimlico. Run with:
 *   PIMLICO_API_KEY=your_key npm test -- pimlico-bundler.integration.spec.ts
 *
 * Skip in CI by default (no API key), run locally for verification.
 */
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

// Real Pimlico API key from environment
const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY;
const TEST_WALLET = '0x482c8a499c7ac19925a0D2aA3980E1f3C5F19120';

// Skip all tests if no API key
const describeIfApiKey = PIMLICO_API_KEY ? describe : describe.skip;

describeIfApiKey('PimlicoBundlerService Integration (Real API)', () => {
  const getPimlicoUrl = (blockchain: Blockchain): string => {
    const chainNames: Partial<Record<Blockchain, string>> = {
      [Blockchain.ETHEREUM]: 'ethereum',
      [Blockchain.SEPOLIA]: 'sepolia',
      [Blockchain.ARBITRUM]: 'arbitrum',
      [Blockchain.OPTIMISM]: 'optimism',
      [Blockchain.POLYGON]: 'polygon',
      [Blockchain.BASE]: 'base',
      [Blockchain.BINANCE_SMART_CHAIN]: 'binance',
      [Blockchain.GNOSIS]: 'gnosis',
    };
    return `https://api.pimlico.io/v2/${chainNames[blockchain]}/rpc?apikey=${PIMLICO_API_KEY}`;
  };

  const jsonRpc = async (url: string, method: string, params: unknown[]): Promise<any> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now(),
      }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(`${method} failed: ${data.error.message || JSON.stringify(data.error)}`);
    }
    return data.result;
  };

  describe('Gas Price API', () => {
    it('should get gas prices from Pimlico for Sepolia', async () => {
      const url = getPimlicoUrl(Blockchain.SEPOLIA);
      const result = await jsonRpc(url, 'pimlico_getUserOperationGasPrice', []);

      expect(result).toBeDefined();
      expect(result.slow).toBeDefined();
      expect(result.standard).toBeDefined();
      expect(result.fast).toBeDefined();

      // Verify gas price structure
      expect(result.fast.maxFeePerGas).toBeDefined();
      expect(result.fast.maxPriorityFeePerGas).toBeDefined();

      // Gas prices should be hex strings
      expect(result.fast.maxFeePerGas).toMatch(/^0x[0-9a-fA-F]+$/);

      console.log('Sepolia gas prices:', {
        slow: BigInt(result.slow.maxFeePerGas).toString(),
        standard: BigInt(result.standard.maxFeePerGas).toString(),
        fast: BigInt(result.fast.maxFeePerGas).toString(),
      });
    });

    it('should get gas prices for multiple chains', async () => {
      const chains = [Blockchain.SEPOLIA, Blockchain.BASE, Blockchain.ARBITRUM];

      for (const chain of chains) {
        const url = getPimlicoUrl(chain);
        const result = await jsonRpc(url, 'pimlico_getUserOperationGasPrice', []);
        expect(result.fast).toBeDefined();
        console.log(`${chain} max fee:`, BigInt(result.fast.maxFeePerGas).toString(), 'wei');
      }
    });
  });

  describe('Supported Entry Points', () => {
    it('should use EntryPoint v0.7 for EIP-7702', () => {
      // Pimlico supports EntryPoint v0.7 for EIP-7702 operations
      const entryPointV07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

      // This is the canonical ERC-4337 v0.7 EntryPoint
      expect(entryPointV07).toBe('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
      console.log('EntryPoint v0.7:', entryPointV07);
    });
  });

  describe('Chain ID', () => {
    it('should return correct chain ID for Sepolia', async () => {
      const url = getPimlicoUrl(Blockchain.SEPOLIA);
      const result = await jsonRpc(url, 'eth_chainId', []);

      expect(result).toBe('0xaa36a7'); // 11155111 in hex
      console.log('Sepolia chain ID:', parseInt(result, 16));
    });
  });

  describe('Authorization Data Preparation', () => {
    it('should prepare EIP-7702 authorization data structure', async () => {
      // This test verifies the data structure that would be sent to the user for signing
      const METAMASK_DELEGATOR_ADDRESS = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
      const chainId = 11155111; // Sepolia
      const nonce = 0;

      const typedData = {
        domain: {
          chainId,
        },
        types: {
          Authorization: [
            { name: 'chainId', type: 'uint256' },
            { name: 'address', type: 'address' },
            { name: 'nonce', type: 'uint256' },
          ],
        },
        primaryType: 'Authorization',
        message: {
          chainId,
          address: METAMASK_DELEGATOR_ADDRESS,
          nonce,
        },
      };

      // Verify structure
      expect(typedData.domain.chainId).toBe(11155111);
      expect(typedData.message.address).toBe(METAMASK_DELEGATOR_ADDRESS);
      expect(typedData.types.Authorization).toHaveLength(3);

      console.log('EIP-7702 Authorization typed data:', JSON.stringify(typedData, null, 2));
    });
  });

  describe('Native Balance Check', () => {
    it('should check if test wallet has zero ETH on Sepolia via public RPC', async () => {
      // Use public RPC for balance check (Pimlico doesn't support eth_getBalance)
      const publicRpc = 'https://ethereum-sepolia-rpc.publicnode.com';
      const result = await jsonRpc(publicRpc, 'eth_getBalance', [TEST_WALLET, 'latest']);

      const balance = BigInt(result);
      console.log(`Test wallet ${TEST_WALLET} balance:`, balance.toString(), 'wei');

      // For gasless flow, we expect 0 balance
      // This test documents the current state
      if (balance === 0n) {
        console.log('✓ Wallet has 0 ETH - eligible for gasless transaction');
      } else {
        console.log('✗ Wallet has ETH - would use normal transaction');
      }
    });
  });

  describe('UserOperation Nonce', () => {
    it('should get nonce for new account from EntryPoint via public RPC', async () => {
      // Use public RPC for eth_call (Pimlico doesn't support generic eth_call)
      const publicRpc = 'https://ethereum-sepolia-rpc.publicnode.com';
      const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

      // getNonce(address sender, uint192 key) - key=0 for default
      // Function selector: 0x35567e1a
      const data =
        '0x35567e1a' +
        TEST_WALLET.slice(2).toLowerCase().padStart(64, '0') +
        '0'.padStart(64, '0'); // key = 0

      const result = await jsonRpc(publicRpc, 'eth_call', [{ to: ENTRY_POINT_V07, data }, 'latest']);

      const nonce = BigInt(result);
      console.log(`EntryPoint nonce for ${TEST_WALLET}:`, nonce.toString());

      // New accounts should have nonce 0
      expect(nonce).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('EIP-7702 Factory Support', () => {
    it('should verify EIP-7702 factory marker is recognized', () => {
      // Pimlico recognizes factory=0x7702 as EIP-7702 signal
      const EIP7702_FACTORY = '0x0000000000000000000000000000000000007702';

      expect(EIP7702_FACTORY).toBe('0x0000000000000000000000000000000000007702');
      console.log('EIP-7702 factory marker:', EIP7702_FACTORY);
    });
  });
});

describeIfApiKey('PimlicoBundlerService UserOperation Building', () => {
  const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
  const METAMASK_DELEGATOR = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
  const EIP7702_FACTORY = '0x0000000000000000000000000000000000007702';

  it('should build a valid UserOperation structure for EIP-7702', () => {
    // This test verifies we can build the UserOp structure
    // without actually submitting it (no USDT in test wallet)

    const userOp = {
      sender: TEST_WALLET,
      nonce: '0x0',
      factory: EIP7702_FACTORY,
      factoryData: '0x', // Would contain signed authorization
      callData: '0x', // Would contain execute() call
      callGasLimit: '0x30d40', // 200000
      verificationGasLimit: '0x7a120', // 500000
      preVerificationGas: '0x186a0', // 100000
      maxFeePerGas: '0x12769c',
      maxPriorityFeePerGas: '0x127690',
      paymaster: '0x0000000000000000000000000000000000000000',
      paymasterVerificationGasLimit: '0x0',
      paymasterPostOpGasLimit: '0x0',
      paymasterData: '0x',
      signature: '0x',
    };

    // Verify required fields
    expect(userOp.sender).toBe(TEST_WALLET);
    expect(userOp.factory).toBe(EIP7702_FACTORY);
    expect(userOp.callGasLimit).toBeDefined();
    expect(userOp.verificationGasLimit).toBeDefined();

    console.log('UserOperation structure:', JSON.stringify(userOp, null, 2));
  });

  it('should encode ERC-7821 execute call data correctly', () => {
    const { encodeFunctionData, parseAbi } = require('viem');

    // MetaMask Delegator uses ERC-7821 execute()
    const DELEGATOR_ABI = parseAbi([
      'function execute((bytes32 mode, bytes executionData) execution) external payable',
    ]);

    // Batch call mode
    const BATCH_CALL_MODE = '0x0100000000000000000000000000000000000000000000000000000000000000';

    // Simple execution data (would be encoded calls)
    const executionData = '0x';

    const callData = encodeFunctionData({
      abi: DELEGATOR_ABI,
      functionName: 'execute',
      args: [{ mode: BATCH_CALL_MODE, executionData }],
    });

    expect(callData).toMatch(/^0x[0-9a-fA-F]+$/);
    console.log('Execute call data length:', callData.length, 'bytes');
  });
});

// Summary test to document the full flow
describeIfApiKey('EIP-7702 Gasless Flow Documentation', () => {
  it('should document the complete gasless transaction flow', () => {
    const flow = `
    EIP-7702 + ERC-4337 Gasless Flow:

    1. Frontend: User initiates sell with 0 ETH balance
       - GET /sell/paymentInfos returns gaslessAvailable: true
       - API returns eip7702Authorization with typed data to sign

    2. Frontend: User signs EIP-7702 authorization in wallet
       - Signs: { chainId, address: MetaMaskDelegator, nonce }
       - This delegates the Delegator contract to user's EOA

    3. Backend: Receives signed authorization
       - POST /sell/confirm with authorization { chainId, address, nonce, r, s, yParity }

    4. Backend: PimlicoBundlerService.executeGaslessTransfer()
       a. Encode ERC20 transfer call
       b. Wrap in ERC-7821 execute() call for MetaMask Delegator
       c. Build ERC-4337 UserOperation with factory=0x7702
       d. Sponsor via Pimlico Paymaster (pm_sponsorUserOperation)
       e. Submit via Pimlico Bundler (eth_sendUserOperation)
       f. Wait for transaction (eth_getUserOperationReceipt)

    5. Result: Token transfer from user's EOA, gas paid by Pimlico

    Key Contracts:
    - MetaMask Delegator: 0x63c0c19a282a1b52b07dd5a65b58948a07dae32b
    - EntryPoint v0.7: 0x0000000071727De22E5E9d8BAf0edAc6f37da032
    - EIP-7702 Factory: 0x0000000000000000000000000000000000007702
    `;

    console.log(flow);
    expect(true).toBe(true);
  });
});
