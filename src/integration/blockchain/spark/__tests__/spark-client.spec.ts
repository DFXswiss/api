/**
 * Focused unit test for the SparkClient broadcast boundary: sendTransaction syncs leaves (retryable,
 * idempotent - routed through this.call()) and THEN calls wallet.transfer, which signs AND sends
 * atomically inside the SDK. wallet.transfer must never be retried by this.call()'s reconnect-and-retry
 * (which would resend an already-settled transfer): a failure at or after that call is wrapped into a
 * TxBroadcastError instead. Wallet resolution / leaf-sync failures never reach wallet.transfer and stay
 * plain errors (safe to retry through this.call()).
 */

import { SparkWallet } from '@buildonspark/spark-sdk';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { SparkClient } from '../spark-client';

jest.mock('@buildonspark/spark-sdk', () => ({
  SparkWallet: { initialize: jest.fn() },
}));

// The process role, set per test. The name has to start with `mock`, otherwise Jest forbids
// reaching it from the hoisted module factory.
let mockCronRole = 'worker';

jest.mock('src/config/config', () => ({
  // The module is replaced entirely so the test does not pull in the whole configuration
  // chain. CronRole therefore has to come along: the client reads it to bind the optimization
  // timer to the role.
  CronRole: { ALL: 'all', API: 'api', WORKER: 'worker' },
  GetConfig: () => ({
    cronRole: mockCronRole,
    blockchain: {
      spark: {
        sparkWalletSeed: 'test seed phrase',
      },
    },
  }),
}));

function emptyAsyncGenerator(): AsyncGenerator<void> {
  return (async function* () {})();
}

describe('SparkClient', () => {
  let client: SparkClient;
  let mockWallet: {
    getSparkAddress: jest.Mock;
    getBalance: jest.Mock;
    transfer: jest.Mock;
    getTransfer: jest.Mock;
    optimizeLeaves: jest.Mock;
    optimizeTokenOutputs: jest.Mock;
    on: jest.Mock;
  };

  beforeEach(() => {
    mockWallet = {
      getSparkAddress: jest.fn().mockResolvedValue('spark1testwalletaddress'),
      getBalance: jest.fn().mockResolvedValue({ balance: 50000n }),
      transfer: jest.fn().mockResolvedValue({ id: 'tx-abc123' }),
      getTransfer: jest.fn(),
      optimizeLeaves: jest.fn().mockImplementation(() => emptyAsyncGenerator()),
      optimizeTokenOutputs: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    // SparkWallet.initialize is a bare jest.fn() from the module factory mock (not a real method), so
    // jest.restoreAllMocks() cannot reset its call history the way it does for a genuine jest.spyOn
    // target - clear it explicitly every test to keep call-count assertions isolated per test.
    (SparkWallet.initialize as jest.Mock).mockClear();
    jest.spyOn(SparkWallet, 'initialize').mockResolvedValue({ wallet: mockWallet as any } as any);

    client = new SparkClient();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockCronRole = 'worker';
  });

  // --- TOKEN OPTIMIZATION TIMER --- //

  describe('token optimization timer', () => {
    it('runs the wallet maintenance in the worker process', () => {
      // The timer is not registered through the scheduler, so the client decides itself: under
      // the worker role it is created, with the five-minute interval the client sets.
      const interval = jest.spyOn(global, 'setInterval');

      new SparkClient();

      expect(interval).toHaveBeenCalledTimes(1);
      expect(interval.mock.calls[0][1]).toBe(5 * 60 * 1000);

      clearInterval(interval.mock.results[0].value as NodeJS.Timeout);
    });

    it('runs it in the single-process role', () => {
      // The single-process role must keep the timer: only CronRole.API skips it.
      mockCronRole = 'all';
      const interval = jest.spyOn(global, 'setInterval');

      new SparkClient();

      expect(interval).toHaveBeenCalledTimes(1);

      clearInterval(interval.mock.results[0].value as NodeJS.Timeout);
    });

    it('does not run it in the API process', () => {
      // The counterpart: under the API role no timer is created at all.
      mockCronRole = 'api';
      const interval = jest.spyOn(global, 'setInterval');

      new SparkClient();

      expect(interval).not.toHaveBeenCalled();
    });
  });

  describe('sendTransaction', () => {
    it('should convert BTC amount to satoshis and return txid', async () => {
      const result = await client.sendTransaction('spark1destination', 0.5);

      expect(mockWallet.transfer).toHaveBeenCalledWith({
        amountSats: 50_000_000,
        receiverSparkAddress: 'spark1destination',
      });
      expect(result).toEqual({ txid: 'tx-abc123', fee: 0 });
    });
  });

  // --- SEND TRANSACTION - BROADCAST BOUNDARY --- //

  describe('sendTransaction - broadcast boundary', () => {
    it('wraps a wallet.transfer failure into a TxBroadcastError, keeping message and cause', async () => {
      const cause = new Error('unexpected rejection');
      mockWallet.transfer.mockRejectedValue(cause);

      let error: unknown;
      try {
        await client.sendTransaction('spark1destination', 0.5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('unexpected rejection');
      expect((error as TxBroadcastError).cause).toBe(cause);
    });

    it('wraps a non-Error rejection using String(e)', async () => {
      mockWallet.transfer.mockRejectedValue('plain string rejection');

      let error: unknown;
      try {
        await client.sendTransaction('spark1destination', 0.5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('plain string rejection');
    });

    it('never resends when wallet.transfer fails with a channel-shutdown error (fail-closed, no double-send), but resets the cache so the next call reconnects', async () => {
      mockWallet.transfer.mockRejectedValue(new Error('Channel has been shut down'));

      await expect(client.sendTransaction('spark1destination', 0.5)).rejects.toBeInstanceOf(TxBroadcastError);
      expect(mockWallet.transfer).toHaveBeenCalledTimes(1); // never resent within this call

      const freshWallet = { ...mockWallet, transfer: jest.fn().mockResolvedValue({ id: 'tx-fresh' }) };
      jest.spyOn(SparkWallet, 'initialize').mockResolvedValue({ wallet: freshWallet as any } as any);

      const result = await client.sendTransaction('spark1destination', 0.5);

      expect(result).toEqual({ txid: 'tx-fresh', fee: 0 }); // next call picked up the fresh wallet
      expect(freshWallet.transfer).toHaveBeenCalledTimes(1);
    });

    it('does not reset the cache when wallet.transfer fails with an unrelated error', async () => {
      mockWallet.transfer.mockRejectedValue(new Error('insufficient funds'));

      await expect(client.sendTransaction('spark1destination', 0.5)).rejects.toBeInstanceOf(TxBroadcastError);

      mockWallet.transfer.mockResolvedValue({ id: 'tx-retry' });
      await client.sendTransaction('spark1destination', 0.5);

      // still the same wallet instance from SparkWallet.initialize - no reinitialization happened
      expect(SparkWallet.initialize).toHaveBeenCalledTimes(1);
    });

    it('propagates a leaf-sync (pre-broadcast) failure unchanged and never reaches wallet.transfer', async () => {
      const syncError = new Error('optimizeLeaves failed');
      mockWallet.optimizeLeaves.mockImplementation(() => {
        throw syncError;
      });

      let error: unknown;
      try {
        await client.sendTransaction('spark1destination', 0.5);
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect(mockWallet.transfer).not.toHaveBeenCalled();
    });

    it('wraps an empty transfer id into a TxBroadcastError (fail-closed silent failure)', async () => {
      mockWallet.transfer.mockResolvedValue({ id: '' });

      await expect(client.sendTransaction('spark1destination', 0.5)).rejects.toBeInstanceOf(TxBroadcastError);
      expect(mockWallet.transfer).toHaveBeenCalledTimes(1);
    });
  });
});
