import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Deposit } from 'src/subdomains/supporting/address-pool/deposit/deposit.entity';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { SellService } from '../../sell-crypto/route/sell.service';
import { CreatePaymentLinkPaymentDto } from '../dto/create-payment-link-payment.dto';
import { CreatePaymentLinkDto } from '../dto/create-payment-link.dto';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkPaymentMode } from '../enums';
import { PaymentLinkPaymentRepository } from '../repositories/payment-link-payment.repository';
import { PaymentLinkRepository } from '../repositories/payment-link.repository';

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

    const fiat = new Fiat();
    fiat.name = 'CHF';

    const sellRoute = new Sell();
    sellRoute.deposit = deposit;
    sellRoute.fiat = fiat;
    sellRoute.user = PaymentTestHelper.createUser();

    jest.spyOn(sellServiceMock, 'get').mockResolvedValue(sellRoute);
    jest.spyOn(sellServiceMock, 'getById').mockResolvedValue(sellRoute);
    jest.spyOn(sellServiceMock, 'getLatest').mockResolvedValue(sellRoute);

    return sellRoute;
  }

  static spyOnPaymentLinkRepo(paymentLinkRepo: PaymentLinkRepository): PaymentLink {
    const paymentLink = new PaymentLink();

    jest
      .spyOn(paymentLinkRepo, 'create')
      .mockImplementation((data) => Object.assign(paymentLink, data, { uniqueId: 'x_12345' }));
    jest.spyOn(paymentLinkRepo, 'save').mockImplementation(async (data) => Object.assign(paymentLink, data, { id: 1 }));

    jest.spyOn(paymentLinkRepo, 'existsBy').mockImplementation(async () => false);
    jest.spyOn(paymentLinkRepo, 'getPaymentLinkById').mockImplementation(async () => paymentLink);
    jest.spyOn(paymentLinkRepo, 'getPaymentLinkByExternalId').mockImplementation(async () => paymentLink);

    return paymentLink;
  }

  static spyOnPaymentLinkPaymentRepo(paymentLinkPaymentRepo: PaymentLinkPaymentRepository): PaymentLinkPayment {
    const paymentLinkPayment = new PaymentLinkPayment();

    jest
      .spyOn(paymentLinkPaymentRepo, 'create')
      .mockImplementation((data) => Object.assign(paymentLinkPayment, data, { uniqueId: 'y_98765' }));
    jest
      .spyOn(paymentLinkPaymentRepo, 'save')
      .mockImplementation(async (data) => Object.assign(paymentLinkPayment, data, { id: 1 }));

    jest.spyOn(paymentLinkPaymentRepo, 'findOne').mockImplementation(async (find) => {
      return find.where['uniqueId'] === 'y_98765' ? paymentLinkPayment : undefined;
    });
    jest.spyOn(paymentLinkPaymentRepo, 'existsBy').mockImplementation(async () => false);

    return paymentLinkPayment;
  }
}
