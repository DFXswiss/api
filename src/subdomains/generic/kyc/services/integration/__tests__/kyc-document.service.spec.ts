// Stub the heavy `opentimestamps` library (pulled in transitively via ArchiveService) so its
// eager network/`request` deps never load; ArchiveService is fully mocked in this spec.
jest.mock('opentimestamps', () => ({}));

// Control the storage backend the service constructs in its constructor, so uploadBlob is a
// spy and no real S3/Azure/mock storage is touched.
const uploadBlobMock = jest.fn();
jest.mock('src/integration/infrastructure/storage/storage.factory', () => ({
  createStorageService: jest.fn(() => ({
    uploadBlob: (...args: any[]) => uploadBlobMock(...args),
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
    uploadBlobMock.mockResolvedValue('https://storage/blob-url');

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
    expect(uploadBlobMock).toHaveBeenCalledTimes(1);
    expect(uploadBlobMock.mock.calls[0][0]).toBe(expectedBlobName);

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

    expect(uploadBlobMock).not.toHaveBeenCalled();
    expect(archiveService.recordHash).not.toHaveBeenCalled();
  });
});
