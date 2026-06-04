import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { UserDataRepository } from '../../user-data/user-data.repository';
import { UserDataService } from '../../user-data/user-data.service';
import { WalletService } from '../../wallet/wallet.service';
import { UserRepository } from '../user.repository';
import { UserService } from '../user.service';

describe('UserService', () => {
  let service: UserService;

  let userRepo: UserRepository;
  let userDataRepo: UserDataRepository;
  let userDataService: UserDataService;
  let walletService: WalletService;
  let geoLocationService: GeoLocationService;
  let notificationService: NotificationService;
  let countryService: CountryService;
  let cryptoService: CryptoService;
  let feeService: FeeService;
  let languageService: LanguageService;
  let fiatService: FiatService;
  let tfaService: TfaService;
  let siftService: SiftService;
  let kycAdminService: KycAdminService;
  let assetService: AssetService;

  beforeEach(async () => {
    userRepo = createMock<UserRepository>();
    userDataRepo = createMock<UserDataRepository>();
    userDataService = createMock<UserDataService>();
    walletService = createMock<WalletService>();
    geoLocationService = createMock<GeoLocationService>();
    notificationService = createMock<NotificationService>();
    countryService = createMock<CountryService>();
    cryptoService = createMock<CryptoService>();
    feeService = createMock<FeeService>();
    languageService = createMock<LanguageService>();
    fiatService = createMock<FiatService>();
    tfaService = createMock<TfaService>();
    siftService = createMock<SiftService>();
    kycAdminService = createMock<KycAdminService>();
    assetService = createMock<AssetService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: userRepo },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: UserDataService, useValue: userDataService },
        { provide: WalletService, useValue: walletService },
        { provide: GeoLocationService, useValue: geoLocationService },
        { provide: NotificationService, useValue: notificationService },
        { provide: CountryService, useValue: countryService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: FeeService, useValue: feeService },
        { provide: LanguageService, useValue: languageService },
        { provide: FiatService, useValue: fiatService },
        { provide: TfaService, useValue: tfaService },
        { provide: SiftService, useValue: siftService },
        { provide: KycAdminService, useValue: kycAdminService },
        { provide: AssetService, useValue: assetService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getNewUserCount', () => {
    function mockQueryBuilder(count: number): { andWhere: jest.Mock; getCount: jest.Mock } {
      const query = {
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(count),
      };
      (userRepo.createQueryBuilder as jest.Mock).mockReturnValue(query);
      return query;
    }

    it('returns the count without any date filter', async () => {
      const query = mockQueryBuilder(100);

      const result = await service.getNewUserCount();

      expect(result).toBe(100);
      expect(query.andWhere).not.toHaveBeenCalled();
      expect(query.getCount).toHaveBeenCalledTimes(1);
    });

    it('applies from and to date filters when provided', async () => {
      const query = mockQueryBuilder(12);
      const from = new Date('2024-01-01');
      const to = new Date('2024-02-01');

      const result = await service.getNewUserCount(from, to);

      expect(result).toBe(12);
      expect(query.andWhere).toHaveBeenCalledWith('user.created >= :from', { from });
      expect(query.andWhere).toHaveBeenCalledWith('user.created <= :to', { to });
    });
  });
});
