import { Wallet } from '@arkade-os/sdk';
import { ArkClient } from '../ark-client';

// Mock config to provide ark credentials
jest.mock('src/config/config', () => ({
  GetConfig: () => ({
    blockchain: {
      ark: {
        arkPrivateKey: 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233',
        arkServerUrl: 'https://arkade.computer',
      },
    },
  }),
}));

describe('ArkClient', () => {
  let client: ArkClient;
  let mockWallet: {
    getAddress: jest.Mock;
    getBalance: jest.Mock;
    sendBitcoin: jest.Mock;
    getVtxos: jest.Mock;
    finalizePendingTxs: jest.Mock;
  };

  beforeEach(() => {
    mockWallet = {
      getAddress: jest.fn().mockResolvedValue('ark1testwalletaddress'),
      getBalance: jest.fn().mockResolvedValue({ available: 50000 }),
      sendBitcoin: jest.fn().mockResolvedValue('tx-abc123'),
      getVtxos: jest.fn().mockResolvedValue([]),
      finalizePendingTxs: jest.fn().mockResolvedValue({ finalized: [], pending: [] }),
    };

    // Override the wallet creation to return our mock
    jest.spyOn(Wallet, 'create').mockResolvedValue(mockWallet as any);

    client = new ArkClient();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --- BALANCE --- //

  describe('getNativeCoinBalance', () => {
    it('should return balance in BTC (sats / 1e8)', async () => {
      mockWallet.getBalance.mockResolvedValue({ available: 100_000_000 });

      const balance = await client.getNativeCoinBalance();

      expect(balance).toBe(1);
    });

    it('should handle zero balance', async () => {
      mockWallet.getBalance.mockResolvedValue({ available: 0 });

      const balance = await client.getNativeCoinBalance();

      expect(balance).toBe(0);
    });

    it('should handle sub-satoshi precision correctly', async () => {
      mockWallet.getBalance.mockResolvedValue({ available: 12345 });

      const balance = await client.getNativeCoinBalance();

      expect(balance).toBeCloseTo(0.00012345, 8);
    });
  });

  // --- SEND TRANSACTION --- //

  describe('sendTransaction', () => {
    it('should convert BTC amount to satoshis and return txid', async () => {
      const result = await client.sendTransaction('ark1destination', 0.5);

      expect(mockWallet.sendBitcoin).toHaveBeenCalledWith({
        address: 'ark1destination',
        amount: 50_000_000,
      });
      expect(result).toEqual({ txid: 'tx-abc123', fee: 0 });
    });

    it('should round satoshi amounts correctly', async () => {
      await client.sendTransaction('ark1destination', 0.123456789);

      expect(mockWallet.sendBitcoin).toHaveBeenCalledWith({
        address: 'ark1destination',
        amount: 12345679, // Math.round(12345678.9)
      });
    });
  });

  // --- GET TRANSACTION --- //

  describe('getTransaction', () => {
    it('should return confirmed when tx is in finalized list', async () => {
      mockWallet.finalizePendingTxs.mockResolvedValue({
        finalized: ['tx-abc', 'tx-def'],
        pending: [],
      });

      const tx = await client.getTransaction('tx-abc');

      expect(tx).toEqual({
        txid: 'tx-abc',
        blockhash: 'confirmed',
        confirmations: 1,
        fee: 0,
      });
    });

    it('should check VTXOs when tx is not finalized', async () => {
      mockWallet.finalizePendingTxs.mockResolvedValue({ finalized: [], pending: [] });
      mockWallet.getVtxos.mockResolvedValue([{ txid: 'tx-incoming' }]);

      const tx = await client.getTransaction('tx-incoming');

      expect(tx).toEqual({
        txid: 'tx-incoming',
        blockhash: 'confirmed',
        confirmations: 1,
        fee: 0,
      });
    });

    it('should return unconfirmed when tx is not in finalized or VTXOs', async () => {
      mockWallet.finalizePendingTxs.mockResolvedValue({ finalized: [], pending: [] });
      mockWallet.getVtxos.mockResolvedValue([]);

      const tx = await client.getTransaction('tx-unknown');

      expect(tx).toEqual({
        txid: 'tx-unknown',
        blockhash: undefined,
        confirmations: 0,
        fee: 0,
      });
    });
  });

  // --- IS TX COMPLETE --- //

  describe('isTxComplete', () => {
    it('should return true when tx has confirmations', async () => {
      mockWallet.finalizePendingTxs.mockResolvedValue({ finalized: ['tx-done'], pending: [] });

      const result = await client.isTxComplete('tx-done');

      expect(result).toBe(true);
    });

    it('should return false when tx has no confirmations', async () => {
      mockWallet.finalizePendingTxs.mockResolvedValue({ finalized: [], pending: [] });
      mockWallet.getVtxos.mockResolvedValue([]);

      const result = await client.isTxComplete('tx-pending');

      expect(result).toBe(false);
    });

    it('should return false when wallet throws', async () => {
      mockWallet.finalizePendingTxs.mockRejectedValue(new Error('network error'));

      const result = await client.isTxComplete('tx-error');

      expect(result).toBe(false);
    });
  });

  // --- FEE METHODS --- //

  describe('fee methods', () => {
    it('getNativeFee should return 0', async () => {
      expect(await client.getNativeFee()).toBe(0);
    });

    it('getTxActualFee should return 0', async () => {
      expect(await client.getTxActualFee('any-tx')).toBe(0);
    });
  });

  // --- HEALTH CHECK --- //

  describe('isHealthy', () => {
    it('should return true when wallet is accessible', async () => {
      const result = await client.isHealthy();

      expect(result).toBe(true);
    });

    it('should return false when wallet creation fails', async () => {
      jest.spyOn(Wallet, 'create').mockRejectedValue(new Error('server down'));
      client = new ArkClient();

      const result = await client.isHealthy();

      expect(result).toBe(false);
    });
  });

  // --- NOT IMPLEMENTED METHODS --- //

  describe('not implemented methods', () => {
    it('getNativeCoinBalanceForAddress should throw', async () => {
      await expect(client.getNativeCoinBalanceForAddress('addr')).rejects.toThrow('Method not implemented');
    });

    it('getTokenBalance should throw', async () => {
      await expect(client.getTokenBalance()).rejects.toThrow('Method not implemented');
    });

    it('getTokenBalances should throw', async () => {
      await expect(client.getTokenBalances()).rejects.toThrow('Method not implemented');
    });

    it('getToken should throw', async () => {
      await expect(client.getToken()).rejects.toThrow('Method not implemented');
    });

    it('sendSignedTransaction should throw', async () => {
      await expect(client.sendSignedTransaction('0x')).rejects.toThrow('Method not implemented');
    });
  });
});
