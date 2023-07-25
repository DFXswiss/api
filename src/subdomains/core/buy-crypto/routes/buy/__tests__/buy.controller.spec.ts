import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { createDefaultCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { CountryService } from 'src/shared/models/country/country.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
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
  };
}

function createJwt(): JwtPayload {
  return {
    id: 0,
    address: '',
    role: UserRole.USER,
    blockchains: [Blockchain.DEFICHAIN],
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
  let priceProviderService: PriceProviderService;

  beforeEach(async () => {
    buyService = createMock<BuyService>();
    userService = createMock<UserService>();
    buyCryptoService = createMock<BuyCryptoService>();
    countryService = createMock<CountryService>();
    bankAccountService = createMock<BankAccountService>();
    bankService = createMock<BankService>();
    paymentInfoService = createMock<PaymentInfoService>();
    transactionHelper = createMock<TransactionHelper>();
    priceProviderService = createMock<PriceProviderService>();

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
        { provide: PriceProviderService, useValue: priceProviderService },

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
    jest.spyOn(userService, 'getUserBuyFee').mockResolvedValue(0.01);
    jest.spyOn(transactionHelper, 'getTxDetails').mockResolvedValue({
      minVolume: 0,
      minFee: 0,
      minVolumeTarget: 0,
      minFeeTarget: 0,
      exchangeRate: 10,
      feeAmount: 3,
      estimatedAmount: 100,
      sourceAmount: 50,
    });

    const dto = createBuyPaymentInfoDto();

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
