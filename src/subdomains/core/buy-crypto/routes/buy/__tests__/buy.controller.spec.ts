import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { createDefaultCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { CountryService } from 'src/shared/models/country/country.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { createDefaultUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { createDefaultWallet } from 'src/subdomains/generic/user/models/wallet/__mocks__/wallet.entity.mock';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { BuyCryptoService } from '../../../process/services/buy-crypto.service';
import { createDefaultBuy } from '../__mocks__/buy.entity.mock';
import { BuyController } from '../buy.controller';
import { BuyService } from '../buy.service';
import { GetBuyPaymentInfoDto } from '../dto/get-buy-payment-info.dto';

function createBuyPaymentInfoDto(
  amount = 1,
  targetAmount = 1,
  currency: Fiat = { id: 1 } as Fiat,
): GetBuyPaymentInfoDto {
  return {
    iban: 'DE123456786',
    asset: { id: 1 } as Asset,
    amount: amount,
    targetAmount: targetAmount,
    currency: currency,
    paymentMethod: FiatPaymentMethod.BANK,
    exactPrice: false,
  };
}

function createJwt(): JwtPayload {
  return {
    user: 0,
    address: '',
    role: UserRole.USER,
    blockchains: [Blockchain.DEFICHAIN],
    ip: '127.0.0.0',
  };
}

describe('BuyController', () => {
  let controller: BuyController;

  let buyService: BuyService;
  let userService: UserService;
  let buyCryptoService: BuyCryptoService;
  let countryService: CountryService;
  let bankAccountService: BankAccountService;
  let bankService: BankService;
  let paymentInfoService: PaymentInfoService;
  let transactionHelper: TransactionHelper;
  let checkoutService: CheckoutService;
  let transactionRequestService: TransactionRequestService;
  let fiatService: FiatService;
  let swissQrService: SwissQRService;

  beforeEach(async () => {
    buyService = createMock<BuyService>();
    userService = createMock<UserService>();
    buyCryptoService = createMock<BuyCryptoService>();
    countryService = createMock<CountryService>();
    bankAccountService = createMock<BankAccountService>();
    bankService = createMock<BankService>();
    paymentInfoService = createMock<PaymentInfoService>();
    transactionHelper = createMock<TransactionHelper>();
    checkoutService = createMock<CheckoutService>();
    transactionRequestService = createMock<TransactionRequestService>();
    fiatService = createMock<FiatService>();
    swissQrService = createMock<SwissQRService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyController,
        { provide: BuyService, useValue: buyService },
        { provide: UserService, useValue: userService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: CountryService, useValue: countryService },
        { provide: BankAccountService, useValue: bankAccountService },
        { provide: BankService, useValue: bankService },
        { provide: PaymentInfoService, useValue: paymentInfoService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: CheckoutService, useValue: checkoutService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: FiatService, useValue: fiatService },
        { provide: SwissQRService, useValue: swissQrService },

        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<BuyController>(BuyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return DFX address info', async () => {
    jest.spyOn(buyService, 'createBuy').mockResolvedValue(createDefaultBuy());
    jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createDefaultCountry());
    jest.spyOn(userService, 'getUser').mockResolvedValue(
      createCustomUser({
        wallet: createDefaultWallet(),
        userData: createDefaultUserData(),
      }),
    );
    jest.spyOn(transactionHelper, 'getTxDetails').mockResolvedValue({
      minVolume: 0,
      minVolumeTarget: 0,
      exchangeRate: 10,
      feeSource: { rate: 2.9, fixed: 0, network: 0, min: 0, total: 0, dfx: 0, networkStart: 0, bank: 0 },
      feeTarget: { rate: 2.9, fixed: 0, network: 0, min: 0, total: 0, dfx: 0, networkStart: 0, bank: 0 },
      rate: 0.2,
      estimatedAmount: 100,
      sourceAmount: 50,
      isValid: true,
      maxVolume: 90000,
      maxVolumeTarget: 0,
      error: undefined,
      exactPrice: false,
      priceSteps: [],
      timestamp: new Date(),
    });

    const dto = createBuyPaymentInfoDto();

    jest.spyOn(paymentInfoService, 'buyCheck').mockImplementation(async (dto) => dto);

    await expect(controller.createBuyWithPaymentInfo(createJwt(), dto)).resolves.toMatchObject({
      name: 'DFX AG',
      street: 'Bahnhofstrasse',
      number: '7',
      zip: '6300',
      city: 'Zug',
      country: 'Schweiz',
    });
  });
});
