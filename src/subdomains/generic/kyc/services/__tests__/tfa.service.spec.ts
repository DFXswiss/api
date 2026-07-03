import { ForbiddenException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
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
    it('forces an app/TOTP factor for a staff account (never mail) from a trusted session, even at STRICT', async () => {
      userDataService.getByKycHashOrThrow.mockResolvedValue(
        activeUserData({ users: [createCustomUser({ role: UserRole.SUPPORT })] }),
      );

      const result = await service.setup('hash', TfaLevel.STRICT, true);

      expect(result.type).toBe(TfaType.APP);
      expect(result.secret).toBeDefined();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('forbids a staff first-TOTP enrollment from an untrusted session (default allowStaffEnrollment=false)', async () => {
      userDataService.getByKycHashOrThrow.mockResolvedValue(
        activeUserData({ users: [createCustomUser({ role: UserRole.SUPPORT })] }),
      );

      await expect(service.setup('hash', TfaLevel.STRICT)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a non-staff app enrollment without a trusted session', async () => {
      userDataService.getByKycHashOrThrow.mockResolvedValue(
        activeUserData({ mail: undefined, users: [createCustomUser({ role: UserRole.USER })] }),
      );

      const result = await service.setup('hash', TfaLevel.STRICT);

      expect(result.type).toBe(TfaType.APP);
      expect(result.secret).toBeDefined();
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

  // TfaMaxTryCount = 5: five wrong TOTPs lock the enrolled account for 15 minutes.
  describe('verify (durable TOTP lockout)', () => {
    const enrolledUser = (overrides: Partial<UserData> = {}): UserData =>
      activeUserData({ totpSecret: 'ENROLLED_SECRET', totpFailedAttempts: 0, ...overrides });

    it('increments the durable failed-attempt counter on a wrong TOTP for an enrolled account', async () => {
      const user = enrolledUser({ totpFailedAttempts: 0 });
      userDataService.getByKycHashOrThrow.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyOrThrow').mockImplementation(() => {
        throw new ForbiddenException('Invalid or expired 2FA token');
      });

      await expect(service.verify('hash', '000000', ip)).rejects.toBeInstanceOf(ForbiddenException);
      expect(userDataService.setTotpLockout).toHaveBeenCalledWith(user, 1, null);
    });

    it('locks the account for 15 minutes once the failed attempts reach the max', async () => {
      const user = enrolledUser({ totpFailedAttempts: 4 });
      userDataService.getByKycHashOrThrow.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyOrThrow').mockImplementation(() => {
        throw new ForbiddenException('Invalid or expired 2FA token');
      });

      await expect(service.verify('hash', '000000', ip)).rejects.toBeInstanceOf(ForbiddenException);
      expect(userDataService.setTotpLockout).toHaveBeenCalledWith(user, 0, expect.any(Date));
    });

    it('rejects immediately while locked, without verifying the token', async () => {
      const user = enrolledUser({ totpBlockedUntil: Util.minutesAfter(5) });
      userDataService.getByKycHashOrThrow.mockResolvedValue(user);
      const verifySpy = jest.spyOn(service as any, 'verifyOrThrow');

      await expect(service.verify('hash', '123456', ip)).rejects.toBeInstanceOf(ForbiddenException);
      expect(verifySpy).not.toHaveBeenCalled();
      expect(userDataService.setTotpLockout).not.toHaveBeenCalled();
    });

    it('resets the durable counter on a successful TOTP verification', async () => {
      const user = enrolledUser({ totpFailedAttempts: 3 });
      userDataService.getByKycHashOrThrow.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyOrThrow').mockReturnValue(undefined);

      await service.verify('hash', '123456', ip);

      expect(userDataService.setTotpLockout).toHaveBeenCalledWith(user, 0, null);
      expect(tfaRepo.save).toHaveBeenCalled();
    });
  });

  describe('verify (staff self-enroll guard)', () => {
    const staffUser = (overrides: Partial<UserData> = {}): UserData =>
      activeUserData({ users: [createCustomUser({ role: UserRole.COMPLIANCE })], totpSecret: undefined, ...overrides });

    const seedAppSecret = (user: UserData, secret = 'CACHED_SECRET'): void =>
      (service as any).secretCache.set(user.id, {
        type: TfaType.APP,
        secret,
        expiryDate: Util.hoursAfter(1),
        tryCount: 0,
      });

    it('forbids a staff first-TOTP verification from an untrusted session and does not persist the secret', async () => {
      const user = staffUser();
      userDataService.getByKycHashOrThrow.mockResolvedValue(user);
      seedAppSecret(user);
      jest.spyOn(service as any, 'verifyOrThrow').mockReturnValue(undefined);

      await expect(service.verify('hash', '123456', ip, false)).rejects.toBeInstanceOf(ForbiddenException);
      expect(userDataService.updateTotpSecret).not.toHaveBeenCalled();
    });

    it('allows a staff first-TOTP verification from a trusted session and persists the secret', async () => {
      const user = staffUser();
      userDataService.getByKycHashOrThrow.mockResolvedValue(user);
      seedAppSecret(user, 'CACHED_SECRET');
      jest.spyOn(service as any, 'verifyOrThrow').mockReturnValue(undefined);

      await service.verify('hash', '123456', ip, true);

      expect(userDataService.updateTotpSecret).toHaveBeenCalledWith(user, 'CACHED_SECRET');
    });

    it('lets an already-enrolled staff re-verify regardless of the enrollment flag', async () => {
      const user = staffUser({ totpSecret: 'ENROLLED_SECRET' });
      userDataService.getByKycHashOrThrow.mockResolvedValue(user);
      jest.spyOn(service as any, 'verifyOrThrow').mockReturnValue(undefined);

      await service.verify('hash', '123456', ip, false);

      expect(userDataService.updateTotpSecret).not.toHaveBeenCalled();
      expect(tfaRepo.save).toHaveBeenCalled();
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
