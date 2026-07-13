import { Wallet } from '@arkade-os/sdk';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { ArkadeClient } from '../arkade-client';

// Mock the SDK to provide InMemory repositories
jest.mock('@arkade-os/sdk', () => {
  const actualSdk = jest.requireActual('@arkade-os/sdk');
  return {
    ...actualSdk,
    InMemoryWalletRepository: class MockWalletRepository {},
    InMemoryContractRepository: class MockContractRepository {},
  };
});

// Mock config to provide arkade credentials
jest.mock('src/config/config', () => ({
  GetConfig: () => ({
    blockchain: {
      arkade: {
        arkadePrivateKey: 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233',
        arkadeServerUrl: 'https://arkade.computer',
      },
    },
  }),
}));

describe('ArkadeClient', () => {
  let client: ArkadeClient;
  let mockWallet: {
    getAddress: jest.Mock;
    getBalance: jest.Mock;
    sendBitcoin: jest.Mock;
    getVtxos: jest.Mock;
    finalizePendingTxs: jest.Mock;
    getContractManager: jest.Mock;
  };

  beforeEach(() => {
    mockWallet = {
      getAddress: jest.fn().mockResolvedValue('ark1testwalletaddress'),
      getBalance: jest.fn().mockResolvedValue({ available: 50000 }),
      sendBitcoin: jest.fn().mockResolvedValue('tx-abc123'),
      getVtxos: jest.fn().mockResolvedValue([]),
      finalizePendingTxs: jest.fn().mockResolvedValue({ finalized: [], pending: [] }),
      getContractManager: jest.fn().mockResolvedValue({ dispose: jest.fn() }),
    };

    // Override the wallet creation to return our mock
    jest.spyOn(Wallet, 'create').mockResolvedValue(mockWallet as any);

    client = new ArkadeClient();
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

  // --- SEND TRANSACTION - BROADCAST BOUNDARY --- //
  // wallet.sendBitcoin signs AND broadcasts atomically inside the SDK, so it must never be retried by
  // this.call()'s reconnect-and-retry (which would resend an already-broadcast tx). Any failure at or
  // after that call is wrapped into a TxBroadcastError; wallet resolution failures never reach
  // sendBitcoin and stay plain errors.

  describe('sendTransaction - broadcast boundary', () => {
    it('wraps a sendBitcoin failure into a TxBroadcastError, keeping message and cause', async () => {
      const cause = new Error('unexpected rejection');
      mockWallet.sendBitcoin.mockRejectedValue(cause);

      let error: unknown;
      try {
        await client.sendTransaction('ark1destination', 0.5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('unexpected rejection');
      expect((error as TxBroadcastError).cause).toBe(cause);
    });

    it('wraps a non-Error rejection using String(e)', async () => {
      mockWallet.sendBitcoin.mockRejectedValue('plain string rejection');

      let error: unknown;
      try {
        await client.sendTransaction('ark1destination', 0.5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('plain string rejection');
    });

    it('never resends when sendBitcoin fails with a connection-classified error (fail-closed, no double-send), but resets the cache so the next call reconnects', async () => {
      mockWallet.sendBitcoin.mockRejectedValue(new Error('connection lost'));

      await expect(client.sendTransaction('ark1destination', 0.5)).rejects.toBeInstanceOf(TxBroadcastError);
      expect(mockWallet.sendBitcoin).toHaveBeenCalledTimes(1); // never resent within this call

      const freshWallet = { ...mockWallet, sendBitcoin: jest.fn().mockResolvedValue('tx-fresh') };
      jest.spyOn(Wallet, 'create').mockResolvedValue(freshWallet as any);

      const result = await client.sendTransaction('ark1destination', 0.5);

      expect(result).toEqual({ txid: 'tx-fresh', fee: 0 }); // next call picked up the fresh wallet
      expect(freshWallet.sendBitcoin).toHaveBeenCalledTimes(1);
    });

    it('does not reset the cache when sendBitcoin fails with an unrelated error', async () => {
      mockWallet.sendBitcoin.mockRejectedValue(new Error('insufficient funds'));

      await expect(client.sendTransaction('ark1destination', 0.5)).rejects.toBeInstanceOf(TxBroadcastError);

      mockWallet.sendBitcoin.mockResolvedValue('tx-retry');
      await client.sendTransaction('ark1destination', 0.5);

      // still the same wallet instance from Wallet.create - no reinitialization happened
      expect(Wallet.create).toHaveBeenCalledTimes(1);
    });

    it('propagates a wallet resolution failure as a plain (non-TxBroadcastError) error and resets the cache, never reaching sendBitcoin', async () => {
      jest.spyOn(Wallet, 'create').mockRejectedValue(new Error('server down'));
      const freshClient = new ArkadeClient();

      let error: unknown;
      try {
        await freshClient.sendTransaction('ark1destination', 0.5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect((error as Error).message).toBe('server down');
      expect(mockWallet.sendBitcoin).not.toHaveBeenCalled();

      // reset proof: the next attempt re-initializes instead of reusing the permanently-rejected AsyncField
      jest.spyOn(Wallet, 'create').mockResolvedValue(mockWallet as any);
      const result = await freshClient.sendTransaction('ark1destination', 0.5);
      expect(result).toEqual({ txid: 'tx-abc123', fee: 0 });
    });

    it('wraps an empty txid from sendBitcoin into a TxBroadcastError (fail-closed silent failure)', async () => {
      mockWallet.sendBitcoin.mockResolvedValue('');

      await expect(client.sendTransaction('ark1destination', 0.5)).rejects.toBeInstanceOf(TxBroadcastError);
      expect(mockWallet.sendBitcoin).toHaveBeenCalledTimes(1);
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
      client = new ArkadeClient();

      const result = await client.isHealthy();

      expect(result).toBe(false);
    });
  });

  // --- CONTRACT WATCHER DISPOSAL --- //

  describe('contract watcher disposal', () => {
    beforeEach(async () => {
      // The outer beforeEach created an eagerly-initializing client that shares the
      // Wallet.create spy. Drain its pending init here so it cannot race the spy these
      // tests re-point at their own dedicated wallet (would otherwise double the counts).
      await client.isHealthy();
    });

    it('should dispose the unused contract watcher after wallet creation', async () => {
      const disposeMock = jest.fn();
      const dedicatedWallet = {
        getAddress: jest.fn().mockResolvedValue('ark1testwalletaddress'),
        getContractManager: jest.fn().mockResolvedValue({ dispose: disposeMock }),
      };
      jest.spyOn(Wallet, 'create').mockResolvedValue(dedicatedWallet as any);
      client = new ArkadeClient();

      await client.isHealthy(); // forces wallet initialization

      expect(dedicatedWallet.getContractManager).toHaveBeenCalledTimes(1);
      expect(disposeMock).toHaveBeenCalledTimes(1);
    });

    it('should not fail wallet creation when contract watcher disposal throws', async () => {
      const dedicatedWallet = {
        getAddress: jest.fn().mockResolvedValue('ark1testwalletaddress'),
        getContractManager: jest.fn().mockRejectedValue(new Error('watcher disposal failed')),
      };
      jest.spyOn(Wallet, 'create').mockResolvedValue(dedicatedWallet as any);
      client = new ArkadeClient();

      await expect(client.isHealthy()).resolves.toBe(true);
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
