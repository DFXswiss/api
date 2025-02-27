import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Deposit } from 'src/subdomains/supporting/address-pool/deposit/deposit.entity';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentActivation } from '../entities/payment-activation.entity';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentQuote } from '../entities/payment-quote.entity';
import { PaymentLinkPaymentMode } from '../enums';
import { PaymentActivationRepository } from '../repositories/payment-activation.repository';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';
import { PaymentQuoteRepository } from '../repositories/payment-quote.repository';

export class PaymentTestHelper {
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

  static createPaymentLinkPaymentDto(): CreatePaymentLinkPaymentDto {
    return {
      mode: PaymentLinkPaymentMode.SINGLE,
      amount: 111.22,
      externalId: 'Hello_Payment_World',
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
    jest.spyOn(countryServiceMock, 'getCountryWithSymbol').mockImplementation(async (symbol) => {
      const country = new Country();
      country.name = symbol;
      country.symbol = symbol;
      return country;
    });
  }

  static spyOnRoute(sellServiceMock: SellService, blockchain: Blockchain): Sell {
    const deposit = new Deposit();
    deposit.blockchains = blockchain;

    const sellRoute = new Sell();
    sellRoute.deposit = deposit;
    sellRoute.fiat = createCustomFiat({ name: 'CHF' });
    sellRoute.user = PaymentTestHelper.createUser();

    jest.spyOn(sellServiceMock, 'get').mockResolvedValue(sellRoute);
    jest.spyOn(sellServiceMock, 'getById').mockResolvedValue(sellRoute);
    jest.spyOn(sellServiceMock, 'getLatest').mockResolvedValue(sellRoute);

    return sellRoute;
  }

  static spyOnAsset(assetServiceMock: AssetService): Asset[] {
    const paymenAssets: Asset[] = [
      createCustomAsset({ blockchain: Blockchain.LIGHTNING, name: 'BTC', dexName: 'BTC' }),
      createCustomAsset({ blockchain: Blockchain.ETHEREUM, name: 'ZCHF', dexName: 'ZCHF' }),
      createCustomAsset({ blockchain: Blockchain.POLYGON, name: 'ZCHF', dexName: 'ZCHF' }),
    ];

    jest.spyOn(assetServiceMock, 'getPaymentAssets').mockResolvedValue(paymenAssets);

    return paymenAssets;
  }

  static spyOnPaymentLinkRepo(paymentLinkRepo: PaymentLinkRepository, uniqueId: string): PaymentLink {
    const paymentLink = new PaymentLink();

    jest.spyOn(paymentLinkRepo, 'create').mockImplementation((data) => Object.assign(paymentLink, data, { uniqueId }));
    jest.spyOn(paymentLinkRepo, 'save').mockImplementation(async (data) => Object.assign(paymentLink, data, { id: 1 }));

    jest.spyOn(paymentLinkRepo, 'existsBy').mockImplementation(async () => false);
    jest.spyOn(paymentLinkRepo, 'getPaymentLinkById').mockImplementation(async () => paymentLink);

    return paymentLink;
  }

  static spyOnPaymentLinkPaymentRepo(
    paymentLinkPaymentRepo: PaymentLinkPaymentRepository,
    uniqueId: string,
  ): PaymentLinkPayment {
    const paymentLinkPayment = new PaymentLinkPayment();

    jest
      .spyOn(paymentLinkPaymentRepo, 'create')
      .mockImplementation((data) => Object.assign(paymentLinkPayment, data, { uniqueId }));
    jest
      .spyOn(paymentLinkPaymentRepo, 'save')
      .mockImplementation(async (data) => Object.assign(paymentLinkPayment, data, { id: 1 }));

    jest.spyOn(paymentLinkPaymentRepo, 'findOne').mockImplementation(async (find) => {
      return find.where['uniqueId'] === uniqueId ? paymentLinkPayment : undefined;
    });
    jest.spyOn(paymentLinkPaymentRepo, 'existsBy').mockImplementation(async () => false);

    return paymentLinkPayment;
  }

  static spyOnPaymentQuoteRepo(paymentQuoteRepo: PaymentQuoteRepository, uniqueId: string): PaymentQuote {
    const paymentQuote = new PaymentQuote();

    jest
      .spyOn(paymentQuoteRepo, 'create')
      .mockImplementation((data) => Object.assign(paymentQuote, data, { uniqueId }));
    jest
      .spyOn(paymentQuoteRepo, 'save')
      .mockImplementation(async (data) => Object.assign(paymentQuote, data, { id: 1 }));

    return paymentQuote;
  }

  static spyOnPaymentActivationRepo(paymentActivationRepo: PaymentActivationRepository): PaymentActivation {
    const paymentActivation = new PaymentActivation();

    jest.spyOn(paymentActivationRepo, 'create').mockImplementation((data) => Object.assign(paymentActivation, data));
    jest
      .spyOn(paymentActivationRepo, 'save')
      .mockImplementation(async (data) => Object.assign(paymentActivation, data, { id: 1 }));

    jest.spyOn(paymentActivationRepo, 'findOne').mockImplementation(async () => undefined);

    return paymentActivation;
  }
}
