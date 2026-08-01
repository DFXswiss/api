// Control the storage backend the service constructs in its constructor, so uploadWormBlob is a
// spy and no real S3/Azure/mock storage is touched.
const uploadWormBlobMock = jest.fn();
const copyBlobsMock = jest.fn();
const listKeysMock = jest.fn();
jest.mock('src/integration/infrastructure/storage/storage.factory', () => ({
  createStorageService: jest.fn(() => ({
    uploadWormBlob: (...args: any[]) => uploadWormBlobMock(...args),
    copyBlobs: (...args: any[]) => copyBlobsMock(...args),
    listKeys: (...args: any[]) => listKeysMock(...args),
    blobUrl: (name: string) => `https://storage/${name}`,
  })),
}));

import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FileSubType, FileType } from '../../../dto/kyc-file.dto';
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

  describe('ensureGeneratedUserFile', () => {
    it('stores an invalid row and marks it valid only after the WORM upload succeeds', async () => {
      const generated = Object.assign(new KycFile(), { id: 17, name: 'generated.pdf', valid: false });
      (kycFileService.getByGenerationKey as jest.Mock).mockResolvedValue(null);
      (kycFileService.createKycFile as jest.Mock).mockResolvedValue(generated);

      await service.ensureGeneratedUserFile(
        'dfx-approval:11:RiskProfile:v1',
        userData,
        FileType.USER_NOTES,
        FileSubType.RISK_PROFILE,
        generated.name,
        Buffer.from('pdf'),
      );

      expect(kycFileService.createKycFile).toHaveBeenCalledWith(
        expect.objectContaining({ generationKey: 'dfx-approval:11:RiskProfile:v1', valid: false }),
      );
      expect(uploadWormBlobMock).toHaveBeenCalled();
      expect(kycFileService.markValid).toHaveBeenCalledWith(generated);
    });

    it('verifies and reuses an already valid generated document', async () => {
      const generated = Object.assign(new KycFile(), { id: 17, name: 'generated.pdf', valid: true });
      (kycFileService.getByGenerationKey as jest.Mock).mockResolvedValue(generated);
      listKeysMock.mockImplementation((prefix: string) => Promise.resolve([prefix]));

      await service.ensureGeneratedUserFile(
        'dfx-approval:11:RiskProfile:v1',
        userData,
        FileType.USER_NOTES,
        FileSubType.RISK_PROFILE,
        generated.name,
        Buffer.from('pdf'),
      );

      expect(listKeysMock).toHaveBeenCalled();
      expect(uploadWormBlobMock).not.toHaveBeenCalled();
      expect(kycFileService.markValid).not.toHaveBeenCalled();
    });

    it('continues with the winning row when two workers create the same generation key', async () => {
      const generated = Object.assign(new KycFile(), { id: 18, name: 'generated.pdf', valid: false });
      (kycFileService.getByGenerationKey as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(generated);
      (kycFileService.createKycFile as jest.Mock).mockRejectedValue({
        driverError: { code: '23505', constraint: 'IDX_dfx_kyc_file_generation_key' },
      });

      await service.ensureGeneratedUserFile(
        'dfx-approval:11:RiskProfile:v1',
        userData,
        FileType.USER_NOTES,
        FileSubType.RISK_PROFILE,
        generated.name,
        Buffer.from('pdf'),
      );

      expect(kycFileService.getByGenerationKey).toHaveBeenCalledTimes(2);
      expect(uploadWormBlobMock).toHaveBeenCalled();
      expect(kycFileService.markValid).toHaveBeenCalledWith(generated);
    });

    it('fails loudly when a document marked valid is gone from storage', async () => {
      const generated = Object.assign(new KycFile(), { id: 17, name: 'generated.pdf', valid: true });
      (kycFileService.getByGenerationKey as jest.Mock).mockResolvedValue(generated);
      listKeysMock.mockResolvedValue([]);

      await expect(
        service.ensureGeneratedUserFile(
          'dfx-approval:11:RiskProfile:v1',
          userData,
          FileType.USER_NOTES,
          FileSubType.RISK_PROFILE,
          generated.name,
          Buffer.from('pdf'),
        ),
      ).rejects.toThrow('missing in storage');
    });

    it('does not hide unrelated database errors', async () => {
      const error = { driverError: { code: '23505', constraint: 'some_other_constraint' } };
      (kycFileService.getByGenerationKey as jest.Mock).mockResolvedValue(null);
      (kycFileService.createKycFile as jest.Mock).mockRejectedValue(error);

      await expect(
        service.ensureGeneratedUserFile(
          'dfx-approval:11:RiskProfile:v1',
          userData,
          FileType.USER_NOTES,
          FileSubType.RISK_PROFILE,
          'generated.pdf',
          Buffer.from('pdf'),
        ),
      ).rejects.toBe(error);
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
