import { RequestTimeoutException } from '@nestjs/common';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import * as ConfigModule from 'src/config/config';
import { PaymentLinkPayment } from '../../entities/payment-link-payment.entity';
import { PaymentLinkPaymentRepository } from '../../repositories/payment-link-payment.repository';
import { PaymentActivationService } from '../payment-activation.service';
import { PaymentLinkPaymentService } from '../payment-link-payment.service';
import { PaymentQuoteService } from '../payment-quote.service';
import { PaymentWebhookService } from '../payment-webhook.service';

const WAIT_TIMEOUT = 110;

describe('PaymentLinkPaymentService', () => {
  let service: PaymentLinkPaymentService;

  beforeEach(() => {
    (ConfigModule as Record<string, unknown>).Config = { payment: { waitTimeout: WAIT_TIMEOUT } };

    service = new PaymentLinkPaymentService(
      {} as unknown as FiatService,
      {} as unknown as PaymentLinkPaymentRepository,
      {} as unknown as PaymentWebhookService,
      {} as unknown as PaymentQuoteService,
      {} as unknown as PaymentActivationService,
      {} as unknown as BlockchainRegistryService,
    );

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --- waitForPayment() Tests --- //

  describe('waitForPayment()', () => {
    it('should return the payment when it resolves within the wait window', async () => {
      const resolved = { id: 1, status: 'Completed' } as unknown as PaymentLinkPayment;

      const wait = service.waitForPayment({ id: 1 } as PaymentLinkPayment);
      service['paymentWaitMap'].resolve(1, resolved);

      await expect(wait).resolves.toBe(resolved);
    });

    it('should answer 408 instead of blocking indefinitely on a payment that stays pending', async () => {
      // Without the cap the request hangs until the payment resolves — for a long-lived
      // invoice that is years away — and is killed by the CDN with a 524 the caller
      // cannot interpret.
      const wait = service.waitForPayment({ id: 2 } as PaymentLinkPayment);
      const assertion = expect(wait).rejects.toBeInstanceOf(RequestTimeoutException);

      await jest.advanceTimersByTimeAsync(WAIT_TIMEOUT * 1000);

      await assertion;
    });

    it('should pass a rejection of the wait itself through instead of reporting it as a timeout', async () => {
      const wait = service.waitForPayment({ id: 4 } as PaymentLinkPayment);
      const assertion = expect(wait).rejects.toThrow('Payment gone');

      service['paymentWaitMap'].reject(4, 'Payment gone');

      await assertion;
    });

    it('should give a caller joining a pending payment its own full window', async () => {
      // AsyncMap hands both callers the same subscriber. Arming the timeout there would
      // let the first caller's timer decide for the second one, cutting the late joiner
      // off after a second instead of giving it the full window.
      const first = service.waitForPayment({ id: 3 } as PaymentLinkPayment);
      const firstTimedOut = expect(first).rejects.toBeInstanceOf(RequestTimeoutException);
      await jest.advanceTimersByTimeAsync((WAIT_TIMEOUT - 1) * 1000);

      const second = service.waitForPayment({ id: 3 } as PaymentLinkPayment);
      let secondSettled = false;
      void second.then(
        () => (secondSettled = true),
        () => (secondSettled = true),
      );

      await jest.advanceTimersByTimeAsync(2 * 1000);

      await firstTimedOut;
      expect(secondSettled).toBe(false);

      const resolved = { id: 3, status: 'Completed' } as unknown as PaymentLinkPayment;
      service['paymentWaitMap'].resolve(3, resolved);

      await expect(second).resolves.toBe(resolved);
    });
  });
});
