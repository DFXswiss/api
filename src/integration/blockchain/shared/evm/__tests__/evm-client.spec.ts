import { ethers } from 'ethers';
import { EvmClient, EvmClientParams } from '../evm-client';

// Minimal concrete subclass so the abstract EvmClient can be instantiated for unit-testing its own methods.
class TestEvmClient extends EvmClient {
  constructor(params: EvmClientParams) {
    super(params);
  }
}

describe('EvmClient', () => {
  let client: TestEvmClient;
  let providerGetTransactionCount: jest.Mock;

  beforeEach(() => {
    client = new TestEvmClient({
      http: {} as any,
      gatewayUrl: 'https://rpc.example.com',
      apiKey: 'test-key',
      // throw-away random key; never used to sign in these tests
      walletPrivateKey: ethers.Wallet.createRandom().privateKey,
      chainId: 1,
    });

    providerGetTransactionCount = jest.fn().mockResolvedValue(5);
    // replace the real JSON-RPC provider with a stub
    (client as any).provider = { getTransactionCount: providerGetTransactionCount };
  });

  describe('getTransactionCount', () => {
    const address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

    it('defaults to the latest (mined) nonce when no block tag is given', async () => {
      const result = await client.getTransactionCount(address);

      expect(result).toBe(5);
      expect(providerGetTransactionCount).toHaveBeenCalledWith(address, 'latest');
    });

    it('forwards the pending block tag to count still-pending mempool txs', async () => {
      const result = await client.getTransactionCount(address, 'pending');

      expect(result).toBe(5);
      expect(providerGetTransactionCount).toHaveBeenCalledWith(address, 'pending');
    });
  });
});
