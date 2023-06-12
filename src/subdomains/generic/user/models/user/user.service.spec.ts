import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { DfiTaxService } from 'src/integration/blockchain/ain/services/dfi-tax.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { Asset, FeeTier } from 'src/shared/models/asset/asset.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { KycService } from '../kyc/kyc.service';
import { AccountType } from '../user-data/account-type.enum';
import { UserDataRepository } from '../user-data/user-data.repository';
import { UserDataService } from '../user-data/user-data.service';
import { WalletService } from '../wallet/wallet.service';
import { User } from './user.entity';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;

  let userRepo: UserRepository;
  let userDataRepo: UserDataRepository;
  let userDataService: UserDataService;
  let fiatService: FiatService;
  let kycService: KycService;
  let walletService: WalletService;
  let settingService: SettingService;
  let dfiTaxService: DfiTaxService;
  let geoLocationService: GeoLocationService;
  let countryService: CountryService;
  let cryptoService: CryptoService;
  let apiKeyService: ApiKeyService;

  function setup(accountType: AccountType, buyFee?: number, usedRef?: string, cryptoFee?: number, sellFee?: number) {
    jest
      .spyOn(userRepo, 'findOne')
      .mockResolvedValue({ buyFee, usedRef, cryptoFee, userData: { accountType: accountType }, sellFee } as User);
  }

  beforeEach(async () => {
    userRepo = createMock<UserRepository>();
    userDataRepo = createMock<UserDataRepository>();
    userDataService = createMock<UserDataService>();
    fiatService = createMock<FiatService>();
    kycService = createMock<KycService>();
    walletService = createMock<WalletService>();
    settingService = createMock<SettingService>();
    dfiTaxService = createMock<DfiTaxService>();
    geoLocationService = createMock<GeoLocationService>();
    countryService = createMock<CountryService>();
    cryptoService = createMock<CryptoService>();
    apiKeyService = createMock<ApiKeyService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: userRepo },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: UserDataService, useValue: userDataService },
        { provide: FiatService, useValue: fiatService },
        { provide: KycService, useValue: kycService },
        { provide: WalletService, useValue: walletService },
        { provide: SettingService, useValue: settingService },
        { provide: DfiTaxService, useValue: dfiTaxService },
        { provide: GeoLocationService, useValue: geoLocationService },
        { provide: CountryService, useValue: countryService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: ApiKeyService, useValue: apiKeyService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // tier 0 buy
  it('should return personal tier0 buy fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER0 } as Asset)).resolves.toStrictEqual(0);
  });

  // tier 0 sell
  it('should return personal tier0 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER0 } as Asset)).resolves.toStrictEqual(0);
  });

  // tier 1 buy
  it('should return personal tier1 buy fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual(0.0099);
  });

  it('should return business tier1 buy fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual(0.0149);
  });

  it('should return business tier1 buy fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual(0.0149);
  });

  // tier 1 sell
  it('should return personal tier1 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual(0.0149);
  });

  it('should return business tier1 sell fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual(0.0199);
  });

  it('should return business tier1 sell fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual(0.0199);
  });

  // tier 2 buy
  it('should return personal tier2 buy fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual(0.0149);
  });

  it('should return business tier2 buy fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual(0.0199);
  });

  it('should return business tier2 buy fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual(0.0199);
  });

  // tier 2 sell
  it('should return personal tier2 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual(0.0199);
  });

  it('should return business tier2 sell fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual(0.0249);
  });

  it('should return business tier2 sell fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual(0.0249);
  });

  // tier 3 buy
  it('should return personal tier3 buy fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual(0.0225);
  });

  it('should return business tier3 buy fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual(0.0275);
  });

  it('should return business tier3 buy fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual(0.0275);
  });

  // tier 3 sell
  it('should return personal tier3 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual(0.0275);
  });

  it('should return business tier3 sell fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual(0.0325);
  });

  it('should return business tier3 sell fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual(0.0325);
  });

  // tier 4 buy
  it('should return personal tier4 buy fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual(0.0299);
  });

  it('should return business tier4 buy fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual(0.0349);
  });

  it('should return business tier4 buy fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual(0.0349);
  });

  // tier 4 sell
  it('should return personal tier4 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual(0.0349);
  });

  it('should return business tier4 sell fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual(0.0399);
  });

  it('should return business tier4 sell fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual(0.0399);
  });

  // individual fee
  it('should return 0.005 when individual fee 0.005', async () => {
    setup(AccountType.PERSONAL, 0.005);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual(0.005);
  });

  it('should return 0.005 when individual fee 0.005', async () => {
    setup(AccountType.PERSONAL, undefined, undefined, undefined, 0.005);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual(0.005);
  });

  // crypto fee
  it('should return a fee of 0.0099 for crypto routes, if cryptoFee is not defined', async () => {
    setup(AccountType.PERSONAL, undefined, undefined);

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual(0.0099);
  });

  it('should return custom fee for crypto routes, if cryptoFee is defined', async () => {
    setup(AccountType.PERSONAL, undefined, undefined, 0.005);

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual(0.005);
  });
});
