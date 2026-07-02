import { mock } from 'jest-mock-extended';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { createCustomUserData } from '../../../user/models/user-data/__mocks__/user-data.entity.mock';
import { UserData } from '../../../user/models/user-data/user-data.entity';
import { KycLevel, UserDataStatus } from '../../../user/models/user-data/user-data.enum';
import { UserDataService } from '../../../user/models/user-data/user-data.service';
import { createCustomUser } from '../../../user/models/user/__mocks__/user.entity.mock';
import { TfaType } from '../../dto/output/setup-2fa.dto';
import { TfaLogRepository } from '../../repositories/tfa-log.repository';
import { TfaLevel, TfaService } from '../tfa.service';

// TfaService is the enforcement core of staff 2FA: staff (Compliance/Support/RealUnit) must use an
// independent app/TOTP factor, never a mail code to the same inbox as the magic-link login, and legacy
// untyped logs must never satisfy a STRICT/staff check.
describe('TfaService', () => {
  let service: TfaService;

  const tfaRepo = mock<TfaLogRepository>();
  const userDataService = mock<UserDataService>();
  const notificationService = mock<NotificationService>();

  const ip = '1.2.3.4';

  const activeUserData = (overrides: Partial<UserData> = {}): UserData =>
    createCustomUserData({
      id: 1,
      status: UserDataStatus.NA,
      kycLevel: KycLevel.LEVEL_0,
      mail: 'staff@dfx.swiss',
      totpSecret: undefined,
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TfaService(tfaRepo, userDataService, notificationService);
    notificationService.sendMail.mockResolvedValue(undefined);
  });

  describe('setup', () => {
    it('forces an app/TOTP factor for a staff account (never mail), even at STRICT with linked wallets', async () => {
      userDataService.getByKycHashOrThrow.mockResolvedValue(
        activeUserData({ users: [createCustomUser({ role: UserRole.SUPPORT })] }),
      );

      const result = await service.setup('hash', TfaLevel.STRICT);

      expect(result.type).toBe(TfaType.APP);
      expect(result.secret).toBeDefined();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('keeps mail 2FA for a regular account with mail and linked wallets', async () => {
      userDataService.getByKycHashOrThrow.mockResolvedValue(
        activeUserData({ users: [createCustomUser({ role: UserRole.USER })] }),
      );

      const result = await service.setup('hash', TfaLevel.STRICT);

      expect(result.type).toBe(TfaType.MAIL);
      expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkVerification', () => {
    const user = { id: 1 } as UserData;
    const withLogs = (...comments: string[]) =>
      tfaRepo.findBy.mockResolvedValue(comments.map((comment) => ({ comment }) as any));

    it('accepts an app-typed STRICT log for a staff (requireApp) check', async () => {
      withLogs('Strict (App)');
      await expect(service.checkVerification(user, ip, TfaLevel.STRICT, true)).resolves.toBeUndefined();
    });

    it('rejects a mail-typed STRICT log for a staff (requireApp) check', async () => {
      withLogs('Strict (Mail)');
      await expect(service.checkVerification(user, ip, TfaLevel.STRICT, true)).rejects.toThrow();
    });

    it('rejects a legacy untyped Verified log for a STRICT check', async () => {
      withLogs('Verified');
      await expect(service.checkVerification(user, ip, TfaLevel.STRICT, false)).rejects.toThrow();
    });

    it('accepts a legacy untyped Verified log for a BASIC check', async () => {
      withLogs('Verified');
      await expect(service.checkVerification(user, ip, TfaLevel.BASIC, false)).resolves.toBeUndefined();
    });

    it('throws when there is no matching log', async () => {
      withLogs();
      await expect(service.checkVerification(user, ip, TfaLevel.STRICT, false)).rejects.toThrow();
    });
  });
});
