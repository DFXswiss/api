import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { RefService } from 'src/subdomains/core/referral/process/ref.service';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { CustodyProviderService } from '../../custody-provider/custody-provider.service';
import { RecommendationService } from '../../recommendation/recommendation.service';
import { createCustomUserData } from '../../user-data/__mocks__/user-data.entity.mock';
import { UserDataService } from '../../user-data/user-data.service';
import { createCustomUser } from '../../user/__mocks__/user.entity.mock';
import { User } from '../../user/user.entity';
import { UserStatus } from '../../user/user.enum';
import { UserRepository } from '../../user/user.repository';
import { UserService } from '../../user/user.service';
import { WalletService } from '../../wallet/wallet.service';
import { AuthService } from '../auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        { provide: UserService, useValue: mock<UserService>() },
        { provide: UserRepository, useValue: mock<UserRepository>() },
        { provide: WalletService, useValue: mock<WalletService>() },
        { provide: CustodyProviderService, useValue: mock<CustodyProviderService>() },
        { provide: JwtService, useValue: mock<JwtService>() },
        { provide: CryptoService, useValue: mock<CryptoService>() },
        { provide: RefService, useValue: mock<RefService>() },
        { provide: FeeService, useValue: mock<FeeService>() },
        { provide: UserDataService, useValue: mock<UserDataService>() },
        { provide: NotificationService, useValue: mock<NotificationService>() },
        { provide: IpLogService, useValue: mock<IpLogService>() },
        { provide: SiftService, useValue: mock<SiftService>() },
        { provide: LanguageService, useValue: mock<LanguageService>() },
        { provide: GeoLocationService, useValue: mock<GeoLocationService>() },
        { provide: SettingService, useValue: mock<SettingService>() },
        { provide: RecommendationService, useValue: mock<RecommendationService>() },
        { provide: KycAdminService, useValue: mock<KycAdminService>() },
        { provide: KycService, useValue: mock<KycService>() },
        AuthService,
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // getMailLoginStaffUser decides whether a magic-link login is elevated to a staff (user) token. It is
  // the security-critical core of the mail-login role feature, so it is tested in isolation here.
  describe('getMailLoginStaffUser', () => {
    const user = (role: UserRole, overrides: Partial<User> = {}): User => createCustomUser({ role, ...overrides });

    const resolve = (users?: User[]): User | undefined =>
      (service as any).getMailLoginStaffUser(createCustomUserData({ users }));

    it('returns undefined for a regular account (only USER wallets)', () => {
      expect(resolve([user(UserRole.USER, { id: 1 }), user(UserRole.USER, { id: 2 })])).toBeUndefined();
    });

    it('returns the staff user for a support account', () => {
      const support = user(UserRole.SUPPORT, { id: 7 });
      expect(resolve([user(UserRole.USER, { id: 1 }), support])).toBe(support);
    });

    it('elevates a realunit account', () => {
      const realunit = user(UserRole.REALUNIT, { id: 5 });
      expect(resolve([realunit])).toBe(realunit);
    });

    it('prefers the higher-privileged role: COMPLIANCE over SUPPORT', () => {
      const compliance = user(UserRole.COMPLIANCE, { id: 2 });
      const support = user(UserRole.SUPPORT, { id: 3 });
      expect(resolve([support, compliance])).toBe(compliance);
    });

    it('prefers the higher-privileged role: SUPPORT over REALUNIT', () => {
      const support = user(UserRole.SUPPORT, { id: 3 });
      const realunit = user(UserRole.REALUNIT, { id: 4 });
      expect(resolve([realunit, support])).toBe(support);
    });

    it('never elevates ADMIN/SUPER_ADMIN/MARKETING (not in the whitelist)', () => {
      const users = [
        user(UserRole.ADMIN, { id: 1 }),
        user(UserRole.SUPER_ADMIN, { id: 2 }),
        user(UserRole.MARKETING, { id: 3 }),
      ];
      expect(resolve(users)).toBeUndefined();
    });

    it('skips a blocked staff user', () => {
      expect(resolve([user(UserRole.SUPPORT, { id: 3, status: UserStatus.BLOCKED })])).toBeUndefined();
    });

    it('skips a blocked staff user but elevates an active one', () => {
      const compliance = user(UserRole.COMPLIANCE, { id: 9 });
      const blockedSupport = user(UserRole.SUPPORT, { id: 3, status: UserStatus.BLOCKED });
      expect(resolve([blockedSupport, compliance])).toBe(compliance);
    });

    it('skips a staff user without a wallet (token generation would dereference user.wallet)', () => {
      expect(resolve([user(UserRole.SUPPORT, { id: 3, wallet: undefined })])).toBeUndefined();
    });

    it('returns undefined for an empty users list', () => {
      expect(resolve([])).toBeUndefined();
    });

    it('returns undefined when the users relation is not loaded', () => {
      expect(resolve(undefined)).toBeUndefined();
    });
  });
});
