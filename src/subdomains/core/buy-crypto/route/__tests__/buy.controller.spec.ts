import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { BuyService } from '../buy.service';
import { BuyController } from '../buy.controller';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { createDefaultBuy } from '../__mocks__/buy.entity.mock';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { TestUtil } from 'src/shared/test.util';
import { GetBuyPaymentInfoDto } from '../dto/get-buy-payment-info.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { createDefaultCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BankService } from 'src/shared/models/bank/bank.service';
import { StakingRepository } from 'src/mix/models/staking/staking.repository';
import { StakingService } from 'src/mix/models/staking/staking.service';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { BuyCryptoService } from '../../process/services/buy-crypto.service';

function createBuyPaymentInfoDto(amount = 1, currency: Fiat = { id: 1 } as Fiat): GetBuyPaymentInfoDto {
  return {
    iban: 'DE123456786',
    asset: { id: 1 } as Asset,
    amount: amount,
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
  let stakingRepo: StakingRepository;
  let stakingService: StakingService;
  let buyCryptoService: BuyCryptoService;
  let fiatService: FiatService;
  let countryService: CountryService;
  let bankAccountService: BankAccountService;
  let bankService: BankService;

  beforeEach(async () => {
    buyService = createMock<BuyService>();
    userService = createMock<UserService>();
    stakingRepo = createMock<StakingRepository>();
    stakingService = createMock<StakingService>();
    buyCryptoService = createMock<BuyCryptoService>();
    fiatService = createMock<FiatService>();
    countryService = createMock<CountryService>();
    bankAccountService = createMock<BankAccountService>();
    bankService = createMock<BankService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyController,
        { provide: BuyService, useValue: buyService },
        { provide: UserService, useValue: userService },
        { provide: StakingRepository, useValue: stakingRepo },
        { provide: StakingService, useValue: stakingService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: FiatService, useValue: fiatService },
        { provide: CountryService, useValue: countryService },
        { provide: BankAccountService, useValue: bankAccountService },
        { provide: BankService, useValue: bankService },

        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<BuyController>(BuyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return a min deposit of 1 for a default buy route', async () => {
    jest.spyOn(buyService, 'getUserBuys').mockResolvedValue([createDefaultBuy()]);

    await expect(controller.getAllBuy(createJwt())).resolves.toMatchObject([
      { minDeposits: [{ amount: 1, asset: 'USD' }] },
    ]);
  });

  it('should return DFX address info', async () => {
    jest.spyOn(buyService, 'createBuy').mockResolvedValue(createDefaultBuy());
    jest.spyOn(fiatService, 'getFiat').mockResolvedValue(createDefaultFiat());
    jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createDefaultCountry());

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
