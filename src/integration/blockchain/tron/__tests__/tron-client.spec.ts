/**
 * Focused unit test for the TronClient broadcast boundary: sendNativeCoin/sendToken forward a single
 * gateway call (`POST /transaction` / `POST /trc20/transaction`) that signs AND broadcasts the tx
 * atomically in one remote request - there is no separate local pre-broadcast step to isolate, so
 * ANY failure from that POST call on is ambiguous (the tx may already be on-chain) and gets wrapped
 * into a TxBroadcastError. sendToken's decimals check happens before the POST and stays a plain,
 * provably pre-broadcast error.
 *
 * TronClient's constructor wires up a real TronWallet from a seed that needs live config. To isolate
 * JUST the changed methods, we call the private prototype methods directly via Function.prototype.call
 * against a minimal stub `this`, following the same pattern as cardano/solana/icp-client.spec.ts.
 *
 * The second suite covers the config gate that decides whether the client is usable at all - same
 * prototype-stub approach, since isConfigured only reads Config.
 */

import { Config, ConfigService } from 'src/config/config';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { TronClient } from '../tron-client';

const proto = TronClient.prototype as any;

function createClientStub(post: jest.Mock): any {
  const client = Object.create(TronClient.prototype);
  client.http = { post };
  return client;
}

beforeAll(() => {
  new ConfigService(); // sets module-level Config (tronApiUrl/tronApiKey read inside the client methods)
});

describe('TronClient - broadcast boundary', () => {
  describe('sendNativeCoin(...)', () => {
    it('returns the txId when the gateway call succeeds', async () => {
      const post = jest.fn().mockResolvedValue({ txId: 'TX_HASH_01' });
      const client = createClientStub(post);
      const wallet = { privateKey: 'PRIVATE_KEY_HEX' };

      const txId = await proto.sendNativeCoin.call(client, wallet, 'ADDR_01', 5);

      expect(txId).toBe('TX_HASH_01');
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][1]).toEqual({
        fromPrivateKey: 'PRIVATE_KEY_HEX',
        to: 'ADDR_01',
        amount: '5',
      });
    });

    it('wraps a gateway rejection into a TxBroadcastError (fail-closed: sign+broadcast are atomic)', async () => {
      const cause = new Error('gateway unreachable');
      const post = jest.fn().mockRejectedValue(cause);
      const client = createClientStub(post);
      const wallet = { privateKey: 'PRIVATE_KEY_HEX' };

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, wallet, 'ADDR_01', 5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('gateway unreachable');
      expect((error as TxBroadcastError).cause).toBe(cause);
    });

    it('wraps a non-Error rejection using String(e)', async () => {
      const post = jest.fn().mockRejectedValue('plain string rejection');
      const client = createClientStub(post);
      const wallet = { privateKey: 'PRIVATE_KEY_HEX' };

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, wallet, 'ADDR_01', 5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('plain string rejection');
    });

    it('wraps a 200 response without a txId into a TxBroadcastError (fail-closed silent failure)', async () => {
      const post = jest.fn().mockResolvedValue({});
      const client = createClientStub(post);
      const wallet = { privateKey: 'PRIVATE_KEY_HEX' };

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, wallet, 'ADDR_01', 5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Tron broadcast returned an empty txId');
    });
  });

  describe('sendToken(...)', () => {
    const token = createCustomAsset({ decimals: 6, chainId: '0xTOKENADDR', uniqueName: 'Tron/USDT' });

    it('throws a plain (non-TxBroadcastError) Error when the token has no decimals - pre-broadcast, never reaches the gateway', async () => {
      const post = jest.fn();
      const client = createClientStub(post);
      const wallet = { privateKey: 'PRIVATE_KEY_HEX' };
      const tokenWithoutDecimals = createCustomAsset({ decimals: undefined, uniqueName: 'Tron/BAD' });

      let error: unknown;
      try {
        await proto.sendToken.call(client, wallet, 'ADDR_01', tokenWithoutDecimals, 5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect((error as Error).message).toBe('No decimals found in token Tron/BAD');
      expect(post).not.toHaveBeenCalled();
    });

    it('returns the txId when the gateway call succeeds', async () => {
      const post = jest.fn().mockResolvedValue({ txId: 'TX_HASH_02' });
      const client = createClientStub(post);
      const wallet = { privateKey: 'PRIVATE_KEY_HEX' };

      const txId = await proto.sendToken.call(client, wallet, 'ADDR_01', token, 5);

      expect(txId).toBe('TX_HASH_02');
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('wraps a gateway rejection into a TxBroadcastError (fail-closed: sign+broadcast are atomic)', async () => {
      const cause = new Error('gateway rejected the trc20 tx');
      const post = jest.fn().mockRejectedValue(cause);
      const client = createClientStub(post);
      const wallet = { privateKey: 'PRIVATE_KEY_HEX' };

      let error: unknown;
      try {
        await proto.sendToken.call(client, wallet, 'ADDR_01', token, 5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('gateway rejected the trc20 tx');
      expect((error as TxBroadcastError).cause).toBe(cause);
    });

    it('wraps a non-Error rejection using String(e)', async () => {
      const post = jest.fn().mockRejectedValue('plain string rejection');
      const client = createClientStub(post);
      const wallet = { privateKey: 'PRIVATE_KEY_HEX' };

      let error: unknown;
      try {
        await proto.sendToken.call(client, wallet, 'ADDR_01', token, 5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('plain string rejection');
    });

    it('wraps a 200 response without a txId into a TxBroadcastError (fail-closed silent failure)', async () => {
      const post = jest.fn().mockResolvedValue({});
      const client = createClientStub(post);
      const wallet = { privateKey: 'PRIVATE_KEY_HEX' };

      let error: unknown;
      try {
        await proto.sendToken.call(client, wallet, 'ADDR_01', token, 5);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Tron broadcast returned an empty txId');
    });
  });
});

describe('TronClient - isConfigured', () => {
  it('follows the Tatum API key, which every request sends as x-api-key', () => {
    const client = Object.create(TronClient.prototype);
    const apiKey = Config.blockchain.tron.tronApiKey;

    try {
      Config.blockchain.tron.tronApiKey = undefined;
      expect(client.isConfigured).toBe(false);

      Config.blockchain.tron.tronApiKey = 'TATUM_API_KEY';
      expect(client.isConfigured).toBe(true);
    } finally {
      Config.blockchain.tron.tronApiKey = apiKey;
    }
  });
});
