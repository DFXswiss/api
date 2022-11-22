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

describe('UserService', () => {
  let service: UserService;

  let userRepo: UserRepository;
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

  function setup(
    accountType: AccountType,
    refFeePercent?: number,
    buyFee?: number,
    usedRef?: string,
    cryptoFee?: number,
  ) {
    jest
      .spyOn(userRepo, 'findOne')
      .mockResolvedValue({ refFeePercent, buyFee, usedRef, cryptoFee, userData: { accountType: accountType } } as User);
  }

  beforeEach(async () => {
    userRepo = createMock<UserRepository>();
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

  // ref bonus
  it('should return no bonus when no ref user', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, 0)).resolves.toStrictEqual({ fee: 2.9, refBonus: 0 });
  });

  it('should return 0.5% bonus from ref user', async () => {
    setup(AccountType.BUSINESS, 0.5);

    await expect(service.getUserBuyFee(1, 0)).resolves.toStrictEqual({ fee: 2.4, refBonus: 0.5 });
  });

  it('should return 0.9% bonus from ref user', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP, 0.1);

    await expect(service.getUserBuyFee(1, 0)).resolves.toStrictEqual({ fee: 2.0, refBonus: 0.9 });
  });

  // volume
  it('should return 2.9 when volume < 5000', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, 4999.99)).resolves.toStrictEqual({ fee: 2.9, refBonus: 0 });
  });

  it('should return 1.75 when volume = 5000, personal and ref user', async () => {
    setup(AccountType.PERSONAL, 0.1);

    await expect(service.getUserBuyFee(1, 5000)).resolves.toStrictEqual({ fee: 1.75, refBonus: 0.9 });
  });

  it('should return 2% when volume = 5000, organization and ref user', async () => {
    setup(AccountType.BUSINESS, 0.1);

    await expect(service.getUserBuyFee(1, 5000)).resolves.toStrictEqual({ fee: 2, refBonus: 0.9 });
  });

  it('should return 2.4 when volume > 50000 and personal', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, 64358)).resolves.toStrictEqual({ fee: 2.4, refBonus: 0 });
  });

  it('should return 2.9 when volume > 50000 and organization', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP);

    await expect(service.getUserBuyFee(1, 64358)).resolves.toStrictEqual({ fee: 2.9, refBonus: 0 });
  });

  // > 100'000
  it('should return 2.3 and no bonus when volume > 100000, personal and no ref user', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserBuyFee(1, 100000)).resolves.toStrictEqual({ fee: 2.3, refBonus: 0 });
  });

  it('should return 1.8 when volume > 100000, personal and ref user', async () => {
    setup(AccountType.PERSONAL, 0.5);

    await expect(service.getUserBuyFee(1, 100000)).resolves.toStrictEqual({ fee: 1.8, refBonus: 0.5 });
  });

  it('should return 2.9 and no bonus when volume > 100000, organization and no ref user', async () => {
    setup(AccountType.BUSINESS);

    await expect(service.getUserBuyFee(1, 100000)).resolves.toStrictEqual({ fee: 2.9, refBonus: 0 });
  });

  it('should return 2 when volume > 100000, organization and ref user', async () => {
    setup(AccountType.SOLE_PROPRIETORSHIP, 0.1);

    await expect(service.getUserBuyFee(1, 100000)).resolves.toStrictEqual({ fee: 2, refBonus: 0.9 });
  });

  // individual fee
  it('should return 0.5 when individual fee 0.005', async () => {
    setup(AccountType.PERSONAL, 0.1, 0.005);

    await expect(service.getUserBuyFee(1, 23467)).resolves.toStrictEqual({ fee: 0.5, refBonus: 0 });
  });

  it('should return a fee of 1.2 and refBonus of 0 for crypto routes, if no ref was used', async () => {
    setup(AccountType.PERSONAL, undefined, undefined, '000-000');

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual({ fee: 1.2, refBonus: 0 });
  });

  it('should return a fee of 1.2 and refBonus of 0 for crypto routes, if ref is undefined', async () => {
    setup(AccountType.PERSONAL);

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual({ fee: 1.2, refBonus: 0 });
  });

  it('should return a fee of 1.1 and refBonus of 0.1 for crypto routes, if ref was used', async () => {
    setup(AccountType.PERSONAL, undefined, undefined, '000-001');

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual({ fee: 1.1, refBonus: 0.1 });
  });

  it('should return a fee of 0.5 and refBonus of 0 for crypto routes, if cryptoFee is defined', async () => {
    setup(AccountType.PERSONAL, undefined, undefined, '000-001', 0.005);

    await expect(service.getUserCryptoFee(1)).resolves.toStrictEqual({ fee: 0.5, refBonus: 0 });
  });
});
