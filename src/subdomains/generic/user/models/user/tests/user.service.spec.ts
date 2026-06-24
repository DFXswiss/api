import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
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
import { In, SelectQueryBuilder } from 'typeorm';
import { UserDataRepository } from '../../user-data/user-data.repository';
import { UserDataService } from '../../user-data/user-data.service';
import { WalletService } from '../../wallet/wallet.service';
import { User } from '../user.entity';
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

  function mockQueryBuilder(rows: { id: string; count: string }[]): SelectQueryBuilder<User> {
    const builder = createMock<SelectQueryBuilder<User>>();
    jest.mocked(builder.innerJoin).mockReturnThis();
    jest.mocked(builder.select).mockReturnThis();
    jest.mocked(builder.addSelect).mockReturnThis();
    jest.mocked(builder.where).mockReturnThis();
    jest.mocked(builder.andWhere).mockReturnThis();
    jest.mocked(builder.groupBy).mockReturnThis();
    jest.mocked(builder.getRawMany).mockResolvedValue(rows);
    return builder;
  }

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

  describe('countRefChildrenByUserDataIds', () => {
    it('should return an empty array and not query when no ids are given', async () => {
      const result = await service.countRefChildrenByUserDataIds([]);

      expect(result).toEqual([]);
      expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should map raw string rows to numeric id/count pairs', async () => {
      const builder = mockQueryBuilder([
        { id: '1', count: '3' },
        { id: '2', count: '7' },
      ]);
      jest.mocked(userRepo.createQueryBuilder).mockReturnValue(builder);

      const result = await service.countRefChildrenByUserDataIds([1, 2]);

      expect(result).toEqual([
        { id: 1, count: 3 },
        { id: 2, count: 7 },
      ]);
      expect(typeof result[0].id).toBe('number');
      expect(typeof result[0].count).toBe('number');
      expect(userRepo.createQueryBuilder).toHaveBeenCalledWith('owner');
      expect(builder.getRawMany).toHaveBeenCalled();
      // joins ref-children on the owner's ref, dropping defaultRef, via the :default param
      expect(builder.innerJoin).toHaveBeenCalledWith(
        User,
        'child',
        'child.usedRef = owner.ref AND child.usedRef != :default',
        { default: Config.defaultRef },
      );
      expect(builder.where).toHaveBeenCalledWith('owner.userDataId IN (:...ids)', { ids: [1, 2] });
      expect(builder.andWhere).toHaveBeenCalledWith('owner.ref IS NOT NULL');
      // self-pair guard: a child that is the owner itself must not inflate the count
      expect(builder.andWhere).toHaveBeenCalledWith('child.userDataId != owner.userDataId');
      // no excludeIds -> NOT IN clause omitted
      expect(builder.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('NOT IN'), expect.anything());
    });

    it('adds the NOT IN exclude clause when excludeIds are given', async () => {
      const builder = mockQueryBuilder([{ id: '1', count: '2' }]);
      jest.mocked(userRepo.createQueryBuilder).mockReturnValue(builder);

      await service.countRefChildrenByUserDataIds([1, 2], [3, 4]);

      expect(builder.andWhere).toHaveBeenCalledWith('child.userDataId NOT IN (:...excludeIds)', {
        excludeIds: [3, 4],
      });
    });
  });

  describe('countRefReferrersByUserDataIds', () => {
    it('should return an empty array and not query when no ids are given', async () => {
      const result = await service.countRefReferrersByUserDataIds([]);

      expect(result).toEqual([]);
      expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should map raw string rows to numeric id/count pairs', async () => {
      const builder = mockQueryBuilder([{ id: '9', count: '4' }]);
      jest.mocked(userRepo.createQueryBuilder).mockReturnValue(builder);

      const result = await service.countRefReferrersByUserDataIds([9]);

      expect(result).toEqual([{ id: 9, count: 4 }]);
      expect(typeof result[0].id).toBe('number');
      expect(typeof result[0].count).toBe('number');
      expect(userRepo.createQueryBuilder).toHaveBeenCalledWith('owner');
      expect(builder.getRawMany).toHaveBeenCalled();
      // joins ref-referrers on the owner's usedRef
      expect(builder.innerJoin).toHaveBeenCalledWith(User, 'referrer', 'referrer.ref = owner.usedRef');
      expect(builder.where).toHaveBeenCalledWith('owner.userDataId IN (:...ids)', { ids: [9] });
      // owner.usedRef must not be the defaultRef, via the :default param
      expect(builder.andWhere).toHaveBeenCalledWith('owner.usedRef != :default', { default: Config.defaultRef });
      // self-pair guard: a referrer that is the owner itself must not inflate the count
      expect(builder.andWhere).toHaveBeenCalledWith('referrer.userDataId != owner.userDataId');
      expect(builder.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('NOT IN'), expect.anything());
    });

    it('adds the NOT IN exclude clause when excludeIds are given', async () => {
      const builder = mockQueryBuilder([{ id: '9', count: '1' }]);
      jest.mocked(userRepo.createQueryBuilder).mockReturnValue(builder);

      await service.countRefReferrersByUserDataIds([9], [6, 7]);

      expect(builder.andWhere).toHaveBeenCalledWith('referrer.userDataId NOT IN (:...excludeIds)', {
        excludeIds: [6, 7],
      });
    });
  });

  describe('getUsersByUsedRefs', () => {
    it('should return an empty array and not query when no custom refs remain after filtering', async () => {
      const result = await service.getUsersByUsedRefs([Config.defaultRef, '', undefined as unknown as string]);

      expect(result).toEqual([]);
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    it('should strip defaultRef/empty refs and query the remaining custom refs', async () => {
      const users = [{ id: 1 } as User, { id: 2 } as User];
      jest.mocked(userRepo.find).mockResolvedValue(users);

      const result = await service.getUsersByUsedRefs([Config.defaultRef, '', 'aaa-111', 'bbb-222']);

      expect(result).toBe(users);
      expect(userRepo.find).toHaveBeenCalledWith({
        where: { usedRef: In(['aaa-111', 'bbb-222']) },
        relations: { userData: true },
      });
    });
  });
});
