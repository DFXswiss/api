import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import * as ConfigModule from 'src/config/config';
import { EntityMetadata } from 'typeorm';
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

  const pathIndexName = 'IDX_kyc_file_path';

  function skipCount(skipped: { reason: LegacyFileSkipReason; count: number }[], reason: LegacyFileSkipReason): number {
    return skipped.find((s) => s.reason === reason)?.count ?? 0;
  }

  function uniqueViolation(constraint: string): Error {
    return Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505', constraint });
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    (ConfigModule as Record<string, unknown>).Config = {
      prefixes: { kycFileUidPrefix: 'F' },
      formats: { number: /^\d+$/ },
    };

    kycDocumentService = createMock<KycDocumentService>();
    kycFileRepo = createMock<KycFileRepository>({
      metadata: {
        indices: [{ isUnique: true, columns: [{ propertyName: 'path' }], name: pathIndexName }],
      } as unknown as EntityMetadata,
    });
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

  describe('owner segment', () => {
    it('never queries an owner segment that is not an account id', async () => {
      // a timestamp-shaped segment: a valid number, but far above the int4 the id column is
      (kycDocumentService.listKeysByPrefix as jest.Mock).mockResolvedValue([
        `spider/1699356511987/user-added-document/proof.pdf`,
        `spider/${userDataId}-x/user-added-document/proof.pdf`,
        keys[0],
      ]);

      const result = await service.syncLegacyFiles(false);

      expect(userDataService.getExistingUserDataIds).toHaveBeenCalledWith([userDataId]);
      expect(result.owners).toBe(1);
      expect(skipCount(result.skipped, LegacyFileSkipReason.INVALID_PATH)).toBe(2);
      expect(result.inserted).toBe(1);
    });
  });

  describe('concurrent run', () => {
    it('counts a blob another run wrote first and keeps the rest of the batch', async () => {
      (kycFileRepo.save as jest.Mock).mockImplementation((files) => {
        if (Array.isArray(files)) return Promise.reject(uniqueViolation(pathIndexName));
        return files.path === keys[0] ? Promise.reject(uniqueViolation(pathIndexName)) : Promise.resolve(files);
      });

      const result = await service.syncLegacyFiles(false);

      expect(result.inserted).toBe(1);
      expect(skipCount(result.skipped, LegacyFileSkipReason.ALREADY_CATALOGED)).toBe(1);

      // the batch is retried row by row, so the blob that is still missing is written
      const individual = (kycFileRepo.save as jest.Mock).mock.calls.filter(([f]) => !Array.isArray(f));
      expect(individual.map(([f]) => f.path)).toEqual([keys[0], keys[1]]);
    });

    it('does not swallow a unique violation from another constraint', async () => {
      (kycFileRepo.save as jest.Mock).mockRejectedValue(uniqueViolation('UQ_kyc_file_uid'));

      await expect(service.syncLegacyFiles(false)).rejects.toThrow('duplicate key value');
    });
  });
});
