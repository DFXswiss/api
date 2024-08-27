import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestUtil } from 'src/shared/utils/test.util';
import {
  createCustomPaymentLinkPayment,
  createDefaultPaymentLinkPayment,
} from '../__mocks__/payment-link-payment.entity.mock';
import { createCustomPaymentLink } from '../__mocks__/payment-link.entity.mock';
import { PaymentLinkDtoMapper } from '../dto/payment-link-dto.mapper';
import { PaymentLinkDto } from '../dto/payment-link.dto';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus, PaymentLinkStatus } from '../enums';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';
import { PaymentActivationService } from '../services/payment-activation.service';
import { PaymentLinkPaymentService } from '../services/payment-link-payment.service';
import { PaymentQuoteService } from '../services/payment-quote.service';
import { PaymentWebhookService } from '../services/payment-webhook.service';
import { PaymentTestHelper } from './payment-test.helper';

describe('Payment Webhook', () => {
  let paymentLinkPaymentRepoMock: PaymentLinkPaymentRepository;
  let paymentQuoteServiceMock: PaymentQuoteService;
  let paymentActivationServiceMock: PaymentActivationService;
  let paymentWebhookServiceMock: PaymentWebhookService;
  let fiatServiceMock: FiatService;

  let paymentLinkPaymentService: PaymentLinkPaymentService;

  beforeAll(async () => {
    paymentLinkPaymentRepoMock = createMock<PaymentLinkPaymentRepository>();
    paymentQuoteServiceMock = createMock<PaymentQuoteService>();
    paymentActivationServiceMock = createMock<PaymentActivationService>();
    paymentWebhookServiceMock = createMock<PaymentWebhookService>();
    fiatServiceMock = createMock<FiatService>();

    const config = {
      url: () => 'https://test.dfx.api:12345/v0.1/payment-webhook',
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [],
      providers: [
        TestUtil.provideConfig(config),
        { provide: PaymentLinkPaymentRepository, useValue: paymentLinkPaymentRepoMock },
        { provide: PaymentQuoteService, useValue: paymentQuoteServiceMock },
        { provide: PaymentActivationService, useValue: paymentActivationServiceMock },
        { provide: PaymentWebhookService, useValue: paymentWebhookServiceMock },
        { provide: FiatService, useValue: fiatServiceMock },

        PaymentLinkPaymentService,
      ],
      controllers: [],
    }).compile();

    paymentLinkPaymentService = module.get<PaymentLinkPaymentService>(PaymentLinkPaymentService);
  });

  describe('Payment Link Payment', () => {
    it('create payment should trigger webhook', async () => {
      const paymentLink = createCustomPaymentLink({ webhookUrl: 'https://payment-webhook-test' });
      const payment = createDefaultPaymentLinkPayment();

      jest.spyOn(paymentLinkPaymentRepoMock, 'existsBy').mockImplementation(async () => false);
      jest.spyOn(paymentLinkPaymentRepoMock, 'create').mockImplementation(() => payment);
      jest.spyOn(paymentLinkPaymentRepoMock, 'save').mockImplementation(async () => payment);
      jest.spyOn(paymentLinkPaymentRepoMock, 'findOne').mockImplementation(async () => {
        payment.link = paymentLink;
        return payment;
      });

      let checkPayment: PaymentLinkDto;
      jest.spyOn(paymentWebhookServiceMock, 'sendWebhook').mockImplementation(async (data) => {
        checkPayment = PaymentLinkDtoMapper.toLinkDto(data);
      });

      const dto = PaymentTestHelper.createPaymentLinkPaymentDto();
      await paymentLinkPaymentService.createPayment(paymentLink, dto);

      expect(checkPayment.id).toBe(1);
      expect(checkPayment.routeId).toBe(1);
      expect(checkPayment.externalId).toBe('cash-register-001');
      expect(checkPayment.webhookUrl).toBe('https://payment-webhook-test');
      expect(checkPayment.status).toBe(PaymentLinkStatus.ACTIVE);
      expect(checkPayment.url).toBe('https://test.dfx.api:12345/v0.1/payment-webhook/lnurlp/pl_12345');
      expect(checkPayment.lnurl).toBe(
        'LNURL1DP68GURN8GHJ7AR9WD6ZUERX0QHXZURF8GCNYVE5X5HHVVPWXYHHQCTED4JKUAPDWAJKY6R0DA4J7MRWW4EXCUP0WPK97VFJXV6R2F637F2',
      );

      expect(checkPayment.payment.id).toBe(1);
      expect(checkPayment.payment.externalId).toBe('20240827-00000001');
      expect(checkPayment.payment.status).toBe(PaymentLinkPaymentStatus.PENDING);
      expect(checkPayment.payment.amount).toBe(123.45);
      expect(checkPayment.payment.currency).toBe('CHF');
      expect(checkPayment.payment.mode).toBe(PaymentLinkPaymentMode.SINGLE);
      expect(checkPayment.payment.url).toBe('https://test.dfx.api:12345/v0.1/payment-webhook/lnurlp/plp_1x2y3z');
      expect(checkPayment.payment.lnurl).toBe(
        'LNURL1DP68GURN8GHJ7AR9WD6ZUERX0QHXZURF8GCNYVE5X5HHVVPWXYHHQCTED4JKUAPDWAJKY6R0DA4J7MRWW4EXCUP0WPK8QHE30QE8JVM6QCU59S',
      );
    });

    it('cancel payment should trigger webhook', async () => {
      const paymentLink = createCustomPaymentLink({ webhookUrl: 'https://payment-webhook-test' });
      const payment = createCustomPaymentLinkPayment({ status: PaymentLinkPaymentStatus.PENDING });

      paymentLink.payments.push(createCustomPaymentLinkPayment({ status: PaymentLinkPaymentStatus.EXPIRED }));
      paymentLink.payments.push(createCustomPaymentLinkPayment({ status: PaymentLinkPaymentStatus.COMPLETED }));
      paymentLink.payments.push(payment);

      jest.spyOn(paymentLinkPaymentRepoMock, 'save').mockImplementation(async (data) => Object.assign(payment, data));
      jest.spyOn(paymentLinkPaymentRepoMock, 'findOne').mockImplementation(async () => {
        payment.link = paymentLink;
        return payment;
      });

      let checkPayment: PaymentLinkDto;
      jest.spyOn(paymentWebhookServiceMock, 'sendWebhook').mockImplementation(async (data) => {
        checkPayment = PaymentLinkDtoMapper.toLinkDto(data);
      });

      await paymentLinkPaymentService.cancelPayment(paymentLink);

      expect(checkPayment.id).toBe(1);
      expect(checkPayment.routeId).toBe(1);
      expect(checkPayment.externalId).toBe('cash-register-001');
      expect(checkPayment.webhookUrl).toBe('https://payment-webhook-test');
      expect(checkPayment.status).toBe(PaymentLinkStatus.ACTIVE);
      expect(checkPayment.url).toBe('https://test.dfx.api:12345/v0.1/payment-webhook/lnurlp/pl_12345');
      expect(checkPayment.lnurl).toBe(
        'LNURL1DP68GURN8GHJ7AR9WD6ZUERX0QHXZURF8GCNYVE5X5HHVVPWXYHHQCTED4JKUAPDWAJKY6R0DA4J7MRWW4EXCUP0WPK97VFJXV6R2F637F2',
      );

      expect(checkPayment.payment.id).toBe(1);
      expect(checkPayment.payment.externalId).toBe('20240827-00000001');
      expect(checkPayment.payment.status).toBe(PaymentLinkPaymentStatus.CANCELLED);
      expect(checkPayment.payment.amount).toBe(123.45);
      expect(checkPayment.payment.currency).toBe('CHF');
      expect(checkPayment.payment.mode).toBe(PaymentLinkPaymentMode.SINGLE);
      expect(checkPayment.payment.url).toBe('https://test.dfx.api:12345/v0.1/payment-webhook/lnurlp/plp_1x2y3z');
      expect(checkPayment.payment.lnurl).toBe(
        'LNURL1DP68GURN8GHJ7AR9WD6ZUERX0QHXZURF8GCNYVE5X5HHVVPWXYHHQCTED4JKUAPDWAJKY6R0DA4J7MRWW4EXCUP0WPK8QHE30QE8JVM6QCU59S',
      );
    });
  });
});
