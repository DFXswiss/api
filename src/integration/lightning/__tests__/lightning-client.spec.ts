/**
 * Focused unit test for the LightningClient broadcast boundary: the try/catch tightly wrapping the
 * actual LND send-payment POST (sendPaymentByInvoice / sendPaymentByPublicKey), which translates a
 * transport/timeout failure into a TxBroadcastError - the request may already have reached LND
 * before the connection dropped. An in-band payment failure (LND responds 200 with payment_error
 * set) is deliberately NOT this layer's concern: it resolves normally here and is turned into a
 * plain, self-healing error one layer up, in LightningService#sendTransfer (see
 * lightning.service.ts), since LND has then provably NOT routed the payment.
 */

import { mock } from 'jest-mock-extended';
import { ConfigService } from 'src/config/config';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { HttpService } from 'src/shared/services/http.service';
import { LightningClient } from '../lightning-client';

describe('LightningClient - broadcast boundary', () => {
  let http: HttpService;
  let client: LightningClient;
  let postSpy: jest.SpyInstance;

  beforeAll(() => {
    new ConfigService(); // sets module-level Config (LND api URL + TLS agent construction)
  });

  beforeEach(() => {
    http = mock<HttpService>();
    postSpy = jest.spyOn(http, 'post');
    client = new LightningClient(http);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendPaymentByInvoice(...)', () => {
    it('returns the LND response on a successful POST', async () => {
      const response = { payment_hash: 'aGFzaA==', payment_error: '' };
      postSpy.mockResolvedValue(response);

      const result = await client.sendPaymentByInvoice('lnbc1invoice');

      expect(result).toBe(response);
    });

    it('does NOT wrap an in-band payment_error response - it resolves normally, letting the caller (LightningService#sendTransfer) throw a plain, self-healing error', async () => {
      const response = { payment_hash: '', payment_error: 'FAILURE_REASON_NO_ROUTE' };
      postSpy.mockResolvedValue(response);

      const result = await client.sendPaymentByInvoice('lnbc1invoice');

      expect(result).toBe(response); // no throw here - in-band failure is not this layer's concern
    });

    it('wraps an Error thrown by the HTTP POST into a TxBroadcastError, preserving message and cause (fail-closed: request already sent)', async () => {
      const transportError = new Error('socket hang up');
      postSpy.mockRejectedValue(transportError);

      let error: unknown;
      try {
        await client.sendPaymentByInvoice('lnbc1invoice');
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('socket hang up');
      expect((error as TxBroadcastError).cause).toBe(transportError);
    });

    it('wraps a non-Error rejection from the HTTP POST into a TxBroadcastError via String(e)', async () => {
      postSpy.mockRejectedValue('ETIMEDOUT');

      let error: unknown;
      try {
        await client.sendPaymentByInvoice('lnbc1invoice');
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('ETIMEDOUT');
      expect((error as TxBroadcastError).cause).toBe('ETIMEDOUT');
    });
  });

  describe('sendPaymentByPublicKey(...)', () => {
    it('returns the LND response on a successful POST', async () => {
      const response = { payment_hash: 'aGFzaA==', payment_error: '' };
      postSpy.mockResolvedValue(response);

      const result = await client.sendPaymentByPublicKey('02aabbccddeeff', 0.001);

      expect(result).toBe(response);
    });

    it('does NOT wrap an in-band payment_error response - it resolves normally, letting the caller (LightningService#sendTransfer) throw a plain, self-healing error', async () => {
      const response = { payment_hash: '', payment_error: 'FAILURE_REASON_NO_ROUTE' };
      postSpy.mockResolvedValue(response);

      const result = await client.sendPaymentByPublicKey('02aabbccddeeff', 0.001);

      expect(result).toBe(response);
    });

    it('wraps an Error thrown by the HTTP POST into a TxBroadcastError, preserving message and cause (fail-closed: request already sent)', async () => {
      const transportError = new Error('ECONNRESET');
      postSpy.mockRejectedValue(transportError);

      let error: unknown;
      try {
        await client.sendPaymentByPublicKey('02aabbccddeeff', 0.001);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('ECONNRESET');
      expect((error as TxBroadcastError).cause).toBe(transportError);
    });

    it('wraps a non-Error rejection from the HTTP POST into a TxBroadcastError via String(e)', async () => {
      postSpy.mockRejectedValue('ETIMEDOUT');

      let error: unknown;
      try {
        await client.sendPaymentByPublicKey('02aabbccddeeff', 0.001);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('ETIMEDOUT');
      expect((error as TxBroadcastError).cause).toBe('ETIMEDOUT');
    });
  });
});
