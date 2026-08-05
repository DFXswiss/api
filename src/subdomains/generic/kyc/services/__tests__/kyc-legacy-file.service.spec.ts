import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import * as ConfigModule from 'src/config/config';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { FileSubType, FileType } from '../../dto/kyc-file.dto';
import { LegacyFileSkipReason } from '../../dto/kyc-legacy-file.dto';
import { KycFile } from '../../entities/kyc-file.entity';
import { KycFileRepository } from '../../repositories/kyc-file.repository';
import { KycDocumentService } from '../integration/kyc-document.service';
import { KycLegacyFileService } from '../kyc-legacy-file.service';

describe('KycLegacyFileService', () => {
  let service: KycLegacyFileService;
  let kycDocumentService: KycDocumentService;
  let kycFileRepo: KycFileRepository;
  let userDataService: UserDataService;

  const userDataId = 1234;
  const keys = [
    `spider/${userDataId}/online-identification/1699356511987/report.pdf`,
    `spider/${userDataId}/online-identification/1699356511987/userface.jpg`,
    `spider/${userDataId}/online-identification/1699356511987/result.json`,
  ];

  function skipCount(skipped: { reason: LegacyFileSkipReason; count: number }[], reason: LegacyFileSkipReason): number {
    return skipped.find((s) => s.reason === reason)?.count ?? 0;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    (ConfigModule as Record<string, unknown>).Config = { prefixes: { kycFileUidPrefix: 'F' } };

    kycDocumentService = createMock<KycDocumentService>();
    kycFileRepo = createMock<KycFileRepository>();
    userDataService = createMock<UserDataService>();

    (kycDocumentService.listKeysByPrefix as jest.Mock).mockResolvedValue(keys);
    (kycFileRepo.find as jest.Mock).mockResolvedValue([]);
    (kycFileRepo.create as jest.Mock).mockImplementation((dto) => dto as KycFile);
    (kycFileRepo.save as jest.Mock).mockImplementation((files) => Promise.resolve(files));
    (userDataService.getExistingUserDataIds as jest.Mock).mockResolvedValue([userDataId]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycLegacyFileService,
        { provide: KycDocumentService, useValue: kycDocumentService },
        { provide: KycFileRepository, useValue: kycFileRepo },
        { provide: UserDataService, useValue: userDataService },
      ],
    }).compile();

    service = module.get<KycLegacyFileService>(KycLegacyFileService);
  });

  it('reports what it would write without writing anything on a dry run', async () => {
    const result = await service.syncLegacyFiles(true);

    expect(result.dryRun).toBe(true);
    expect(result.owners).toBe(1);
    expect(result.keys).toBe(3);
    expect(result.wouldInsert).toBe(2);
    expect(result.inserted).toBe(0);
    expect(result.byType).toEqual([
      { type: FileType.IDENTIFICATION, subType: FileSubType.IDENT_REPORT, count: 1 },
      { type: FileType.IDENTIFICATION, subType: FileSubType.IDENT_SELFIE, count: 1 },
    ]);
    expect(skipCount(result.skipped, LegacyFileSkipReason.UNSUPPORTED_EXTENSION)).toBe(1);
    expect(result.examples).toHaveLength(2);

    expect(kycFileRepo.save).not.toHaveBeenCalled();
  });

  it('writes catalog rows pointing at the existing blobs', async () => {
    const result = await service.syncLegacyFiles(false);

    expect(result.inserted).toBe(2);

    const files = (kycFileRepo.save as jest.Mock).mock.calls[0][0] as KycFile[];
    expect(files.map((f) => f.path)).toEqual([keys[0], keys[1]]);
    expect(files.every((f) => f.protected && f.valid && f.uid.startsWith('F') && !f.kycStep)).toBe(true);
    expect(files.every((f) => f.userData.id === userDataId)).toBe(true);
  });

  it('skips a blob that is already catalogued', async () => {
    (kycFileRepo.find as jest.Mock).mockResolvedValue([{ path: keys[0] } as KycFile]);

    const result = await service.syncLegacyFiles(false);

    expect(result.inserted).toBe(1);
    expect(skipCount(result.skipped, LegacyFileSkipReason.ALREADY_CATALOGED)).toBe(1);

    const files = (kycFileRepo.save as jest.Mock).mock.calls[0][0] as KycFile[];
    expect(files.map((f) => f.path)).toEqual([keys[1]]);
  });

  it('skips an owner whose account no longer exists', async () => {
    (userDataService.getExistingUserDataIds as jest.Mock).mockResolvedValue([]);

    const result = await service.syncLegacyFiles(false);

    expect(result.inserted).toBe(0);
    expect(skipCount(result.skipped, LegacyFileSkipReason.UNKNOWN_OWNER)).toBe(3);
    expect(kycFileRepo.save).not.toHaveBeenCalled();
  });

  it('reads both prefixes of a single account', async () => {
    await service.syncLegacyFiles(true, userDataId);

    expect(kycDocumentService.listKeysByPrefix).toHaveBeenCalledWith(`spider/${userDataId}/`);
    expect(kycDocumentService.listKeysByPrefix).toHaveBeenCalledWith(`spider/${userDataId}-organization/`);
  });
});
