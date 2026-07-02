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
import { Config } from 'src/config/config';
import { RefService } from 'src/subdomains/core/referral/process/ref.service';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { CustodyProviderService } from '../../custody-provider/custody-provider.service';
import { RecommendationService } from '../../recommendation/recommendation.service';
import { createCustomUserData } from '../../user-data/__mocks__/user-data.entity.mock';
import { UserData } from '../../user-data/user-data.entity';
import { KycLevel, UserDataStatus } from '../../user-data/user-data.enum';
import { UserDataService } from '../../user-data/user-data.service';
import { createCustomUser } from '../../user/__mocks__/user.entity.mock';
import { UserRepository } from '../../user/user.repository';
import { UserService } from '../../user/user.service';
import { WalletService } from '../../wallet/wallet.service';
import { AuthService, MailKeyData } from '../auth.service';

describe('AuthService', () => {
  let service: AuthService;

  const jwtServiceMock = mock<JwtService>();
  const ipLogServiceMock = mock<IpLogService>();
  const userDataServiceMock = mock<UserDataService>();
  const settingServiceMock = mock<SettingService>();
  const kycServiceMock = mock<KycService>();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        // completeSignInByMail builds an absolute session/error URL from Config.frontend.services, so it must
        // be a valid absolute URL or new URL(...) would throw and every success case would fall into the catch.
        TestUtil.provideConfig({ frontend: { services: 'https://services.test' } }),
        { provide: UserService, useValue: mock<UserService>() },
        { provide: UserRepository, useValue: mock<UserRepository>() },
        { provide: WalletService, useValue: mock<WalletService>() },
        { provide: CustodyProviderService, useValue: mock<CustodyProviderService>() },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: CryptoService, useValue: mock<CryptoService>() },
        { provide: RefService, useValue: mock<RefService>() },
        { provide: FeeService, useValue: mock<FeeService>() },
        { provide: UserDataService, useValue: userDataServiceMock },
        { provide: NotificationService, useValue: mock<NotificationService>() },
        { provide: IpLogService, useValue: ipLogServiceMock },
        { provide: SiftService, useValue: mock<SiftService>() },
        { provide: LanguageService, useValue: mock<LanguageService>() },
        { provide: GeoLocationService, useValue: mock<GeoLocationService>() },
        { provide: SettingService, useValue: settingServiceMock },
        { provide: RecommendationService, useValue: mock<RecommendationService>() },
        { provide: KycAdminService, useValue: mock<KycAdminService>() },
        { provide: KycService, useValue: kycServiceMock },
        AuthService,
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // completeSignInByMail turns a valid magic-link code into a session URL. Staff accounts (support/compliance/
  // realunit) are elevated to a full user token carrying their real role; regular and blocked/deactivated
  // accounts keep a plain account token. It is the security-critical entry point of the mail-login role
  // feature, so all of its branches are covered here in isolation.
  describe('completeSignInByMail', () => {
    const code = 'code';
    const ip = '1.2.3.4';

    // private test setup (repo convention, cf. lnurl-auth.spec.ts using (service as any).authCache)
    const setKey = (overrides: Partial<MailKeyData> = {}): void => {
      (service as any).mailKeyList.set(code, {
        created: new Date(),
        key: code,
        mail: 'test@test.com',
        userDataId: 1,
        loginUrl: 'https://login.test',
        ...overrides,
      });
    };

    const account = (overrides: Partial<UserData> = {}): UserData =>
      createCustomUserData({
        id: 1,
        status: UserDataStatus.NA,
        kycLevel: KycLevel.LEVEL_0,
        tradeApprovalDate: new Date(),
        users: [],
        ...overrides,
      });

    const staffUser = (role = UserRole.SUPPORT) => createCustomUser({ id: 7, role, address: 'STAFF_ADDR' });
    const regularUser = () => createCustomUser({ id: 1, role: UserRole.USER, address: 'USER_ADDR' });

    const signPayload = () => jwtServiceMock.sign.mock.calls[0][0] as any;

    beforeEach(() => {
      jest.clearAllMocks();
      (service as any).mailKeyList.clear();

      jwtServiceMock.sign.mockReturnValue('signed-jwt');
      ipLogServiceMock.create.mockResolvedValue({ result: true } as any);
      settingServiceMock.getIpBlacklist.mockResolvedValue([]);
      kycServiceMock.initializeProcess.mockResolvedValue(undefined);
      userDataServiceMock.updateUserDataInternal.mockResolvedValue(undefined as any);
    });

    it('elevates an active staff account to a user token (generateUserToken)', async () => {
      setKey();
      userDataServiceMock.getUserData.mockResolvedValue(
        account({ users: [regularUser(), staffUser(UserRole.SUPPORT)] }),
      );

      const result = await service.completeSignInByMail(code, ip);

      expect(result).toBe('https://services.test/account?session=signed-jwt');
      const payload = signPayload();
      expect(payload.role).toBe(UserRole.SUPPORT);
      expect(payload.user).toBe(7);
      expect(payload.address).toBe('STAFF_ADDR');
      expect(payload.account).toBe(1);
      // stamped so TfaGuard keeps enforcing 2FA on this token even if the flag is later disabled
      expect(payload.tfaRequired).toBe(true);
    });

    it('keeps a regular account on an account token and survives a failing KYC init', async () => {
      setKey();
      // no tradeApprovalDate -> exercises the checkPendingRecommendation branch as well
      userDataServiceMock.getUserData.mockResolvedValue(
        account({ tradeApprovalDate: undefined, users: [regularUser()] }),
      );
      kycServiceMock.initializeProcess.mockRejectedValue(new Error('kyc down'));

      const result = await service.completeSignInByMail(code, ip);

      // token is generated before the KYC step, so a failing KYC init still yields a session URL
      expect(result).toBe('https://services.test/account?session=signed-jwt');
      const payload = signPayload();
      expect(payload.role).toBe(UserRole.ACCOUNT);
      expect(payload.account).toBe(1);
      expect(payload.user).toBeUndefined();
      expect(payload.address).toBeUndefined();
    });

    it('never elevates a blocked account despite a staff user and honours redirectUri', async () => {
      setKey({ redirectUri: 'https://redirect.test/callback' });
      userDataServiceMock.getUserData.mockResolvedValue(
        account({ status: UserDataStatus.BLOCKED, users: [staffUser(UserRole.COMPLIANCE)] }),
      );

      const result = await service.completeSignInByMail(code, ip);

      expect(result).toBe('https://redirect.test/callback?session=signed-jwt');
      expect(signPayload().role).toBe(UserRole.ACCOUNT);
    });

    it('reactivates a deactivated account and issues an account token (no escalation)', async () => {
      setKey();
      userDataServiceMock.getUserData.mockResolvedValue(
        account({ status: UserDataStatus.DEACTIVATED, users: [staffUser(UserRole.SUPPORT)] }),
      );

      const result = await service.completeSignInByMail(code, ip);

      expect(result).toBe('https://services.test/account?session=signed-jwt');
      expect(signPayload().role).toBe(UserRole.ACCOUNT);
      expect(userDataServiceMock.updateUserDataInternal).toHaveBeenCalledTimes(1);
    });

    it('returns an error URL for an expired/invalid code without issuing a token', async () => {
      // no mailKeyList entry -> entry is undefined -> isMailKeyValid(entry) is false
      const result = await service.completeSignInByMail(code, ip);

      expect(result).toBe('https://services.test/error?msg=Login%20link%20expired');
      expect(jwtServiceMock.sign).not.toHaveBeenCalled();
      expect(userDataServiceMock.getUserData).not.toHaveBeenCalled();
    });

    it('returns an error URL for a merged account', async () => {
      setKey();
      userDataServiceMock.getUserData.mockResolvedValue(account({ status: UserDataStatus.MERGED }));

      const result = await service.completeSignInByMail(code, ip);

      expect(result).toBe('https://services.test/error?msg=User%20data%20is%20merged');
      expect(jwtServiceMock.sign).not.toHaveBeenCalled();
    });

    it('returns an error URL when the IP country is not allowed', async () => {
      setKey();
      userDataServiceMock.getUserData.mockResolvedValue(account({ users: [regularUser()] }));
      ipLogServiceMock.create.mockResolvedValue({ result: false } as any);

      const result = await service.completeSignInByMail(code, ip);

      expect(result).toBe('https://services.test/error?msg=The%20country%20of%20IP%20address%20is%20not%20allowed');
      expect(jwtServiceMock.sign).not.toHaveBeenCalled();
    });

    it('never elevates a terminated/rejected account (negative kycLevel counts as blocked)', async () => {
      setKey();
      userDataServiceMock.getUserData.mockResolvedValue(
        account({ kycLevel: KycLevel.TERMINATED, users: [staffUser(UserRole.COMPLIANCE)] }),
      );

      const result = await service.completeSignInByMail(code, ip);

      expect(result).toBe('https://services.test/account?session=signed-jwt');
      expect(signPayload().role).toBe(UserRole.ACCOUNT);
    });

    it('consumes the code so the magic link cannot be replayed (one-time use)', async () => {
      setKey();
      userDataServiceMock.getUserData.mockResolvedValue(account({ users: [staffUser()] }));

      const first = await service.completeSignInByMail(code, ip);
      const second = await service.completeSignInByMail(code, ip);

      expect(first).toBe('https://services.test/account?session=signed-jwt');
      expect(second).toBe('https://services.test/error?msg=Login%20link%20expired');
    });

    it('does not elevate staff when the feature flag is off (fail-closed kill-switch)', async () => {
      setKey();
      userDataServiceMock.getUserData.mockResolvedValue(account({ users: [staffUser(UserRole.COMPLIANCE)] }));
      Object.assign(Config.auth, { tfaStaffEnforced: false });

      try {
        const result = await service.completeSignInByMail(code, ip);

        // the flag is the elevation kill-switch: with it off a staff account stays on an account token, so no
        // mail-origin tfaRequired token is ever minted and the mail login cannot reach staff functions at all
        expect(result).toBe('https://services.test/account?session=signed-jwt');
        expect(signPayload().role).toBe(UserRole.ACCOUNT);
        expect(signPayload().user).toBeUndefined();
      } finally {
        Object.assign(Config.auth, { tfaStaffEnforced: true });
      }
    });
  });

  describe('changeUser', () => {
    const ip = '1.2.3.4';

    const accountWith = (user: ReturnType<typeof createCustomUser>) => {
      const account = createCustomUserData({
        id: 1,
        status: UserDataStatus.NA,
        tradeApprovalDate: new Date(),
        users: [user],
      });
      user.userData = account;
      return account;
    };

    beforeEach(() => {
      jest.clearAllMocks();
      jwtServiceMock.sign.mockReturnValue('signed-jwt');
    });

    it('forwards tfaRequired into the re-minted token (mail-origin staff session)', async () => {
      const staff = createCustomUser({ id: 7, role: UserRole.SUPPORT, address: 'STAFF_ADDR' });
      userDataServiceMock.getUserData.mockResolvedValue(accountWith(staff));

      await service.changeUser(1, { address: 'STAFF_ADDR' } as any, ip, true);

      expect((jwtServiceMock.sign.mock.calls[0][0] as any).tfaRequired).toBe(true);
    });

    it('leaves tfaRequired unset for a session that did not require 2FA', async () => {
      const user = createCustomUser({ id: 7, role: UserRole.USER, address: 'USER_ADDR' });
      userDataServiceMock.getUserData.mockResolvedValue(accountWith(user));

      await service.changeUser(1, { address: 'USER_ADDR' } as any, ip);

      expect((jwtServiceMock.sign.mock.calls[0][0] as any).tfaRequired).toBeUndefined();
    });
  });
});
