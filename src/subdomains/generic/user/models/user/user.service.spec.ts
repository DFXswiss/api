import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { UserDataService } from '../user-data/user-data.service';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';
import { KycService } from '../kyc/kyc.service';
import { WalletService } from '../wallet/wallet.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { AccountType } from '../user-data/account-type.enum';
import { User } from './user.entity';
import { DfiTaxService } from 'src/integration/blockchain/ain/services/dfi-tax.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { CryptoService } from 'src/integration/blockchain/ain/services/crypto.service';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { Asset, FeeTier } from 'src/shared/models/asset/asset.entity';
import { UserDataRepository } from '../user-data/user-data.repository';

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

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER0 } as Asset)).resolves.toStrictEqual({ fee: 0 });
  });

  // tier 0 sell
  it('should return personal tier0 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER0 } as Asset)).resolves.toStrictEqual({ fee: 0 });
  });

  // tier 1 buy
  it('should return personal tier1 buy fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual({ fee: 0.99 });
  });

  it('should return business tier1 buy fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual({ fee: 1.49 });
  });

  it('should return business tier1 buy fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual({ fee: 1.49 });
  });

  // tier 1 sell
  it('should return personal tier1 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual({ fee: 1.49 });
  });

  it('should return business tier1 sell fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual({ fee: 1.99 });
  });

  it('should return business tier1 sell fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual({ fee: 1.99 });
  });

  // tier 2 buy
  it('should return personal tier2 buy fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual({ fee: 1.49 });
  });

  it('should return business tier2 buy fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual({ fee: 1.99 });
  });

  it('should return business tier2 buy fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual({ fee: 1.99 });
  });

  // tier 2 sell
  it('should return personal tier2 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual({ fee: 1.99 });
  });

  it('should return business tier2 sell fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual({ fee: 2.49 });
  });

  it('should return business tier2 sell fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER2 } as Asset)).resolves.toStrictEqual({ fee: 2.49 });
  });

  // tier 3 buy
  it('should return personal tier3 buy fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual({ fee: 2.25 });
  });

  it('should return business tier3 buy fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual({ fee: 2.75 });
  });

  it('should return business tier3 buy fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual({ fee: 2.75 });
  });

  // tier 3 sell
  it('should return personal tier3 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual({ fee: 2.75 });
  });

  it('should return business tier3 sell fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual({ fee: 3.25 });
  });

  it('should return business tier3 sell fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER3 } as Asset)).resolves.toStrictEqual({ fee: 3.25 });
  });

  // tier 4 buy
  it('should return personal tier4 buy fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual({ fee: 2.99 });
  });

  it('should return business tier4 buy fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual({ fee: 3.49 });
  });

  it('should return business tier4 buy fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual({ fee: 3.49 });
  });

  // tier 4 sell
  it('should return personal tier4 sell fee', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual({ fee: 3.49 });
  });

  it('should return business tier4 sell fee', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual({ fee: 3.99 });
  });

  it('should return business tier4 sell fee', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER4 } as Asset)).resolves.toStrictEqual({ fee: 3.99 });
  });

  // individual fee
  it('should return 0.5 when individual fee 0.005', async () => {
    setup(AccountType.PERSONAL, 0.005);

    await expect(service.getUserBuyFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual({ fee: 0.5 });
  });

  it('should return 0.5 when individual fee 0.005', async () => {
    setup(AccountType.PERSONAL, undefined, undefined, undefined, 0.005);

    await expect(service.getUserSellFee(1, { feeTier: FeeTier.TIER1 } as Asset)).resolves.toStrictEqual({ fee: 0.5 });
  });

  // crypto fee

  it('should return a fee of 1.2 and refBonus of 0 for crypto routes, if no ref was used', async () => {
    setup(AccountType.PERSONAL, undefined, '000-000');

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual({ fee: 0, refBonus: 0 });
  });

  it('should return a fee of 1.2 and refBonus of 0 for crypto routes, if ref is undefined', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual({ fee: 0, refBonus: 0 });
  });

  it('should return a fee of 1.1 and refBonus of 0.1 for crypto routes, if ref was used', async () => {
    setup(AccountType.PERSONAL, undefined, '000-001');

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual({ fee: 0, refBonus: 0 });
  });

  it('should return a fee of 0.5 and refBonus of 0 for crypto routes, if cryptoFee is defined', async () => {
    setup(AccountType.PERSONAL, undefined, '000-001', 0.005);

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual({ fee: 0, refBonus: 0 });
  });
});
