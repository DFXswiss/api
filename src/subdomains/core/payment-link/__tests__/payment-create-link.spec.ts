import { createMock } from '@golevelup/ts-jest';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { LnUrlForwardService } from 'src/subdomains/generic/forwarding/services/lnurl-forward.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Deposit } from 'src/subdomains/supporting/address-pool/deposit/deposit.entity';
import { EntityManager } from 'typeorm';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { SellService } from '../../sell-crypto/route/sell.service';
import { PaymentLinkController } from '../controllers/payment-link.controller';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkStatus } from '../enums';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';
import { PaymentActivationService } from '../services/payment-activation.service';
import { PaymentLinkPaymentService } from '../services/payment-link-payment.service';
import { PaymentLinkService } from '../services/payment-link.service';
import { PaymentQuoteService } from '../services/payment-quote.service';
import { PaymentWebhookService } from '../services/payment-webhook.service';

describe('Payment', () => {
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

    const newPaymentLink = new PaymentLink();

    jest
      .spyOn(paymentLinkRepo, 'create')
      .mockImplementation((data) => Object.assign(newPaymentLink, data, { uniqueId: 'x_12345' }));
    jest
      .spyOn(paymentLinkRepo, 'save')
      .mockImplementation(async (data) => Object.assign(newPaymentLink, data, { id: 1 }));
    jest.spyOn(paymentLinkRepo, 'existsBy').mockImplementation(async () => false);

    jest.spyOn(paymentLinkRepo, 'getPaymentLinkById').mockImplementation(async () => newPaymentLink);
    jest.spyOn(paymentLinkPaymentRepo, 'findOne').mockImplementation();

    const dto = PaymentTestHelper.createPaymentLinkDto();
    const paymentLink = await paymentLinkController.createPaymentLink(jwtPayloadMock, dto);

    expect(paymentLink.id).toBe(1);
    expect(paymentLink.externalId).toBe('Hello_World');
    expect(paymentLink.webhookUrl).toBe('http://test-webhook/wh_112233');
    expect(paymentLink.recipient.name).toBe('Testname');
    expect(paymentLink.recipient.address.street).toBe('Teststreet');
    expect(paymentLink.recipient.address.houseNumber).toBe('Testhousenumber');
    expect(paymentLink.recipient.address.zip).toBe('Testzip');
    expect(paymentLink.recipient.address.city).toBe('Testcity');
    expect(paymentLink.recipient.address.country).toBe('Testcountry');
    expect(paymentLink.recipient.phone).toBe('Testphone');
    expect(paymentLink.recipient.mail).toBe('Testmail');
    expect(paymentLink.recipient.website).toBe('Testwebsite');

    expect(paymentLink.status).toBe(PaymentLinkStatus.ACTIVE);
    expect(paymentLink.url).toBe('https://test.dfx.api:12345/v0.1/lnurlp/x_12345');
    expect(paymentLink.lnurl).toBe(
      'LNURL1DP68GURN8GHJ7AR9WD6ZUERX0QHXZURF8GCNYVE5X5HHVVPWXYHKCMN4WFK8QTMCTUCNYVE5X588FPER',
    );
  });
});

class PaymentTestHelper {
  static createPaymentLinkDto(): CreatePaymentLinkDto {
    return {
      externalId: 'Hello_World',
      webhookUrl: 'http://test-webhook/wh_112233',
      recipient: {
        name: 'Testname',
        address: {
          street: 'Teststreet',
          houseNumber: 'Testhousenumber',
          zip: 'Testzip',
          city: 'Testcity',
          country: 'Testcountry',
        },
        phone: 'Testphone',
        mail: 'Testmail',
        website: 'Testwebsite',
      },
    };
  }

  static createUser(): User {
    const userData = new UserData();
    userData.paymentLinksAllowed = true;

    const user = new User();
    user.userData = userData;

    return user;
  }

  static spyOnUserData(userDataServiceMock: UserDataService) {
    jest.spyOn(userDataServiceMock, 'getUserData').mockResolvedValue(PaymentTestHelper.createUser().userData);
  }

  static spyOnCountry(countryServiceMock: CountryService) {
    jest.spyOn(countryServiceMock, 'getCountryWithSymbol').mockImplementation(async (data) => {
      const country = new Country();
      country.name = data;
      country.symbol = data;
      return country;
    });
  }

  static spyOnRoute(sellServiceMock: SellService, blockchain: Blockchain): Sell {
    const deposit = new Deposit();
    deposit.blockchains = blockchain;

    const sellRoute = new Sell();
    sellRoute.deposit = deposit;
    sellRoute.user = PaymentTestHelper.createUser();

    jest.spyOn(sellServiceMock, 'get').mockResolvedValue(sellRoute);
    jest.spyOn(sellServiceMock, 'getById').mockResolvedValue(sellRoute);
    jest.spyOn(sellServiceMock, 'getLatest').mockResolvedValue(sellRoute);

    return sellRoute;
  }
}
