import { createMock } from '@golevelup/ts-jest';
import { ForbiddenException } from '@nestjs/common';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { createCustomUserData } from '../../../user/models/user-data/__mocks__/user-data.entity.mock';
import { UserData } from '../../../user/models/user-data/user-data.entity';
import { RiskStatus, UserDataStatus } from '../../../user/models/user-data/user-data.enum';
import { UserDataService } from '../../../user/models/user-data/user-data.service';
import { UserStatus } from '../../../user/models/user/user.enum';
import { FileType } from '../../dto/kyc-file.dto';
import { KycFile } from '../../entities/kyc-file.entity';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { KycDocumentService } from '../integration/kyc-document.service';
import { KycFileService } from '../kyc-file.service';
import { KycLogService } from '../kyc-log.service';
import { KycService } from '../kyc.service';

describe('KycService', () => {
  let service: KycService;
  let userDataService: jest.Mocked<UserDataService>;

  beforeEach(() => {
    userDataService = createMock<UserDataService>();

    // only userDataService is touched by getOrCreateStepInternal; avoid wiring all 20 deps
    service = Object.create(KycService.prototype);
    (service as any).userDataService = userDataService;
  });

  function userWithSteps(steps: KycStep[]): UserData {
    const user = createMock<UserData>({ kycHash: 'hash', kycSteps: [] });
    user.hasRole.mockReturnValue(false);
    user.getStepsWith.mockReturnValue(steps);
    return user;
  }

  describe('getOrCreateStepInternal', () => {
    it('recovers from a concurrent create race by returning the step the winner created', async () => {
      const winnerStep = createMock<KycStep>();
      const user = userWithSteps([]); // first pass: no existing step
      const reloaded = userWithSteps([winnerStep]); // after the race: winner's step is present
      userDataService.getByKycHashOrThrow.mockResolvedValue(reloaded);

      jest
        .spyOn(service as any, 'initiateStep')
        .mockRejectedValue(new Error('duplicate key value violates unique constraint "IDX_3a11507..."'));

      const result = await service.getOrCreateStepInternal(KycStepName.CONTACT_DATA, user, undefined, undefined, 0);

      expect(result.step).toBe(winnerStep);
      expect(userDataService.getByKycHashOrThrow).toHaveBeenCalledWith('hash', expect.anything());
    });

    it('rethrows a non-duplicate error without reloading', async () => {
      const user = userWithSteps([]);
      jest.spyOn(service as any, 'initiateStep').mockRejectedValue(new Error('some other failure'));

      await expect(
        service.getOrCreateStepInternal(KycStepName.CONTACT_DATA, user, undefined, undefined, 0),
      ).rejects.toThrow('some other failure');
      expect(userDataService.getByKycHashOrThrow).not.toHaveBeenCalled();
    });

    it('creates and returns a new step when none exists and there is no race', async () => {
      const newStep = createMock<KycStep>();
      const user = userWithSteps([]);
      jest.spyOn(service as any, 'initiateStep').mockResolvedValue(newStep);

      const result = await service.getOrCreateStepInternal(KycStepName.CONTACT_DATA, user, undefined, undefined, 0);

      expect(result.step).toBe(newStep);
      expect(userDataService.getByKycHashOrThrow).not.toHaveBeenCalled();
    });
  });
});

// getFileByUid gates protected files on an active account with admin (ADMIN_ROLES) or compliance role;
// non-protected files are public.
describe('KycService getFileByUid protected-file access', () => {
  let service: KycService;
  let kycFileService: jest.Mocked<KycFileService>;
  let documentService: jest.Mocked<KycDocumentService>;

  const kycFile = (overrides: Partial<KycFile> = {}): KycFile =>
    Object.assign(new KycFile(), {
      id: 7,
      uid: 'FILE-UID',
      name: 'protected.pdf',
      type: FileType.IDENTIFICATION,
      protected: true,
      userData: createCustomUserData({ id: 42 }),
      ...overrides,
    });

  const jwtFor = (role: UserRole, statuses: Partial<JwtPayload> = {}): JwtPayload => ({
    role,
    account: 1,
    ip: '127.0.0.1',
    ...statuses,
  });

  beforeEach(() => {
    kycFileService = createMock<KycFileService>();
    documentService = createMock<KycDocumentService>();

    // getFileByUid only touches these three deps; avoid wiring all constructor deps
    service = Object.create(KycService.prototype);
    (service as any).kycFileService = kycFileService;
    (service as any).documentService = documentService;
    (service as any).kycLogService = createMock<KycLogService>();

    documentService.downloadFile.mockResolvedValue(
      createMock<BlobContent>({ contentType: 'application/pdf', data: Buffer.from('x') }),
    );
  });

  // super admin is an admin superset, so it must reach a protected file exactly like admin / compliance
  describe.each([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.COMPLIANCE])('%s', (role) => {
    it('may download a protected KYC file', async () => {
      kycFileService.getKycFile.mockResolvedValue(kycFile());

      const dto = await service.getFileByUid('FILE-UID', jwtFor(role));

      expect(dto.uid).toBe('FILE-UID');
      expect(documentService.downloadFile).toHaveBeenCalled();
    });
  });

  it('forbids a non-privileged role from a protected file, without downloading', async () => {
    kycFileService.getKycFile.mockResolvedValue(kycFile());

    await expect(service.getFileByUid('FILE-UID', jwtFor(UserRole.USER))).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.downloadFile).not.toHaveBeenCalled();
  });

  it('forbids an unauthenticated request (no JWT) from a protected file', async () => {
    kycFileService.getKycFile.mockResolvedValue(kycFile());

    await expect(service.getFileByUid('FILE-UID', undefined)).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.downloadFile).not.toHaveBeenCalled();
  });

  // a blocked account keeps its JWT role until expiry, so the status check must still deny access
  describe.each<[UserRole, Partial<JwtPayload>]>([
    [UserRole.ADMIN, { accountStatus: UserDataStatus.BLOCKED }],
    [UserRole.ADMIN, { accountStatus: UserDataStatus.DEACTIVATED }],
    [UserRole.SUPER_ADMIN, { userStatus: UserStatus.BLOCKED }],
    [UserRole.COMPLIANCE, { riskStatus: RiskStatus.SUSPICIOUS }],
  ])('%s with %o', (role, statuses) => {
    it('is forbidden from a protected file, without downloading', async () => {
      kycFileService.getKycFile.mockResolvedValue(kycFile());

      await expect(service.getFileByUid('FILE-UID', jwtFor(role, statuses))).rejects.toThrow('User is not active');
      expect(documentService.downloadFile).not.toHaveBeenCalled();
    });
  });

  it('serves a non-protected file to any role', async () => {
    kycFileService.getKycFile.mockResolvedValue(kycFile({ protected: false }));

    const dto = await service.getFileByUid('FILE-UID', jwtFor(UserRole.USER));

    expect(dto.uid).toBe('FILE-UID');
    expect(documentService.downloadFile).toHaveBeenCalled();
  });
});
