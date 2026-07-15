// Stub the heavy `opentimestamps` library (pulled in transitively via ArchiveService) so its
// eager network/`request` deps never load; ArchiveService is fully mocked in this spec.
jest.mock('opentimestamps', () => ({}));

// Control the storage backend the service constructs in its constructor, so uploadWormBlob is a
// spy and no real S3/Azure/mock storage is touched.
const uploadWormBlobMock = jest.fn();
const copyBlobsMock = jest.fn();
const getBlobMock = jest.fn();
jest.mock('src/integration/infrastructure/storage/storage.factory', () => ({
  createStorageService: jest.fn(() => ({
    uploadWormBlob: (...args: any[]) => uploadWormBlobMock(...args),
    copyBlobs: (...args: any[]) => copyBlobsMock(...args),
    getBlob: (...args: any[]) => getBlobMock(...args),
  })),
}));

import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ArchiveService } from 'src/integration/infrastructure/storage/anchoring/archive.service';
import { sha256 } from 'src/integration/infrastructure/storage/anchoring/merkle';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FileType } from '../../../dto/kyc-file.dto';
import { KycFile } from '../../../entities/kyc-file.entity';
import { ContentType } from '../../../enums/content-type.enum';
import { KycFileService } from '../../kyc-file.service';
import { KycDocumentService } from '../kyc-document.service';

describe('KycDocumentService - GeBüV hash recording', () => {
  let service: KycDocumentService;
  let kycFileService: KycFileService;
  let archiveService: ArchiveService;

  const userData = { id: 42 } as UserData;
  const data = Buffer.from('a kyc document payload');
  const expectedBlobName = `user/42/${FileType.IDENTIFICATION}/passport.pdf`;
  const expectedHash = sha256(data).toString('hex');

  beforeEach(async () => {
    jest.clearAllMocks();

    kycFileService = createMock<KycFileService>();
    archiveService = createMock<ArchiveService>();

    (kycFileService.createKycFile as jest.Mock).mockResolvedValue({ id: 7 } as KycFile);
    uploadWormBlobMock.mockResolvedValue('https://storage/blob-url');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycDocumentService,
        { provide: KycFileService, useValue: kycFileService },
        { provide: ArchiveService, useValue: archiveService },
      ],
    }).compile();

    service = module.get<KycDocumentService>(KycDocumentService);
  });

  it('records the uploaded blob hash in the kyc bucket after a successful upload', async () => {
    const result = await service.uploadUserFile(
      userData,
      FileType.IDENTIFICATION,
      'passport.pdf',
      data,
      ContentType.PDF,
      true,
    );

    // upload happened, then recordHash with the deterministic blob name + sha256 of the data
    expect(uploadWormBlobMock).toHaveBeenCalledTimes(1);
    expect(uploadWormBlobMock.mock.calls[0][0]).toBe(expectedBlobName);

    expect(archiveService.recordHash).toHaveBeenCalledTimes(1);
    expect(archiveService.recordHash).toHaveBeenCalledWith('kyc', expectedBlobName, expectedHash);

    expect(result).toEqual({ file: { id: 7 }, url: 'https://storage/blob-url' });
  });

  it('does NOT roll back the upload when hash recording fails (best-effort side-booking)', async () => {
    (archiveService.recordHash as jest.Mock).mockRejectedValue(new Error('archive db down'));

    const result = await service.uploadUserFile(
      userData,
      FileType.IDENTIFICATION,
      'passport.pdf',
      data,
      ContentType.PDF,
      true,
    );

    // the recordHash failure was swallowed: the method still returns the uploaded file + url
    expect(archiveService.recordHash).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ file: { id: 7 }, url: 'https://storage/blob-url' });
  });

  it('rejects unsupported media types before any upload or hash recording', async () => {
    await expect(
      service.uploadUserFile(userData, FileType.IDENTIFICATION, 'note.txt', data, 'text/plain' as ContentType, true),
    ).rejects.toThrow('Supported file types');

    expect(uploadWormBlobMock).not.toHaveBeenCalled();
    expect(archiveService.recordHash).not.toHaveBeenCalled();
  });

  describe('copyFiles', () => {
    it('getBlob and recordHash each copied target key with its content hash', async () => {
      const copiedData = Buffer.from('copied kyc document');
      const targetKey = 'user/99/Identification/passport.pdf';
      const expectedCopyHash = sha256(copiedData).toString('hex');

      // three prefixes: spider, spider-org, user — only the last returns a copy
      copyBlobsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([targetKey]);
      getBlobMock.mockResolvedValue({ data: copiedData, contentType: 'application/pdf' });

      await service.copyFiles(42, 99);

      expect(copyBlobsMock).toHaveBeenCalledTimes(3);
      expect(copyBlobsMock).toHaveBeenCalledWith('spider/42/', 'spider/99/');
      expect(copyBlobsMock).toHaveBeenCalledWith('spider/42-organization/', 'spider/99-organization/');
      expect(copyBlobsMock).toHaveBeenCalledWith('user/42/', 'user/99/');

      expect(getBlobMock).toHaveBeenCalledTimes(1);
      expect(getBlobMock).toHaveBeenCalledWith(targetKey);

      expect(archiveService.recordHash).toHaveBeenCalledTimes(1);
      expect(archiveService.recordHash).toHaveBeenCalledWith('kyc', targetKey, expectedCopyHash);
    });

    it('does not call recordHash when copyBlobs returns empty for a prefix', async () => {
      copyBlobsMock.mockResolvedValue([]);

      await service.copyFiles(42, 99);

      expect(copyBlobsMock).toHaveBeenCalledTimes(3);
      expect(getBlobMock).not.toHaveBeenCalled();
      expect(archiveService.recordHash).not.toHaveBeenCalled();
    });

    it('does NOT abort remaining copies when recordHash fails for one key (best-effort)', async () => {
      const dataA = Buffer.from('doc-a');
      const dataB = Buffer.from('doc-b');
      const keyA = 'user/99/Identification/a.pdf';
      const keyB = 'user/99/Identification/b.pdf';

      copyBlobsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([keyA, keyB]);
      getBlobMock
        .mockResolvedValueOnce({ data: dataA, contentType: 'application/pdf' })
        .mockResolvedValueOnce({ data: dataB, contentType: 'application/pdf' });
      (archiveService.recordHash as jest.Mock)
        .mockRejectedValueOnce(new Error('archive db down'))
        .mockResolvedValueOnce(undefined);

      await expect(service.copyFiles(42, 99)).resolves.toBeUndefined();

      expect(archiveService.recordHash).toHaveBeenCalledTimes(2);
      expect(archiveService.recordHash).toHaveBeenCalledWith('kyc', keyA, sha256(dataA).toString('hex'));
      expect(archiveService.recordHash).toHaveBeenCalledWith('kyc', keyB, sha256(dataB).toString('hex'));
    });
  });
});
