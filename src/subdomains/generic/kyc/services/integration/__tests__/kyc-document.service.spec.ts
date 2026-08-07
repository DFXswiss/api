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
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FileType } from '../../../dto/kyc-file.dto';
import { KycFile } from '../../../entities/kyc-file.entity';
import { ContentType } from '../../../enums/content-type.enum';
import { KycFileService } from '../../kyc-file.service';
import { KycDocumentService } from '../kyc-document.service';

describe('KycDocumentService - storage', () => {
  let service: KycDocumentService;
  let kycFileService: KycFileService;

  const userData = { id: 42 } as UserData;
  const data = Buffer.from('a kyc document payload');
  const expectedBlobName = `user/42/${FileType.IDENTIFICATION}/passport.pdf`;

  beforeEach(async () => {
    jest.clearAllMocks();

    kycFileService = createMock<KycFileService>();

    (kycFileService.createKycFile as jest.Mock).mockResolvedValue({ id: 7 } as KycFile);
    uploadWormBlobMock.mockResolvedValue('https://storage/blob-url');

    const module: TestingModule = await Test.createTestingModule({
      providers: [KycDocumentService, { provide: KycFileService, useValue: kycFileService }],
    }).compile();

    service = module.get<KycDocumentService>(KycDocumentService);
  });

  it('uploads the blob and returns the file + url', async () => {
    const result = await service.uploadUserFile(
      userData,
      FileType.IDENTIFICATION,
      'passport.pdf',
      data,
      ContentType.PDF,
      true,
    );

    expect(uploadWormBlobMock).toHaveBeenCalledTimes(1);
    expect(uploadWormBlobMock.mock.calls[0][0]).toBe(expectedBlobName);

    expect(result).toEqual({ file: { id: 7 }, url: 'https://storage/blob-url' });
  });

  it('rejects unsupported media types before any upload', async () => {
    await expect(
      service.uploadUserFile(userData, FileType.IDENTIFICATION, 'note.txt', data, 'text/plain' as ContentType, true),
    ).rejects.toThrow('Supported file types');

    expect(uploadWormBlobMock).not.toHaveBeenCalled();
  });

  describe('downloadKycFile', () => {
    const blob = { data, contentType: ContentType.PDF, created: new Date(), updated: new Date(), metadata: {} };

    beforeEach(() => getBlobMock.mockResolvedValue(blob));

    it('resolves a row without a path through the canonical layout', async () => {
      const file = { type: FileType.IDENTIFICATION, name: 'passport.pdf' } as KycFile;

      await expect(service.downloadKycFile(file, 42)).resolves.toEqual(blob);

      expect(getBlobMock).toHaveBeenCalledWith(expectedBlobName);
    });

    it('resolves a legacy row through its stored path', async () => {
      const path = 'spider/42/online-identification/1699356511987/report.pdf';
      const file = { type: FileType.IDENTIFICATION, name: 'report.pdf', path } as KycFile;

      await expect(service.downloadKycFile(file, 42)).resolves.toEqual(blob);

      expect(getBlobMock).toHaveBeenCalledWith(path);
    });
  });

  describe('copyFiles', () => {
    it('copies each target key from all three prefixes', async () => {
      const targetKey = 'user/99/Identification/passport.pdf';

      // three prefixes: spider, spider-org, user — only the last returns a copy
      copyBlobsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([targetKey]);

      await service.copyFiles(42, 99);

      expect(copyBlobsMock).toHaveBeenCalledTimes(3);
      expect(copyBlobsMock).toHaveBeenCalledWith('spider/42/', 'spider/99/');
      expect(copyBlobsMock).toHaveBeenCalledWith('spider/42-organization/', 'spider/99-organization/');
      expect(copyBlobsMock).toHaveBeenCalledWith('user/42/', 'user/99/');
    });

    it('does not fail when copyBlobs returns empty for a prefix', async () => {
      copyBlobsMock.mockResolvedValue([]);

      await service.copyFiles(42, 99);

      expect(copyBlobsMock).toHaveBeenCalledTimes(3);
    });
  });
});
