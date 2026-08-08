import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { Config } from 'src/config/config';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import {
  FiatRepublicPaymentDirection,
  FiatRepublicPaymentResponse,
  FiatRepublicPaymentStatus,
  FiatRepublicWebhookPayload,
} from '../../dto/fiat-republic.dto';
import { FiatRepublicWebhookService } from '../fiat-republic-webhook.service';

const SECRET = 'synthetic-webhook-secret';

function signatureFor(body: string, secret = SECRET, created = 1642873384): Record<string, string> {
  const digest = createHash('sha1').update(body).digest('hex');
  const params = `("digest");created=${created}`;
  const base = `"digest": "${digest}"\n@signature-params: ${params}`;
  const hmac = Util.createHmac(secret, base, 'sha256', 'hex');

  return { digest, signatureInput: `fr1=${params}`, signature: `fr1=:${hmac}:` };
}

function payment(overrides: Partial<FiatRepublicPaymentResponse> = {}): FiatRepublicPaymentResponse {
  return {
    id: 'pmt_synthetic',
    direction: FiatRepublicPaymentDirection.PAYIN,
    reference: 'DFX-SYNTHETIC',
    amount: '100.00',
    currency: 'EUR',
    paymentScheme: 'SCT',
    status: FiatRepublicPaymentStatus.COMPLETED,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function event(
  overrides: Partial<FiatRepublicWebhookPayload<FiatRepublicPaymentResponse>> = {},
): FiatRepublicWebhookPayload<FiatRepublicPaymentResponse> {
  return {
    id: 'evt_synthetic',
    event: 'PAYMENT.STATUS_UPDATED',
    data: payment(),
    createdAt: 3,
    ...overrides,
  };
}

describe('FiatRepublicWebhookService', () => {
  let service: FiatRepublicWebhookService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [FiatRepublicWebhookService, TestUtil.provideConfig()],
    }).compile();

    service = module.get<FiatRepublicWebhookService>(FiatRepublicWebhookService);
    Config.bank.fiatRepublic.webhookSecret = SECRET;
  });

  afterEach(() => {
    Config.bank.fiatRepublic.webhookSecret = undefined;
    jest.restoreAllMocks();
  });

  describe('isValidSignature', () => {
    it('accepts a correctly signed body', () => {
      const body = JSON.stringify(event());

      expect(service.isValidSignature(body, signatureFor(body))).toBe(true);
    });

    it('accepts a raw Buffer body', () => {
      const body = JSON.stringify(event());

      expect(service.isValidSignature(Buffer.from(body, 'utf8'), signatureFor(body))).toBe(true);
    });

    it('rejects everything when no webhook secret is configured', () => {
      const body = JSON.stringify(event());
      const headers = signatureFor(body);
      Config.bank.fiatRepublic.webhookSecret = undefined;

      expect(service.isValidSignature(body, headers)).toBe(false);
    });

    it('rejects a body that was tampered with after signing', () => {
      const headers = signatureFor(JSON.stringify(event()));

      expect(service.isValidSignature(JSON.stringify(event({ data: payment({ amount: '999.00' }) })), headers)).toBe(
        false,
      );
    });

    it('rejects a signature produced with a different secret', () => {
      const body = JSON.stringify(event());

      expect(service.isValidSignature(body, signatureFor(body, 'other-secret'))).toBe(false);
    });

    it('rejects a mismatching digest header even when the signature itself is valid', () => {
      const body = JSON.stringify(event());
      const headers = signatureFor(body);

      expect(service.isValidSignature(body, { ...headers, digest: 'deadbeef' })).toBe(false);
    });

    it('accepts a valid signature when the digest header is absent', () => {
      const body = JSON.stringify(event());
      const { signatureInput, signature } = signatureFor(body);

      expect(service.isValidSignature(body, { signatureInput, signature })).toBe(true);
    });

    it.each([
      ['signature-input missing', { signature: 'fr1=:abc:' }],
      ['signature missing', { signatureInput: 'fr1=("digest");created=1' }],
      ['both missing', {}],
      ['signature-input unlabelled', { signatureInput: '("digest");created=1', signature: 'fr1=:abc:' }],
      ['signature unlabelled', { signatureInput: 'fr1=("digest");created=1', signature: ':abc:' }],
      ['signature label without a value', { signatureInput: 'fr1=("digest");created=1', signature: 'fr1=::' }],
    ])('rejects a malformed header set (%s)', (_name, headers) => {
      expect(service.isValidSignature(JSON.stringify(event()), headers)).toBe(false);
    });

    it('rejects a signature of a different length without throwing', () => {
      const body = JSON.stringify(event());
      const { signatureInput } = signatureFor(body);

      expect(service.isValidSignature(body, { signatureInput, signature: 'fr1=:short:' })).toBe(false);
    });

    it('rejects when the signature-input recipe was altered', () => {
      const body = JSON.stringify(event());
      const headers = signatureFor(body);

      expect(service.isValidSignature(body, { ...headers, signatureInput: 'fr1=("digest");created=9999999999' })).toBe(
        false,
      );
    });
  });

  describe('processWebhook', () => {
    it('emits completed payins', async () => {
      const emitted = firstValueFrom(service.getPaymentObservable());

      service.processWebhook(event());

      await expect(emitted).resolves.toMatchObject({ id: 'pmt_synthetic' });
    });

    it('emits a payin that is still under compliance review — the subscriber decides what to book', async () => {
      const emitted = firstValueFrom(service.getPaymentObservable());

      service.processWebhook(event({ data: payment({ status: FiatRepublicPaymentStatus.COMPLIANCE_REVIEW }) }));

      await expect(emitted).resolves.toMatchObject({ status: FiatRepublicPaymentStatus.COMPLIANCE_REVIEW });
    });

    it.each([
      ['a non-payment event', event({ event: 'FIAT_ACCOUNT.UPDATED' })],
      ['a payout', event({ data: payment({ direction: FiatRepublicPaymentDirection.PAYOUT }) })],
      ['an event without a name', event({ event: undefined })],
    ])('ignores %s', (_name, payload) => {
      const next = jest.fn();
      service.getPaymentObservable().subscribe(next);

      service.processWebhook(payload);

      expect(next).not.toHaveBeenCalled();
    });

    it('ignores a payment event without a payment id and does not throw', () => {
      const next = jest.fn();
      service.getPaymentObservable().subscribe(next);

      service.processWebhook(event({ data: undefined }));

      expect(next).not.toHaveBeenCalled();
    });

    it('ignores a null payload', () => {
      const next = jest.fn();
      service.getPaymentObservable().subscribe(next);

      service.processWebhook(undefined);

      expect(next).not.toHaveBeenCalled();
    });

    it('wraps an unexpected failure without echoing the payload', () => {
      const payload = event();
      Object.defineProperty(payload, 'data', {
        get() {
          throw new Error('synthetic failure');
        },
      });

      expect(() => service.processWebhook(payload)).toThrow(InternalServerErrorException);
    });
  });
});
