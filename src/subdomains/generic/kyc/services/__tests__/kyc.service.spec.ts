import { createMock } from '@golevelup/ts-jest';
import { ForbiddenException } from '@nestjs/common';
import { Configuration, ConfigService } from 'src/config/config';
import { BlobContent } from 'src/integration/infrastructure/storage/storage.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import * as processServiceModule from 'src/shared/services/process.service';
import { AccountType } from '../../../user/models/user-data/account-type.enum';
import { createCustomUserData } from '../../../user/models/user-data/__mocks__/user-data.entity.mock';
import { UserData } from '../../../user/models/user-data/user-data.entity';
import { RiskStatus, UserDataStatus } from '../../../user/models/user-data/user-data.enum';
import { UserDataService } from '../../../user/models/user-data/user-data.service';
import { UserStatus } from '../../../user/models/user/user.enum';
import { IdentDocument } from '../../dto/ident.dto';
import { KycError } from '../../dto/kyc-error.enum';
import { FileSubType, FileType, KycFileBlob } from '../../dto/kyc-file.dto';
import { SumSubLevelName } from '../../dto/sum-sub.dto';
import { KycFile } from '../../entities/kyc-file.entity';
import { KycStep } from '../../entities/kyc-step.entity';
import { ContentType } from '../../enums/content-type.enum';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { KycStepType } from '../../enums/kyc.enum';
import { ReviewStatus } from '../../enums/review-status.enum';
import { KycStepRepository } from '../../repositories/kyc-step.repository';
import { KycDocumentService } from '../integration/kyc-document.service';
import { SumsubService } from '../integration/sum-sub.service';
import { KycFileService } from '../kyc-file.service';
import { KycLogService } from '../kyc-log.service';
import { KycService } from '../kyc.service';
import { TfaLevel } from '../tfa.service';

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

// getFileByUid gates protected files on an active account with admin (hasRoleAccess: super admin
// counts) or compliance role; non-protected files are public.
describe('KycService getFileByUid protected-file access', () => {
  let service: KycService;
  let kycFileService: jest.Mocked<KycFileService>;
  let documentService: jest.Mocked<KycDocumentService>;
  let tfaService: { check: jest.Mock };

  const ip = '1.2.3.4';

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
    tfaService = { check: jest.fn() };

    // getFileByUid only touches these deps; avoid wiring all constructor deps
    service = Object.create(KycService.prototype);
    (service as any).kycFileService = kycFileService;
    (service as any).documentService = documentService;
    (service as any).kycLogService = createMock<KycLogService>();
    (service as any).tfaService = tfaService;

    documentService.downloadFile.mockResolvedValue(
      createMock<BlobContent>({ contentType: 'application/pdf', data: Buffer.from('x') }),
    );
  });

  // super admin is an admin superset, so it must reach a protected file exactly like admin / compliance
  describe.each([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.COMPLIANCE])('%s', (role) => {
    it('may download a protected KYC file', async () => {
      kycFileService.getKycFile.mockResolvedValue(kycFile());

      const dto = await service.getFileByUid('FILE-UID', jwtFor(role), ip);

      expect(dto.uid).toBe('FILE-UID');
      expect(documentService.downloadFile).toHaveBeenCalled();
    });
  });

  it('forbids a non-privileged role from a protected file, without downloading', async () => {
    kycFileService.getKycFile.mockResolvedValue(kycFile());

    await expect(service.getFileByUid('FILE-UID', jwtFor(UserRole.USER), ip)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(documentService.downloadFile).not.toHaveBeenCalled();
  });

  it('forbids an unauthenticated request (no JWT) from a protected file', async () => {
    kycFileService.getKycFile.mockResolvedValue(kycFile());

    await expect(service.getFileByUid('FILE-UID', undefined, ip)).rejects.toBeInstanceOf(ForbiddenException);
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

      await expect(service.getFileByUid('FILE-UID', jwtFor(role, statuses), ip)).rejects.toThrow('User is not active');
      expect(documentService.downloadFile).not.toHaveBeenCalled();
    });
  });

  it('serves a non-protected file to any role', async () => {
    kycFileService.getKycFile.mockResolvedValue(kycFile({ protected: false }));

    const dto = await service.getFileByUid('FILE-UID', jwtFor(UserRole.USER), ip);

    expect(dto.uid).toBe('FILE-UID');
    expect(documentService.downloadFile).toHaveBeenCalled();
  });

  // A mail-elevated staff token (tfaRequired) must pass STRICT 2FA before a protected file is served,
  // mirroring the global TfaEnforcementInterceptor. Wallet-signature staff sessions are unaffected.
  describe('2FA enforcement on mail-origin staff sessions', () => {
    it('enforces STRICT 2FA before serving a protected file', async () => {
      kycFileService.getKycFile.mockResolvedValue(kycFile());

      const dto = await service.getFileByUid('FILE-UID', jwtFor(UserRole.COMPLIANCE, { tfaRequired: true }), ip);

      expect(tfaService.check).toHaveBeenCalledWith(1, ip, TfaLevel.STRICT);
      expect(dto.uid).toBe('FILE-UID');
      expect(documentService.downloadFile).toHaveBeenCalled();
    });

    it('blocks the download when 2FA verification fails', async () => {
      kycFileService.getKycFile.mockResolvedValue(kycFile());
      tfaService.check.mockRejectedValue(new Error('TFA required (strict)'));

      await expect(
        service.getFileByUid('FILE-UID', jwtFor(UserRole.COMPLIANCE, { tfaRequired: true }), ip),
      ).rejects.toThrow('TFA required (strict)');
      expect(documentService.downloadFile).not.toHaveBeenCalled();
    });

    it('skips 2FA for a wallet-login staff session (no tfaRequired marker)', async () => {
      kycFileService.getKycFile.mockResolvedValue(kycFile());

      const dto = await service.getFileByUid('FILE-UID', jwtFor(UserRole.COMPLIANCE), ip);

      expect(tfaService.check).not.toHaveBeenCalled();
      expect(dto.uid).toBe('FILE-UID');
      expect(documentService.downloadFile).toHaveBeenCalled();
    });

    it('does not run 2FA for a non-protected file even with tfaRequired', async () => {
      kycFileService.getKycFile.mockResolvedValue(kycFile({ protected: false }));

      await service.getFileByUid('FILE-UID', jwtFor(UserRole.COMPLIANCE, { tfaRequired: true }), ip);

      expect(tfaService.check).not.toHaveBeenCalled();
      expect(documentService.downloadFile).toHaveBeenCalled();
    });
  });
});

// downloadMedia is hit on every Sumsub MEDIA webhook, and Sumsub fires one MEDIA event per video
// composition and redelivers events at least once. A redelivery of the same composition must be
// skipped, but a genuinely new composition (same transaction, different mediaId) must still be
// uploaded. Documents are matched on the stable name suffix (`<transactionId>-<mediaId>.<ext>`,
// everything after SumsubService.fileName's dash-free timestamp prefix), which differs per mediaId.
describe('KycService downloadMedia', () => {
  let service: KycService;
  let documentService: jest.Mocked<KycDocumentService>;
  let sumsubService: jest.Mocked<SumsubService>;

  const transactionId = 'kyc-video-42-0-abc123';

  const kycStep = createMock<KycStep>({ transactionId });
  const user = createMock<UserData>({ id: 42 });

  // as listed by listUserFiles: the blob name after the `user/<id>/<type>/` prefix is stripped,
  // i.e. the deterministic SumsubService.fileName `<timestamp>-<transactionId>-<mediaId>.<ext>`.
  const storedName = (mediaId: string, timestamp = '20260708_101500'): string =>
    `${timestamp}-${transactionId}-${mediaId}.mp4`;

  // a fresh download re-runs SumsubService.fileName, so the timestamp prefix differs from the stored copy
  const downloadName = (mediaId: string, timestamp = '20260709_120000'): string =>
    `${timestamp}-${transactionId}-${mediaId}.mp4`;

  const existingFile = (name: string, overrides: Partial<KycFileBlob> = {}): KycFileBlob =>
    createMock<KycFileBlob>({
      type: FileType.IDENTIFICATION,
      name,
      contentType: ContentType.MP4,
      ...overrides,
    });

  const identDocument = (name: string, overrides: Partial<IdentDocument> = {}): IdentDocument => ({
    name,
    content: Buffer.from('x'),
    contentType: ContentType.MP4,
    ...overrides,
  });

  beforeEach(() => {
    documentService = createMock<KycDocumentService>();
    sumsubService = createMock<SumsubService>();

    // downloadMedia only touches these deps; avoid wiring all constructor deps
    service = Object.create(KycService.prototype);
    (service as any).documentService = documentService;
    (service as any).sumsubService = sumsubService;
    (service as any).logger = createMock<DfxLogger>();
  });

  it('skips a redelivered composition (same mediaId) without uploading', async () => {
    documentService.listUserFiles.mockResolvedValue([existingFile(storedName('media1'))]);
    sumsubService.getMedia.mockResolvedValue([identDocument(downloadName('media1'))]);

    await (service as any).downloadMedia(user, kycStep, true);

    expect(documentService.listUserFiles).toHaveBeenCalledWith(user.id);
    expect(documentService.uploadFile).not.toHaveBeenCalled();
  });

  it('uploads a genuinely new composition (different mediaId) even when another recording exists', async () => {
    const newComposition = identDocument(downloadName('media2'));
    documentService.listUserFiles.mockResolvedValue([existingFile(storedName('media1'))]);
    sumsubService.getMedia.mockResolvedValue([newComposition]);

    await (service as any).downloadMedia(user, kycStep, true);

    expect(documentService.uploadFile).toHaveBeenCalledTimes(1);
    expect(documentService.uploadFile).toHaveBeenCalledWith(
      user,
      FileType.IDENTIFICATION,
      newComposition.name,
      newComposition.content,
      newComposition.contentType,
      true,
      true,
      kycStep,
      undefined,
    );
  });
});

// downloadIdentDocuments runs on every ident SUCCESS/FAIL webhook (redelivered at least once) and
// stores the report/document media. Like downloadMedia it must skip documents that are already
// stored - including invalid ones written under the `fail/` name prefix - while still uploading a
// genuinely new document (different image id, hence a different stable name suffix).
describe('KycService downloadIdentDocuments', () => {
  let service: KycService;
  let documentService: jest.Mocked<KycDocumentService>;
  let sumsubService: jest.Mocked<SumsubService>;

  const transactionId = 'kyc-ident-42-0-abc123';

  const kycStep = createMock<KycStep>({ transactionId });
  const user = createMock<UserData>({ id: 42 });

  // invalid documents are stored under a `fail/` prefix; the match must ignore that prefix
  const storedName = (imageId: string, prefix = 'fail/', timestamp = '20260708_101500'): string =>
    `${prefix}${timestamp}-${transactionId}-${imageId}.png`;

  const downloadName = (imageId: string, timestamp = '20260709_120000'): string =>
    `${timestamp}-${transactionId}-${imageId}.png`;

  const existingFile = (name: string, overrides: Partial<KycFileBlob> = {}): KycFileBlob =>
    createMock<KycFileBlob>({
      type: FileType.IDENTIFICATION,
      name,
      contentType: ContentType.PNG,
      ...overrides,
    });

  const identDocument = (name: string, overrides: Partial<IdentDocument> = {}): IdentDocument => ({
    name,
    content: Buffer.from('x'),
    contentType: ContentType.PNG,
    ...overrides,
  });

  beforeEach(() => {
    documentService = createMock<KycDocumentService>();
    sumsubService = createMock<SumsubService>();

    // downloadIdentDocuments only touches these deps; avoid wiring all constructor deps
    service = Object.create(KycService.prototype);
    (service as any).documentService = documentService;
    (service as any).sumsubService = sumsubService;
    (service as any).logger = createMock<DfxLogger>();
  });

  it('skips a redelivered document already stored under the fail/ prefix, without uploading', async () => {
    documentService.listUserFiles.mockResolvedValue([existingFile(storedName('img1'))]);
    sumsubService.getDocuments.mockResolvedValue([identDocument(downloadName('img1'))]);

    await (service as any).downloadIdentDocuments(user, kycStep, false);

    expect(documentService.listUserFiles).toHaveBeenCalledWith(user.id);
    expect(documentService.uploadFile).not.toHaveBeenCalled();
  });

  it('uploads a genuinely new document (different image id) even when another document exists', async () => {
    const newDocument = identDocument(downloadName('img2'));
    documentService.listUserFiles.mockResolvedValue([existingFile(storedName('img1'))]);
    sumsubService.getDocuments.mockResolvedValue([newDocument]);

    await (service as any).downloadIdentDocuments(user, kycStep, false);

    expect(documentService.uploadFile).toHaveBeenCalledTimes(1);
    expect(documentService.uploadFile).toHaveBeenCalledWith(
      user,
      FileType.IDENTIFICATION,
      `fail/${newDocument.name}`,
      newDocument.content,
      newDocument.contentType,
      true,
      false,
      kycStep,
      undefined,
    );
  });
});

// initiateStep auto-satisfies the NationalityData step from the account's already-known nationality
// (captured e.g. during RealUnit registration) so the user is not asked for it a second time - but
// only for the clean case (allowed, non-residence-permit nationality, no step errors), which is
// completed in-memory. A residence-permit or disallowed nationality, a merged/blocked account, a
// missing nationality, or a repeat attempt (preventDirectEvaluation) is deliberately left
// IN_PROGRESS, so the user goes through the normal nationality step that routes it to the correct
// internal/manual review and pulls in the residence-permit follow-up step. Never a blind complete.
describe('KycService initiateStep NATIONALITY_DATA auto-complete', () => {
  let service: KycService;
  let kycStepRepo: jest.Mocked<KycStepRepository>;

  const userWithNationality = (nationality?: Country, overrides: Partial<UserData> = {}): UserData =>
    createCustomUserData({ kycHash: 'hash', kycSteps: [], nationality, ...overrides });

  const initiateNationalityStep = (user: UserData, preventDirectEvaluation = false): Promise<KycStep> =>
    (service as any).initiateStep(user, KycStepName.NATIONALITY_DATA, undefined, preventDirectEvaluation);

  // the NATIONALITY_DATA branch reads Config.kyc.residencePermitCountries; initialize the global
  // Config (a module-level `let` that is undefined until a ConfigService is constructed)
  beforeAll(() => {
    new ConfigService(new Configuration());
  });

  beforeEach(() => {
    kycStepRepo = createMock<KycStepRepository>();
    // save returns the (mutated) step, mirroring the real repo, so initiateStep's return is that step
    (kycStepRepo.save as jest.Mock).mockImplementation(async (step) => step);

    // initiateStep's NATIONALITY_DATA path only touches the repo (via the final save) and the pure
    // getNationalityErrors helper; avoid wiring all constructor deps
    service = Object.create(KycService.prototype);
    (service as any).kycStepRepo = kycStepRepo;
  });

  it('completes the step in-memory from an allowed nationality and stores it as the result', async () => {
    const nationality = createCustomCountry({ symbol: 'DE', nationalityEnable: true });
    const user = userWithNationality(nationality);

    const step = await initiateNationalityStep(user);

    expect(step.status).toBe(ReviewStatus.COMPLETED);
    expect(step.getResult()).toMatchObject({ nationality: { id: nationality.id, symbol: 'DE' } });
    // only the final persist runs
    expect(kycStepRepo.save).toHaveBeenCalledTimes(1);
  });

  it('leaves a residence-permit nationality IN_PROGRESS for the normal step', async () => {
    const nationality = createCustomCountry({ symbol: 'RU', nationalityEnable: true });
    const user = userWithNationality(nationality);

    const step = await initiateNationalityStep(user);

    expect(step.status).toBe(ReviewStatus.IN_PROGRESS);
    expect(step.result).toBeUndefined();
  });

  it('leaves a disallowed nationality IN_PROGRESS for the normal step', async () => {
    const nationality = createCustomCountry({ symbol: 'DE', nationalityEnable: false });
    const user = userWithNationality(nationality);

    const step = await initiateNationalityStep(user);

    expect(step.status).toBe(ReviewStatus.IN_PROGRESS);
    expect(step.result).toBeUndefined();
  });

  it('leaves the step IN_PROGRESS when the account has no known nationality', async () => {
    const user = userWithNationality(undefined);

    const step = await initiateNationalityStep(user);

    expect(step.status).toBe(ReviewStatus.IN_PROGRESS);
    expect(step.result).toBeUndefined();
  });

  it('leaves the step IN_PROGRESS on a repeat attempt (preventDirectEvaluation)', async () => {
    const nationality = createCustomCountry({ symbol: 'DE', nationalityEnable: true });
    const user = userWithNationality(nationality);

    const step = await initiateNationalityStep(user, true);

    expect(step.status).toBe(ReviewStatus.IN_PROGRESS);
    expect(step.result).toBeUndefined();
  });

  // fail-closed: a merged (or blocked) account yields step errors from getNationalityErrors, so even
  // an allowed nationality must not be auto-completed
  it('leaves an allowed nationality IN_PROGRESS when the account is merged (fail-closed)', async () => {
    const nationality = createCustomCountry({ symbol: 'DE', nationalityEnable: true });
    const user = userWithNationality(nationality, { status: UserDataStatus.MERGED });

    const step = await initiateNationalityStep(user);

    expect(step.status).toBe(ReviewStatus.IN_PROGRESS);
    expect(step.result).toBeUndefined();
  });
});

// the DFX_APPROVAL branches read the real status getters, so build real steps instead of mocking them
const dfxApprovalStep = (status: ReviewStatus): KycStep =>
  Object.assign(new KycStep(), { id: 812746, name: KycStepName.DFX_APPROVAL, status });

// only DFX_APPROVAL is missing, no OnHold/InReview approval step exists yet
const approvalUser = (): UserData => {
  const user = createMock<UserData>({ id: 42, kycSteps: [] });
  user.hasCompletedStep.mockImplementation((step) => step !== KycStepName.DFX_APPROVAL);
  user.getStepsWith.mockReturnValue([]);
  return user;
};

// checkDfxApproval is called concurrently (account merge, KYC review cron, mail-confirm merge), so
// the DfxApproval insert can lose a race against the unique index on (userDataId, name, type,
// sequenceNumber). The loser must recover ONLY when the error is provably that race (SQLSTATE 23505
// on exactly that index), adopt the winner's step, and otherwise fail closed with the original error.
describe('KycService checkDfxApproval duplicate-key recovery', () => {
  let service: KycService;
  let kycStepRepo: jest.Mocked<KycStepRepository>;

  // the exact error shape the pg driver raises on the kyc_step unique index (code + constraint)
  const kycStepUniqueIndex = 'IDX_3a1150791476264753a67212a1';
  const pgDuplicateKeyError = Object.assign(
    new Error(`duplicate key value violates unique constraint "${kycStepUniqueIndex}"`),
    { code: '23505', constraint: kycStepUniqueIndex },
  );

  // requiredKycSteps reads the global Config
  beforeAll(() => {
    new ConfigService(new Configuration());
  });

  beforeEach(() => {
    kycStepRepo = createMock<KycStepRepository>();
    // the gate derives the expected constraint name from the entity metadata
    Object.assign(kycStepRepo, { metadata: { indices: [{ isUnique: true, name: kycStepUniqueIndex }] } });

    // checkDfxApproval's approval branch only touches the repo; avoid wiring all constructor deps
    service = Object.create(KycService.prototype);
    (service as any).kycStepRepo = kycStepRepo;
  });

  it("recovers the concurrent winner's OnHold step and promotes it to manual review", async () => {
    jest.spyOn(service as any, 'initiateStep').mockRejectedValue(pgDuplicateKeyError);
    kycStepRepo.findOne.mockResolvedValue(dfxApprovalStep(ReviewStatus.ON_HOLD));

    await service.checkDfxApproval(approvalUser());

    expect(kycStepRepo.findOne).toHaveBeenCalledWith({
      where: { name: KycStepName.DFX_APPROVAL, userData: { id: 42 } },
      order: { sequenceNumber: 'DESC' },
    });
    expect(kycStepRepo.update).toHaveBeenCalledWith(812746, { status: ReviewStatus.MANUAL_REVIEW });
  });

  it('treats a winner that already advanced into review as success, without promoting again', async () => {
    jest.spyOn(service as any, 'initiateStep').mockRejectedValue(pgDuplicateKeyError);
    kycStepRepo.findOne.mockResolvedValue(dfxApprovalStep(ReviewStatus.MANUAL_REVIEW));

    await expect(service.checkDfxApproval(approvalUser())).resolves.toBeUndefined();
    expect(kycStepRepo.update).not.toHaveBeenCalled();
  });

  it('treats a winner auto-completed via LEVEL_50 as success, without promoting again', async () => {
    jest.spyOn(service as any, 'initiateStep').mockRejectedValue(pgDuplicateKeyError);
    kycStepRepo.findOne.mockResolvedValue(dfxApprovalStep(ReviewStatus.COMPLETED));

    await expect(service.checkDfxApproval(approvalUser())).resolves.toBeUndefined();
    expect(kycStepRepo.update).not.toHaveBeenCalled();
  });

  it('rethrows the original error when the winner has not advanced (fail-closed)', async () => {
    jest.spyOn(service as any, 'initiateStep').mockRejectedValue(pgDuplicateKeyError);
    kycStepRepo.findOne.mockResolvedValue(dfxApprovalStep(ReviewStatus.CANCELED));

    await expect(service.checkDfxApproval(approvalUser())).rejects.toBe(pgDuplicateKeyError);
    expect(kycStepRepo.update).not.toHaveBeenCalled();
  });

  it('rethrows the original error when no winner step is found (fail-closed)', async () => {
    jest.spyOn(service as any, 'initiateStep').mockRejectedValue(pgDuplicateKeyError);
    kycStepRepo.findOne.mockResolvedValue(null);

    await expect(service.checkDfxApproval(approvalUser())).rejects.toBe(pgDuplicateKeyError);
    expect(kycStepRepo.update).not.toHaveBeenCalled();
  });

  it('rethrows a 23505 from a different constraint without recovery', async () => {
    const otherConstraintError = Object.assign(
      new Error('duplicate key value violates unique constraint "IDX_other"'),
      { code: '23505', constraint: 'IDX_other' },
    );
    jest.spyOn(service as any, 'initiateStep').mockRejectedValue(otherConstraintError);

    await expect(service.checkDfxApproval(approvalUser())).rejects.toBe(otherConstraintError);
    expect(kycStepRepo.findOne).not.toHaveBeenCalled();
  });

  it('rethrows a non-duplicate error without recovery', async () => {
    jest.spyOn(service as any, 'initiateStep').mockRejectedValue(new Error('connection refused'));

    await expect(service.checkDfxApproval(approvalUser())).rejects.toThrow('connection refused');
    expect(kycStepRepo.findOne).not.toHaveBeenCalled();
    expect(kycStepRepo.update).not.toHaveBeenCalled();
  });
});

// The ident file sync only works for Sumsub steps - it throws on any other ident type - and it runs
// BEFORE the status is persisted, so a failing sync keeps the step in INTERNAL_REVIEW for the next
// run. A manual ident therefore used to lose its MANUAL_REVIEW transition and stay in
// INTERNAL_REVIEW, where the every-minute review re-processed and re-failed it forever.
describe('KycService reviewIdentSteps file sync', () => {
  let service: KycService;
  let kycStepRepo: jest.Mocked<KycStepRepository>;
  let userDataService: jest.Mocked<UserDataService>;
  let syncIdentFilesInternalSpy: jest.SpyInstance;
  // the status as seen by the repo, not as read after the run: manualReview() mutates the entity
  // in memory before the sync, so asserting on the entity afterwards would pass either way -
  // undefined means the step was never saved
  let savedStatus: ReviewStatus | undefined;

  // resultData is read per ident type, so each type needs its own result shape
  const sumsubResult = (levelName: SumSubLevelName) => ({
    data: { info: { idDocs: [{ firstNameEn: 'Max', lastNameEn: 'Muster', dob: '1990-01-01' }] } },
    webhook: { levelName },
  });

  // companyid is what separates an auto from a video IdNow ident, see getIdentificationType
  const idNowResult = (companyid: string) => ({
    userdata: { firstname: { value: 'Max' }, lastname: { value: 'Muster' }, birthday: { value: '1990-01-01' } },
    identificationprocess: { companyid, result: 'SUCCESS' },
  });

  // fully mapped on purpose: a new ident type then fails to compile instead of silently arriving here
  // without a result
  const identResult: { [t in KycStepType]: object } = {
    [KycStepType.MANUAL]: { firstName: 'Max', lastName: 'Muster', birthday: '1990-01-01' },
    [KycStepType.AUTO]: idNowResult('dfxauto'),
    [KycStepType.VIDEO]: idNowResult('dfxvideo'),
    [KycStepType.SUMSUB_AUTO]: sumsubResult(SumSubLevelName.CH_STANDARD),
    [KycStepType.SUMSUB_VIDEO]: sumsubResult(SumSubLevelName.CH_STANDARD_VIDEO),
  };

  const identStep = (type: KycStepType, kycFiles: KycFile[] = []): KycStep => {
    const userData = createCustomUserData({ id: 42, kycFiles, users: [] });
    // mirrors the finder's WHERE clause: the account has a completed nationality step
    userData.getStepsWith = jest.fn().mockReturnValue([createMock<KycStep>({ isCompleted: true })]);

    return Object.assign(new KycStep(), {
      id: 1,
      name: KycStepName.IDENT,
      type,
      status: ReviewStatus.INTERNAL_REVIEW,
      userData,
      result: JSON.stringify(identResult[type]),
    });
  };

  beforeEach(() => {
    savedStatus = undefined;
    kycStepRepo = createMock<KycStepRepository>();
    kycStepRepo.findBy.mockResolvedValue([]);
    (kycStepRepo.save as jest.Mock).mockImplementation(async (step: KycStep) => {
      savedStatus = step.status;
      return step;
    });
    userDataService = createMock<UserDataService>();
    userDataService.getUserDataByBirthday.mockResolvedValue([]);

    // with getIdentCheckErrors, createStepLog and syncIdentFilesInternal stubbed below, the review
    // path only touches these deps; avoid wiring all constructor deps
    service = Object.create(KycService.prototype);
    (service as any).kycStepRepo = kycStepRepo;
    (service as any).userDataService = userDataService;
    (service as any).countryService = createMock<CountryService>();
    (service as any).logger = createMock<DfxLogger>();

    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
    // the check itself is not under test here - a plain, non-ignoring error puts every step into
    // manual review, so the cases differ only in the ident type
    jest.spyOn(service as any, 'getIdentCheckErrors').mockReturnValue([KycError.FIRST_NAME_NOT_MATCHING]);
    jest.spyOn(service as any, 'createStepLog').mockResolvedValue(undefined);
    syncIdentFilesInternalSpy = jest.spyOn(service as any, 'syncIdentFilesInternal').mockResolvedValue(undefined);
  });

  // the sync throws for every type it does not know, so all of them have to stay out of it - the
  // legacy IdNow types are dormant, but a guard narrowed to Manual would wedge them just the same
  const nonSumsubTypes = [KycStepType.MANUAL, KycStepType.AUTO, KycStepType.VIDEO];
  // both Sumsub types can sync, so both have to be covered - a guard narrowed to one of them would
  // otherwise leave the other completing without any file, silently
  const sumsubTypes = [KycStepType.SUMSUB_AUTO, KycStepType.SUMSUB_VIDEO];

  it.each(nonSumsubTypes)('persists a %s ident step without touching the Sumsub file sync', async (type) => {
    const step = identStep(type);
    kycStepRepo.find.mockResolvedValue([step]);
    // mirror the real implementation: it rejects a non-Sumsub step, which would skip the save below
    syncIdentFilesInternalSpy.mockRejectedValue(new Error(`Invalid ident step type ${type}`));

    await service.reviewIdentSteps();

    expect(syncIdentFilesInternalSpy).not.toHaveBeenCalled();
    expect(savedStatus).toBe(ReviewStatus.MANUAL_REVIEW);
  });

  it.each(sumsubTypes)('still syncs the files of a %s ident step that has no ident report yet', async (type) => {
    // an unrelated file must not stand in for the report: only a missing IDENT_REPORT triggers the sync
    const step = identStep(type, [createMock<KycFile>({ subType: FileSubType.IDENT_SELFIE })]);
    kycStepRepo.find.mockResolvedValue([step]);

    await service.reviewIdentSteps();

    expect(syncIdentFilesInternalSpy).toHaveBeenCalledWith(step);
    expect(savedStatus).toBe(ReviewStatus.MANUAL_REVIEW);
  });

  // the normal case: the ident webhook already downloaded the report, so there is nothing to fetch
  it.each(sumsubTypes)('skips the file sync of a %s ident step that already has its report', async (type) => {
    const step = identStep(type, [createMock<KycFile>({ subType: FileSubType.IDENT_REPORT })]);
    kycStepRepo.find.mockResolvedValue([step]);

    await service.reviewIdentSteps();

    expect(syncIdentFilesInternalSpy).not.toHaveBeenCalled();
    expect(savedStatus).toBe(ReviewStatus.MANUAL_REVIEW);
  });

  // a completing step must sync too: it leaves INTERNAL_REVIEW for good, so a missed file is not
  // retried by a later run but simply stays missing
  it.each(sumsubTypes)('still syncs the files of a completing %s ident step', async (type) => {
    const step = identStep(type);
    kycStepRepo.find.mockResolvedValue([step]);
    jest.spyOn(service as any, 'getIdentCheckErrors').mockReturnValue([]);
    // both run after the save; stub them so an unwired dep cannot throw into the catch and mask this
    jest.spyOn(service as any, 'completeIdent').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkDfxApproval').mockResolvedValue(undefined);

    await service.reviewIdentSteps();

    expect(syncIdentFilesInternalSpy).toHaveBeenCalledWith(step);
    expect(savedStatus).toBe(ReviewStatus.COMPLETED);
  });

  // a merged or blocked account is ignored instead of reviewed, and it is saved like any other
  // outcome - so an unguarded sync would wedge it in internal review just the same
  it.each(sumsubTypes)('skips the file sync of an ignored %s ident step', async (type) => {
    const step = identStep(type);
    kycStepRepo.find.mockResolvedValue([step]);
    jest.spyOn(service as any, 'getIdentCheckErrors').mockReturnValue([KycError.USER_DATA_MERGED]);

    await service.reviewIdentSteps();

    expect(syncIdentFilesInternalSpy).not.toHaveBeenCalled();
    expect(savedStatus).toBe(ReviewStatus.IGNORED);
  });

  // the sync deliberately runs before the save: a Sumsub step whose files could not be fetched has
  // to keep its INTERNAL_REVIEW status so the next run retries it instead of advancing without files
  it.each(sumsubTypes)('leaves a %s ident step unsaved when its file sync fails, for a retry', async (type) => {
    const step = identStep(type);
    kycStepRepo.find.mockResolvedValue([step]);
    syncIdentFilesInternalSpy.mockRejectedValue(new Error('blob is immutable'));

    await service.reviewIdentSteps();

    // the sync has to be reached, otherwise the two absence assertions below hold for the wrong reason
    expect(syncIdentFilesInternalSpy).toHaveBeenCalledWith(step);
    expect(kycStepRepo.save).not.toHaveBeenCalled();
    expect(savedStatus).toBeUndefined();
  });
});

// initiateStep auto-completes DFX_APPROVAL when the account already reached kycLevel LEVEL_50 (e.g.
// after a reset that cancelled the step without lowering the level). The promotion that follows must
// not demote such a step back into the manual-review queue.
describe('KycService checkDfxApproval step promotion', () => {
  let service: KycService;
  let kycStepRepo: jest.Mocked<KycStepRepository>;

  beforeAll(() => {
    new ConfigService(new Configuration());
  });

  beforeEach(() => {
    kycStepRepo = createMock<KycStepRepository>();

    service = Object.create(KycService.prototype);
    (service as any).kycStepRepo = kycStepRepo;
  });

  it('promotes a newly created OnHold step to manual review', async () => {
    jest.spyOn(service as any, 'initiateStep').mockResolvedValue(dfxApprovalStep(ReviewStatus.ON_HOLD));

    await service.checkDfxApproval(approvalUser());

    expect(kycStepRepo.update).toHaveBeenCalledWith(812746, { status: ReviewStatus.MANUAL_REVIEW });
  });

  it('leaves a step auto-completed via LEVEL_50 alone instead of demoting it', async () => {
    jest.spyOn(service as any, 'initiateStep').mockResolvedValue(dfxApprovalStep(ReviewStatus.COMPLETED));

    await expect(service.checkDfxApproval(approvalUser())).resolves.toBeUndefined();
    expect(kycStepRepo.update).not.toHaveBeenCalled();
  });
});

// A flow that writes personal data outside the step machinery (RealUnit registration) leaves the
// PERSONAL_DATA step IN_PROGRESS: createStep's auto-completion is gated on `!preventDirectEvaluation`,
// which any prior step row sets, so an account that once abandoned the step could never satisfy it again
// and KycInfoMapper kept handing that stale step back as `currentStep`.
describe('KycService completeSatisfiedPersonalDataStep', () => {
  let service: KycService;
  let kycStepRepo: jest.Mocked<KycStepRepository>;
  let userDataService: jest.Mocked<UserDataService>;

  const personalStep = (status: ReviewStatus): KycStep =>
    Object.assign(new KycStep(), { id: 72202, name: KycStepName.PERSONAL_DATA, status });

  // Every field in `requiredKycFields` for a personal account, so `isDataComplete` is true.
  const completeUser = (kycSteps: KycStep[], overrides: Partial<UserData> = {}): UserData =>
    createCustomUserData({
      id: 315486,
      accountType: AccountType.PERSONAL,
      mail: 'test@test.com',
      phone: '+41790000000',
      firstname: 'Erika',
      surname: 'Mueller',
      street: 'Bahnhofstrasse 1',
      location: 'Zurich',
      zip: '8001',
      kycSteps,
      ...overrides,
    });

  beforeEach(() => {
    kycStepRepo = createMock<KycStepRepository>();
    userDataService = createMock<UserDataService>();

    service = Object.create(KycService.prototype);
    (service as any).kycStepRepo = kycStepRepo;
    (service as any).userDataService = userDataService;
    jest.spyOn(service as any, 'createStepLog').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'updateProgress').mockResolvedValue(undefined);
  });

  const run = async (user: UserData): Promise<void> => {
    userDataService.getUserData.mockResolvedValue(user);
    // the caller's UserData need not carry `kycSteps`; the method reloads it itself
    await service.completeSatisfiedPersonalDataStep(createCustomUserData({ id: user.id }));
  };

  it('completes a pending step and advances the process', async () => {
    const step = personalStep(ReviewStatus.IN_PROGRESS);
    await run(completeUser([step]));

    expect(userDataService.getUserData).toHaveBeenCalledWith(315486, { kycSteps: true });
    expect(kycStepRepo.update).toHaveBeenCalledTimes(1);
    expect(step.status).toBe(ReviewStatus.COMPLETED);
    expect(step.getResult()).toMatchObject({ firstname: 'Erika', surname: 'Mueller', zip: '8001' });
    expect((service as any).updateProgress).toHaveBeenCalled();
  });

  // preventDirectEvaluation exists so a retry does not paper over a prior rejection. A FAILED step must
  // keep going through the normal flow rather than being silently resurrected by a registration.
  it('leaves a FAILED step untouched', async () => {
    const step = personalStep(ReviewStatus.FAILED);
    await run(completeUser([step]));

    expect(kycStepRepo.update).not.toHaveBeenCalled();
    expect(step.status).toBe(ReviewStatus.FAILED);
    expect((service as any).updateProgress).not.toHaveBeenCalled();
  });

  it('leaves an already completed step untouched', async () => {
    const step = personalStep(ReviewStatus.COMPLETED);
    await run(completeUser([step]));

    expect(kycStepRepo.update).not.toHaveBeenCalled();
  });

  it('does nothing when the account data is incomplete', async () => {
    const step = personalStep(ReviewStatus.IN_PROGRESS);
    await run(completeUser([step], { surname: undefined }));

    expect(kycStepRepo.update).not.toHaveBeenCalled();
    expect(step.status).toBe(ReviewStatus.IN_PROGRESS);
  });

  it('does nothing when there is no PersonalData step', async () => {
    await run(completeUser([]));

    expect(kycStepRepo.update).not.toHaveBeenCalled();
    expect((service as any).updateProgress).not.toHaveBeenCalled();
  });
});
