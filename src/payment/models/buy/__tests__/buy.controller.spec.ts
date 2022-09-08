import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { BuyService } from '../buy.service';
import { BuyController } from '../buy.controller';
import { UserService } from 'src/user/models/user/user.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { StakingRepository } from '../../staking/staking.repository';
import { StakingService } from '../../staking/staking.service';
import { BuyCryptoService } from '../../buy-crypto/services/buy-crypto.service';
import { createDefaultBuy } from './mock/buy.entity.mock';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { TestUtil } from 'src/shared/test.util';
import { GetBuyPaymentInfoDto } from '../dto/get-buy-payment-info.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { BankAccountService } from '../../bank-account/bank-account.service';
import { createCustomFiat, createDefaultFiat } from 'src/shared/models/fiat/__tests__/mock/fiat.entity.mock';
import {
  createCustomCountry,
  createDefaultCountry,
} from 'src/shared/models/country/__tests__/mock/country.entity.mock';

function createBuyPaymentInfoDto(amount: number = 1, currency: Fiat = { id: 1 } as Fiat): GetBuyPaymentInfoDto {
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

  beforeEach(async () => {
    buyService = createMock<BuyService>();
    userService = createMock<UserService>();
    stakingRepo = createMock<StakingRepository>();
    stakingService = createMock<StakingService>();
    buyCryptoService = createMock<BuyCryptoService>();
    fiatService = createMock<FiatService>();
    countryService = createMock<CountryService>();
    bankAccountService = createMock<BankAccountService>();

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

  it('should return BF if amount > 9000', async () => {
    jest.spyOn(buyService, 'createBuy').mockResolvedValue(createDefaultBuy());
    jest.spyOn(fiatService, 'getFiat').mockResolvedValue(createCustomFiat({ name: 'CHF' }));
    jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createDefaultCountry());

    await expect(
      controller.createBuyWithPaymentInfo(createJwt(), createBuyPaymentInfoDto(10000)),
    ).resolves.toMatchObject({
      iban: 'LI52088110104693K000C',
      bic: 'BFRILI22',
    });
  });

  it('should return BF if currency = USD', async () => {
    jest.spyOn(buyService, 'createBuy').mockResolvedValue(createDefaultBuy());
    jest.spyOn(fiatService, 'getFiat').mockResolvedValue(createCustomFiat({ name: 'USD' }));
    jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createDefaultCountry());

    await expect(controller.createBuyWithPaymentInfo(createJwt(), createBuyPaymentInfoDto())).resolves.toMatchObject({
      iban: 'LI51088110104693K000U',
      bic: 'BFRILI22',
    });
  });

  it('should return Olkypay if currency = EUR & sctInst', async () => {
    jest.spyOn(buyService, 'createBuy').mockResolvedValue(createDefaultBuy());
    jest.spyOn(fiatService, 'getFiat').mockResolvedValue(createCustomFiat({ name: 'EUR' }));
    jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(createDefaultCountry());

    await expect(controller.createBuyWithPaymentInfo(createJwt(), createBuyPaymentInfoDto())).resolves.toMatchObject({
      iban: 'LU116060002000005040',
      bic: 'OLKILUL1',
    });
  });

  it('should return MB if ibanCountry = MBCountry & userDataCountry = MBCountry', async () => {
    jest.spyOn(buyService, 'createBuy').mockResolvedValue(createDefaultBuy());
    jest.spyOn(fiatService, 'getFiat').mockResolvedValue(createCustomFiat({ name: 'CHF' }));
    jest
      .spyOn(countryService, 'getCountryWithSymbol')
      .mockResolvedValue(createCustomCountry({ maerkiBaumannEnable: true }));

    await expect(controller.createBuyWithPaymentInfo(createJwt(), createBuyPaymentInfoDto())).resolves.toMatchObject({
      iban: 'CH3408573177975200001',
      bic: 'MAEBCHZZ',
    });
  });

  it('should return BF as default', async () => {
    jest.spyOn(buyService, 'createBuy').mockResolvedValue(createDefaultBuy());
    jest.spyOn(fiatService, 'getFiat').mockResolvedValue(createCustomFiat({ name: 'GBP' }));
    jest
      .spyOn(countryService, 'getCountryWithSymbol')
      .mockResolvedValue(createCustomCountry({ maerkiBaumannEnable: false }));

    await expect(controller.createBuyWithPaymentInfo(createJwt(), createBuyPaymentInfoDto())).resolves.toMatchObject({
      iban: 'LI95088110104693K000E',
      bic: 'BFRILI22',
    });
  });
});
