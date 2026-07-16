/**
 * Focused unit tests for LightningService#sendTransfer post-send response mapping.
 *
 * After the LND send call has been reached, a missing/empty/unparseable payment_hash is ambiguous
 * (payment may already have succeeded) and must surface as TxBroadcastError. An in-band
 * payment_error ("no route") remains a plain Error so invoice payouts can self-heal.
 */

import { mock } from 'jest-mock-extended';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { HttpService } from 'src/shared/services/http.service';
import { LightningClient } from '../../lightning-client';
import { LightningService } from '../lightning.service';

jest.mock('src/config/config', () => {
  const mockConfig = {
    blockchain: {
      lightning: {
        certificate: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----',
        lnd: { apiUrl: 'https://lnd.test', adminMacaroon: 'mac' },
      },
    },
  };
  return {
    Config: mockConfig,
    GetConfig: () => mockConfig,
  };
});

describe('LightningService#sendTransfer — post-send payment_hash mapping', () => {
  let service: LightningService;
  let client: LightningClient;
  let sendByInvoiceSpy: jest.SpyInstance;
  let sendByPublicKeySpy: jest.SpyInstance;

  beforeEach(() => {
    const http = mock<HttpService>();
    client = mock<LightningClient>();
    service = new LightningService(http);
    // Replace the internal client used by sendTransfer with our mock
    (service as any).client = client;

    sendByInvoiceSpy = jest.spyOn(client, 'sendPaymentByInvoice');
    sendByPublicKeySpy = jest.spyOn(client, 'sendPaymentByPublicKey');
    jest.spyOn(service, 'getInvoiceByLnurlp').mockResolvedValue('lnbc1invoice');
    jest.spyOn(service, 'getInvoiceByLndhub').mockResolvedValue('lnbc1invoice');
    jest.spyOn(service, 'getPublicKeyOfAddress').mockResolvedValue('03pubkey');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the hex payment hash on a successful invoice payment', async () => {
    sendByInvoiceSpy.mockResolvedValue({ payment_hash: 'aGFzaA==', payment_error: '' });

    await expect(service.sendTransfer('LNURL1dp68gurn8ghj7', 0.001)).resolves.toBe(
      Buffer.from('aGFzaA==', 'base64').toString('hex'),
    );
  });

  it('throws a plain Error on in-band payment_error (self-heal: payment was not routed)', async () => {
    sendByInvoiceSpy.mockResolvedValue({ payment_hash: '', payment_error: 'FAILURE_REASON_NO_ROUTE' });

    let error: unknown;
    try {
      await service.sendTransfer('LNURL1dp68gurn8ghj7', 0.001);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TxBroadcastError);
    expect((error as Error).message).toContain('FAILURE_REASON_NO_ROUTE');
  });

  it('wraps a missing payment_hash after send into a TxBroadcastError (fail-closed)', async () => {
    sendByInvoiceSpy.mockResolvedValue({ payment_error: '' } as any);

    let error: unknown;
    try {
      await service.sendTransfer('LNURL1dp68gurn8ghj7', 0.001);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(TxBroadcastError);
    expect((error as TxBroadcastError).message).toBe('Lightning broadcast returned an empty payment hash');
  });

  it('wraps an empty payment_hash after send into a TxBroadcastError (fail-closed)', async () => {
    sendByInvoiceSpy.mockResolvedValue({ payment_hash: '', payment_error: '' });

    let error: unknown;
    try {
      await service.sendTransfer('LNURL1dp68gurn8ghj7', 0.001);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(TxBroadcastError);
    expect((error as TxBroadcastError).message).toBe('Lightning broadcast returned an empty payment hash');
  });

  it('wraps an unparseable payment_hash (Buffer.from throws) into a TxBroadcastError (fail-closed)', async () => {
    sendByInvoiceSpy.mockResolvedValue({ payment_hash: { not: 'a string' } as any, payment_error: '' });

    let error: unknown;
    try {
      await service.sendTransfer('LNURL1dp68gurn8ghj7', 0.001);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(TxBroadcastError);
  });

  it('wraps a missing payment_hash on keysend into a TxBroadcastError (fail-closed)', async () => {
    sendByPublicKeySpy.mockResolvedValue({ payment_error: '' } as any);

    let error: unknown;
    try {
      await service.sendTransfer('LNNID03aabbccddeeff', 0.001);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(TxBroadcastError);
    expect((error as TxBroadcastError).message).toBe('Lightning broadcast returned an empty payment hash');
  });

  it('wraps a missing payment_hash on LND_HUB into a TxBroadcastError (fail-closed)', async () => {
    sendByInvoiceSpy.mockResolvedValue({ payment_hash: '', payment_error: '' });

    let error: unknown;
    try {
      await service.sendTransfer('LNDHUB1dp68gurn8ghj7', 0.001);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(TxBroadcastError);
    expect((error as TxBroadcastError).message).toBe('Lightning broadcast returned an empty payment hash');
  });
});
