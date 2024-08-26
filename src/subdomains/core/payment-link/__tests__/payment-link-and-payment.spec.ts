import { createMock } from '@golevelup/ts-jest';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { LnUrlForwardService } from 'src/subdomains/generic/forwarding/services/lnurl-forward.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { EntityManager } from 'typeorm';
import { SellService } from '../../sell-crypto/route/sell.service';
import { PaymentLinkController } from '../controllers/payment-link.controller';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus, PaymentLinkStatus } from '../enums';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';
import { PaymentActivationService } from '../services/payment-activation.service';
import { PaymentLinkPaymentService } from '../services/payment-link-payment.service';
import { PaymentLinkService } from '../services/payment-link.service';
import { PaymentQuoteService } from '../services/payment-quote.service';
import { PaymentWebhookService } from '../services/payment-webhook.service';
import { PaymentTestHelper } from './payment-test.helper';

describe('Payment Link', () => {
  let userDataServiceMock: UserDataService;
  let countryServiceMock: CountryService;
  let fiatServiceMock: FiatService;
  let sellServiceMock: SellService;
  let lightningServiceMock: LightningService;

  let jwtPayloadMock: JwtPayload;

  let entityManagerMock: EntityManager;

  let paymentLinkRepo: PaymentLinkRepository;
  let paymentLinkPaymentRepo: PaymentLinkPaymentRepository;

  let paymentLinkController: PaymentLinkController;

  let paymentWebhookServiceMock: PaymentWebhookService;
  let paymentQuoteServiceMock: PaymentQuoteService;
  let paymentActivationServiceMock: PaymentActivationService;

  beforeAll(async () => {
    userDataServiceMock = createMock<UserDataService>();
    countryServiceMock = createMock<CountryService>();
    fiatServiceMock = createMock<FiatService>();
    sellServiceMock = createMock<SellService>();
    lightningServiceMock = createMock<LightningService>();
    paymentWebhookServiceMock = createMock<PaymentWebhookService>();
    paymentQuoteServiceMock = createMock<PaymentQuoteService>();
    paymentActivationServiceMock = createMock<PaymentActivationService>();

    jwtPayloadMock = createMock<JwtPayload>();

    entityManagerMock = createMock<EntityManager>();

    const config = {
      url: () => 'https://test.dfx.api:12345/v0.1',
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt', session: true })],
      providers: [
        TestUtil.provideConfig(config),
        { provide: UserDataService, useValue: userDataServiceMock },
        { provide: CountryService, useValue: countryServiceMock },
        { provide: FiatService, useValue: fiatServiceMock },
        { provide: SellService, useValue: sellServiceMock },
        { provide: LightningService, useValue: lightningServiceMock },
        { provide: PaymentWebhookService, useValue: paymentWebhookServiceMock },
        { provide: PaymentQuoteService, useValue: paymentQuoteServiceMock },
        { provide: PaymentActivationService, useValue: paymentActivationServiceMock },

        { provide: EntityManager, useValue: entityManagerMock },
        PaymentLinkRepository,
        PaymentLinkPaymentRepository,

        LnUrlForwardService,
        PaymentLinkService,
        PaymentLinkPaymentService,
      ],
      controllers: [PaymentLinkController],
    }).compile();

    paymentLinkRepo = module.get<PaymentLinkRepository>(PaymentLinkRepository);
    paymentLinkPaymentRepo = module.get<PaymentLinkPaymentRepository>(PaymentLinkPaymentRepository);

    paymentLinkController = module.get<PaymentLinkController>(PaymentLinkController);

    PaymentTestHelper.spyOnUserData(userDataServiceMock);
    PaymentTestHelper.spyOnCountry(countryServiceMock);
  });

  describe('Create Payment Link', () => {
    it('should throw an exception because of wrong blockchain', async () => {
      PaymentTestHelper.spyOnRoute(sellServiceMock, Blockchain.ETHEREUM);

      jest.spyOn(paymentLinkRepo, 'existsBy').mockImplementation(async () => false);

      const dto = PaymentTestHelper.createPaymentLinkDto();
      const testCall = async () => paymentLinkController.createPaymentLink(jwtPayloadMock, dto);
      await expect(testCall).rejects.toThrowError('Only Lightning routes are allowed');
    });
  });

  it('should create a payment link', async () => {
    PaymentTestHelper.spyOnRoute(sellServiceMock, Blockchain.LIGHTNING);

    PaymentTestHelper.spyOnPaymentLinkRepo(paymentLinkRepo);
    PaymentTestHelper.spyOnPaymentLinkPaymentRepo(paymentLinkPaymentRepo);

    const dto = PaymentTestHelper.createPaymentLinkDto();
    const checkLink = await paymentLinkController.createPaymentLink(jwtPayloadMock, dto);

    expect(checkLink.id).toBe(1);
    expect(checkLink.externalId).toBe('Hello_World');
    expect(checkLink.webhookUrl).toBe('http://test-webhook/wh_112233');
    expect(checkLink.recipient.name).toBe('Testname');
    expect(checkLink.recipient.address.street).toBe('Teststreet');
    expect(checkLink.recipient.address.houseNumber).toBe('Testhousenumber');
    expect(checkLink.recipient.address.zip).toBe('Testzip');
    expect(checkLink.recipient.address.city).toBe('Testcity');
    expect(checkLink.recipient.address.country).toBe('Testcountry');
    expect(checkLink.recipient.phone).toBe('Testphone');
    expect(checkLink.recipient.mail).toBe('Testmail');
    expect(checkLink.recipient.website).toBe('Testwebsite');

    expect(checkLink.status).toBe(PaymentLinkStatus.ACTIVE);
    expect(checkLink.url).toBe('https://test.dfx.api:12345/v0.1/lnurlp/x_12345');
    expect(checkLink.lnurl).toBe(
      'LNURL1DP68GURN8GHJ7AR9WD6ZUERX0QHXZURF8GCNYVE5X5HHVVPWXYHKCMN4WFK8QTMCTUCNYVE5X588FPER',
    );
  });

  it('should create a payment link payment', async () => {
    PaymentTestHelper.spyOnRoute(sellServiceMock, Blockchain.LIGHTNING);

    PaymentTestHelper.spyOnPaymentLinkRepo(paymentLinkRepo);
    PaymentTestHelper.spyOnPaymentLinkPaymentRepo(paymentLinkPaymentRepo);

    const paymentLinkDto = PaymentTestHelper.createPaymentLinkDto();
    const paymentLink = await paymentLinkController.createPaymentLink(jwtPayloadMock, paymentLinkDto);

    const paymentLinkPaymentDto = PaymentTestHelper.createPaymentLinkPaymentDto();
    const checkPayment = await paymentLinkController.createPayment(
      jwtPayloadMock,
      null,
      paymentLink.externalId,
      paymentLinkPaymentDto,
    );

    expect(checkPayment.id).toBe(1);
    expect(checkPayment.externalId).toBe('Hello_World');
    expect(checkPayment.webhookUrl).toBe('http://test-webhook/wh_112233');
    expect(checkPayment.recipient.name).toBe('Testname');
    expect(checkPayment.recipient.address.street).toBe('Teststreet');
    expect(checkPayment.recipient.address.houseNumber).toBe('Testhousenumber');
    expect(checkPayment.recipient.address.zip).toBe('Testzip');
    expect(checkPayment.recipient.address.city).toBe('Testcity');
    expect(checkPayment.recipient.address.country).toBe('Testcountry');
    expect(checkPayment.recipient.phone).toBe('Testphone');
    expect(checkPayment.recipient.mail).toBe('Testmail');
    expect(checkPayment.recipient.website).toBe('Testwebsite');
    expect(checkPayment.status).toBe(PaymentLinkStatus.ACTIVE);
    expect(checkPayment.url).toBe('https://test.dfx.api:12345/v0.1/lnurlp/x_12345');
    expect(checkPayment.lnurl).toBe(
      'LNURL1DP68GURN8GHJ7AR9WD6ZUERX0QHXZURF8GCNYVE5X5HHVVPWXYHKCMN4WFK8QTMCTUCNYVE5X588FPER',
    );

    expect(checkPayment.payment.id).toBe(1);
    expect(checkPayment.payment.externalId).toBe('Hello_Payment_World');
    expect(checkPayment.payment.status).toBe(PaymentLinkPaymentStatus.PENDING);
    expect(checkPayment.payment.amount).toBe(111.22);
    expect(checkPayment.payment.currency).toBe('CHF');
    expect(checkPayment.payment.mode).toBe(PaymentLinkPaymentMode.SINGLE);
    expect(checkPayment.payment.url).toBe('https://test.dfx.api:12345/v0.1/lnurlp/y_98765');
    expect(checkPayment.payment.lnurl).toBe(
      'LNURL1DP68GURN8GHJ7AR9WD6ZUERX0QHXZURF8GCNYVE5X5HHVVPWXYHKCMN4WFK8QTMETUUNSDEKX5VJHJEV',
    );
  });
});
