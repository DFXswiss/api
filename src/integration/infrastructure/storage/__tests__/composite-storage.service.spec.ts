import { Test } from '@nestjs/testing';
import { assertValidStorageCombo, Config, Environment, StorageReadSource, StorageWriteMode } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TestUtil } from 'src/shared/utils/test.util';
import { AzureStorageService } from '../azure-storage.service';
import { CompositeStorageService } from '../composite-storage.service';
import { S3StorageService } from '../s3-storage.service';

const CONTAINER = 'kyc';
const S3_PUBLIC_URL = 'https://files.test.local/';
const AZURE_URL = 'https://myaccount.blob.core.windows.net/';

const validS3 = {
  endpoint: 'https://s3.test.local',
  region: 'us-east-1',
  accessKey: 'access-key',
  secretKey: 'secret-key',
  publicUrl: S3_PUBLIC_URL,
};

const validAzure = {
  storage: {
    url: AZURE_URL,
    connectionString:
      'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net;BlobEndpoint=https://myaccount.blob.core.windows.net/',
  },
};

async function provideConfig(writeMode: StorageWriteMode, readSource: StorageReadSource): Promise<void> {
  process.env.ENVIRONMENT = Environment.DEV;
  process.env.STORAGE_WRITE_MODE = writeMode;
  process.env.STORAGE_READ_SOURCE = readSource;
  await Test.createTestingModule({
    providers: [TestUtil.provideConfig({ environment: Environment.DEV, s3: validS3, azure: validAzure })],
  }).compile();
}

describe('CompositeStorageService', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalWriteMode = process.env.STORAGE_WRITE_MODE;
  const originalReadSource = process.env.STORAGE_READ_SOURCE;

  let s3Upload: jest.SpyInstance;
  let azureUpload: jest.SpyInstance;
  let s3UploadWorm: jest.SpyInstance;
  let azureUploadWorm: jest.SpyInstance;
  let s3GetBlob: jest.SpyInstance;
  let azureGetBlob: jest.SpyInstance;
  let s3ListBlobs: jest.SpyInstance;
  let azureListBlobs: jest.SpyInstance;
  let s3ListKeys: jest.SpyInstance;
  let azureListKeys: jest.SpyInstance;
  let s3Copy: jest.SpyInstance;
  let azureCopy: jest.SpyInstance;

  afterAll(() => {
    process.env.ENVIRONMENT = originalEnvironment;
    if (originalWriteMode === undefined) delete process.env.STORAGE_WRITE_MODE;
    else process.env.STORAGE_WRITE_MODE = originalWriteMode;
    if (originalReadSource === undefined) delete process.env.STORAGE_READ_SOURCE;
    else process.env.STORAGE_READ_SOURCE = originalReadSource;
  });

  beforeEach(() => {
    s3Upload = jest
      .spyOn(S3StorageService.prototype, 'uploadBlob')
      .mockImplementation(async (name) => `${S3_PUBLIC_URL}${CONTAINER}/${name}`);
    azureUpload = jest
      .spyOn(AzureStorageService.prototype, 'uploadBlob')
      .mockImplementation(async (name) => `${AZURE_URL}${CONTAINER}/${name}`);
    s3UploadWorm = jest
      .spyOn(S3StorageService.prototype, 'uploadWormBlob')
      .mockImplementation(async (name) => `${S3_PUBLIC_URL}${CONTAINER}/${name}`);
    azureUploadWorm = jest
      .spyOn(AzureStorageService.prototype, 'uploadWormBlob')
      .mockImplementation(async (name) => `${AZURE_URL}${CONTAINER}/${name}`);
    s3GetBlob = jest.spyOn(S3StorageService.prototype, 'getBlob').mockResolvedValue({
      data: Buffer.from('s3'),
      contentType: 'text/plain',
      created: new Date(),
      updated: new Date(),
      metadata: {},
    });
    azureGetBlob = jest.spyOn(AzureStorageService.prototype, 'getBlob').mockResolvedValue({
      data: Buffer.from('azure'),
      contentType: 'text/plain',
      created: new Date(),
      updated: new Date(),
      metadata: {},
    });
    s3ListBlobs = jest.spyOn(S3StorageService.prototype, 'listBlobs').mockResolvedValue([]);
    azureListBlobs = jest.spyOn(AzureStorageService.prototype, 'listBlobs').mockResolvedValue([]);
    s3ListKeys = jest.spyOn(S3StorageService.prototype, 'listKeys').mockResolvedValue(['s3-key']);
    azureListKeys = jest.spyOn(AzureStorageService.prototype, 'listKeys').mockResolvedValue(['azure-key']);
    s3Copy = jest.spyOn(S3StorageService.prototype, 'copyBlobs').mockResolvedValue(['dst/from-s3']);
    azureCopy = jest.spyOn(AzureStorageService.prototype, 'copyBlobs').mockResolvedValue(['dst/from-azure']);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('assertValidStorageCombo / Config.storage getter', () => {
    it('rejects invalid (azure,s3) and (s3,azure) combinations', () => {
      expect(() => assertValidStorageCombo('azure', 's3')).toThrow(/azure.*s3|s3.*azure/);
      expect(() => assertValidStorageCombo('s3', 'azure')).toThrow(/azure.*s3|s3.*azure/);
      expect(() => assertValidStorageCombo('azure', 's3')).toThrow('Invalid storage config');
      expect(() => assertValidStorageCombo('s3', 'azure')).toThrow('Invalid storage config');
    });

    it('accepts all four valid combinations', () => {
      expect(() => assertValidStorageCombo('azure', 'azure')).not.toThrow();
      expect(() => assertValidStorageCombo('dual', 'azure')).not.toThrow();
      expect(() => assertValidStorageCombo('dual', 's3')).not.toThrow();
      expect(() => assertValidStorageCombo('s3', 's3')).not.toThrow();
    });

    it('Config.storage re-validates from process.env for non-LOC', async () => {
      process.env.ENVIRONMENT = Environment.DEV;
      process.env.STORAGE_WRITE_MODE = 'azure';
      process.env.STORAGE_READ_SOURCE = 's3';
      await Test.createTestingModule({
        providers: [TestUtil.provideConfig({ environment: Environment.DEV, s3: validS3, azure: validAzure })],
      }).compile();

      expect(() => Config.storage).toThrow(/Invalid storage config/);
    });
  });

  describe('uploadBlob dual mode', () => {
    it('calls both backends with the identical name/data/type/metadata and returns the S3 URL', async () => {
      await provideConfig('dual', 'azure');
      const data = Buffer.from('payload');
      const meta = { owner: 'u1' };

      const url = await new CompositeStorageService(CONTAINER).uploadBlob(
        'user/1/a.pdf',
        data,
        'application/pdf',
        meta,
      );

      expect(url).toBe(`${S3_PUBLIC_URL}${CONTAINER}/user/1/a.pdf`);
      expect(azureUpload).toHaveBeenCalledWith('user/1/a.pdf', data, 'application/pdf', meta);
      expect(s3Upload).toHaveBeenCalledWith('user/1/a.pdf', data, 'application/pdf', meta);
      // readSource=azure → Azure written first
      expect(azureUpload.mock.invocationCallOrder[0]).toBeLessThan(s3Upload.mock.invocationCallOrder[0]);
    });

    it('writes S3 first when readSource=s3', async () => {
      await provideConfig('dual', 's3');
      const data = Buffer.from('x');

      await new CompositeStorageService(CONTAINER).uploadBlob('k', data, 'text/plain');

      expect(s3Upload.mock.invocationCallOrder[0]).toBeLessThan(azureUpload.mock.invocationCallOrder[0]);
    });

    it('rejects the whole call when the first (read-source) backend rejects', async () => {
      await provideConfig('dual', 'azure');
      azureUpload.mockRejectedValue(new Error('azure write failed'));

      await expect(
        new CompositeStorageService(CONTAINER).uploadBlob('k', Buffer.from('x'), 'text/plain'),
      ).rejects.toThrow('azure write failed');
    });

    it('resolves with the Azure URL and logs DUAL_WRITE_SECONDARY_FAILURE when secondary (s3) rejects after azure succeeded (readSource=azure)', async () => {
      await provideConfig('dual', 'azure');
      s3Upload.mockRejectedValue(new Error('s3 write failed'));
      const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

      const url = await new CompositeStorageService(CONTAINER).uploadBlob('k', Buffer.from('x'), 'text/plain');

      expect(url).toBe(`${AZURE_URL}${CONTAINER}/k`);
      expect(azureUpload).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('DUAL_WRITE_SECONDARY_FAILURE');
      expect(errorSpy.mock.calls[0][1]).toEqual(expect.any(Error));
    });

    it('rejects when read-source (s3) rejects under dual/s3', async () => {
      await provideConfig('dual', 's3');
      s3Upload.mockRejectedValue(new Error('s3 write failed'));

      await expect(
        new CompositeStorageService(CONTAINER).uploadBlob('k', Buffer.from('x'), 'text/plain'),
      ).rejects.toThrow('s3 write failed');
    });

    it('resolves with the S3 URL and logs DUAL_WRITE_SECONDARY_FAILURE when secondary (azure) rejects after s3 succeeded (readSource=s3)', async () => {
      await provideConfig('dual', 's3');
      azureUpload.mockRejectedValue(new Error('azure write failed'));
      const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

      const url = await new CompositeStorageService(CONTAINER).uploadBlob('k', Buffer.from('x'), 'text/plain');

      expect(url).toBe(`${S3_PUBLIC_URL}${CONTAINER}/k`);
      expect(s3Upload).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('DUAL_WRITE_SECONDARY_FAILURE');
      expect(errorSpy.mock.calls[0][1]).toEqual(expect.any(Error));
    });
  });

  describe('uploadBlob single-backend modes', () => {
    it('azure mode only calls Azure and returns an Azure-host URL', async () => {
      await provideConfig('azure', 'azure');

      const url = await new CompositeStorageService(CONTAINER).uploadBlob(
        'a.bin',
        Buffer.from('x'),
        'application/octet-stream',
      );

      expect(url).toBe(`${AZURE_URL}${CONTAINER}/a.bin`);
      expect(azureUpload).toHaveBeenCalledTimes(1);
      expect(s3Upload).not.toHaveBeenCalled();
    });

    it('s3 mode only calls S3 and returns an S3-host URL', async () => {
      await provideConfig('s3', 's3');

      const url = await new CompositeStorageService(CONTAINER).uploadBlob(
        'a.bin',
        Buffer.from('x'),
        'application/octet-stream',
      );

      expect(url).toBe(`${S3_PUBLIC_URL}${CONTAINER}/a.bin`);
      expect(s3Upload).toHaveBeenCalledTimes(1);
      expect(azureUpload).not.toHaveBeenCalled();
    });
  });

  describe('read routing', () => {
    it.each<[StorageWriteMode, StorageReadSource]>([
      ['dual', 'azure'],
      ['dual', 's3'],
      ['azure', 'azure'],
      ['s3', 's3'],
    ])(
      'writeMode=%s readSource=%s: getBlob/listBlobs/listKeys only touch the read backend',
      async (writeMode, readSource) => {
        await provideConfig(writeMode, readSource);
        const service = new CompositeStorageService(CONTAINER);

        await service.getBlob('x');
        await service.listBlobs('p/');
        await service.listKeys('p/');

        if (readSource === 'azure') {
          expect(azureGetBlob).toHaveBeenCalledWith('x');
          expect(azureListBlobs).toHaveBeenCalledWith('p/');
          expect(azureListKeys).toHaveBeenCalledWith('p/');
          expect(s3GetBlob).not.toHaveBeenCalled();
          expect(s3ListBlobs).not.toHaveBeenCalled();
          expect(s3ListKeys).not.toHaveBeenCalled();
        } else {
          expect(s3GetBlob).toHaveBeenCalledWith('x');
          expect(s3ListBlobs).toHaveBeenCalledWith('p/');
          expect(s3ListKeys).toHaveBeenCalledWith('p/');
          expect(azureGetBlob).not.toHaveBeenCalled();
          expect(azureListBlobs).not.toHaveBeenCalled();
          expect(azureListKeys).not.toHaveBeenCalled();
        }
      },
    );
  });

  describe('copyBlobs dual mode', () => {
    it('succeeds when one backend returns [] and returns the S3 target keys', async () => {
      await provideConfig('dual', 'azure');
      azureCopy.mockResolvedValue([]);
      s3Copy.mockResolvedValue(['dst/a', 'dst/b']);

      const result = await new CompositeStorageService(CONTAINER).copyBlobs('src/', 'dst/');

      expect(result).toEqual(['dst/a', 'dst/b']);
      expect(azureCopy).toHaveBeenCalledWith('src/', 'dst/');
      expect(s3Copy).toHaveBeenCalledWith('src/', 'dst/');
    });

    it('logs a warning on dual-write length asymmetry but still returns the S3 result (never throws)', async () => {
      await provideConfig('dual', 'azure');
      azureCopy.mockResolvedValue(['dst/from-azure-only']);
      s3Copy.mockResolvedValue(['dst/a', 'dst/b']);
      const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();

      const result = await new CompositeStorageService(CONTAINER).copyBlobs('src/', 'dst/');

      expect(result).toEqual(['dst/a', 'dst/b']);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('copyBlobs dual-write asymmetry');
      expect(warnSpy.mock.calls[0][0]).toContain('sourcePrefix=src/');
      expect(warnSpy.mock.calls[0][0]).toContain('targetPrefix=dst/');
      expect(warnSpy.mock.calls[0][0]).toContain('azureCount=1');
      expect(warnSpy.mock.calls[0][0]).toContain('s3Count=2');
      expect(warnSpy.mock.calls[0][0]).toContain('reconciler gate must heal this divergence before the read flip');
    });

    it('does not warn when both backends copy the same number of objects', async () => {
      await provideConfig('dual', 'azure');
      azureCopy.mockResolvedValue(['dst/a', 'dst/b']);
      s3Copy.mockResolvedValue(['dst/a', 'dst/b']);
      const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();

      const result = await new CompositeStorageService(CONTAINER).copyBlobs('src/', 'dst/');

      expect(result).toEqual(['dst/a', 'dst/b']);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('copies S3 first when readSource=s3', async () => {
      await provideConfig('dual', 's3');

      await new CompositeStorageService(CONTAINER).copyBlobs('src/', 'dst/');

      expect(s3Copy.mock.invocationCallOrder[0]).toBeLessThan(azureCopy.mock.invocationCallOrder[0]);
    });

    it('rejects the whole call when the read-source backend copyBlobs rejects', async () => {
      await provideConfig('dual', 'azure');
      azureCopy.mockRejectedValue(new Error('azure copy failed'));

      await expect(new CompositeStorageService(CONTAINER).copyBlobs('src/', 'dst/')).rejects.toThrow(
        'azure copy failed',
      );
    });

    it('resolves with empty S3 result and logs DUAL_WRITE_SECONDARY_FAILURE when secondary (s3) copyBlobs rejects (readSource=azure)', async () => {
      await provideConfig('dual', 'azure');
      s3Copy.mockRejectedValue(new Error('s3 copy failed'));
      const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
      const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();

      const result = await new CompositeStorageService(CONTAINER).copyBlobs('src/', 'dst/');

      expect(result).toEqual([]);
      expect(azureCopy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('DUAL_WRITE_SECONDARY_FAILURE');
      expect(errorSpy.mock.calls[0][1]).toEqual(expect.any(Error));
      // empty secondary result vs non-empty azure triggers the existing asymmetry warning
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain('copyBlobs dual-write asymmetry');
    });
  });

  describe('uploadWormBlob', () => {
    it('rejects the whole dual call when S3 Object-Lock verification fails', async () => {
      await provideConfig('dual', 's3');
      s3UploadWorm.mockRejectedValue(new Error('Object Lock is not enabled'));

      await expect(
        new CompositeStorageService(CONTAINER).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('Object Lock is not enabled');
    });

    it('rejects in s3 mode when S3 Object-Lock verification fails', async () => {
      await provideConfig('s3', 's3');
      s3UploadWorm.mockRejectedValue(new Error('could not verify Object Lock is enabled'));

      await expect(
        new CompositeStorageService(CONTAINER).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('could not verify Object Lock is enabled');
      expect(azureUploadWorm).not.toHaveBeenCalled();
    });

    it('resolves with the Azure URL and logs DUAL_WRITE_SECONDARY_FAILURE when secondary (s3) fails after azure succeeded (readSource=azure)', async () => {
      await provideConfig('dual', 'azure');
      s3UploadWorm.mockRejectedValue(new Error('Object Lock is not enabled'));
      const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

      const url = await new CompositeStorageService(CONTAINER).uploadWormBlob(
        'settlement.ep2',
        Buffer.from('<ep2/>'),
        'text/xml',
      );

      expect(url).toBe(`${AZURE_URL}${CONTAINER}/settlement.ep2`);
      expect(azureUploadWorm).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('DUAL_WRITE_SECONDARY_FAILURE');
      expect(errorSpy.mock.calls[0][1]).toEqual(expect.any(Error));
    });

    it('rejects when read-source (azure) rejects under dual/azure', async () => {
      await provideConfig('dual', 'azure');
      azureUploadWorm.mockRejectedValue(new Error('azure worm write failed'));

      await expect(
        new CompositeStorageService(CONTAINER).uploadWormBlob('settlement.ep2', Buffer.from('<ep2/>'), 'text/xml'),
      ).rejects.toThrow('azure worm write failed');
    });

    it('resolves with the S3 URL and logs DUAL_WRITE_SECONDARY_FAILURE when secondary (azure) fails after s3 succeeded (readSource=s3)', async () => {
      await provideConfig('dual', 's3');
      azureUploadWorm.mockRejectedValue(new Error('azure worm write failed'));
      const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

      const url = await new CompositeStorageService(CONTAINER).uploadWormBlob(
        'settlement.ep2',
        Buffer.from('<ep2/>'),
        'text/xml',
      );

      expect(url).toBe(`${S3_PUBLIC_URL}${CONTAINER}/settlement.ep2`);
      expect(s3UploadWorm).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('DUAL_WRITE_SECONDARY_FAILURE');
      expect(errorSpy.mock.calls[0][1]).toEqual(expect.any(Error));
    });

    it('calls both uploadWormBlob paths in dual mode (never uploadBlob directly)', async () => {
      await provideConfig('dual', 'azure');

      const url = await new CompositeStorageService(CONTAINER).uploadWormBlob(
        'settlement.ep2',
        Buffer.from('<ep2/>'),
        'text/xml',
      );

      expect(url).toBe(`${S3_PUBLIC_URL}${CONTAINER}/settlement.ep2`);
      expect(azureUploadWorm).toHaveBeenCalledWith('settlement.ep2', expect.any(Buffer), 'text/xml', undefined);
      expect(s3UploadWorm).toHaveBeenCalledWith('settlement.ep2', expect.any(Buffer), 'text/xml', undefined);
      expect(Buffer.from(azureUploadWorm.mock.calls[0][1] as Buffer).toString()).toBe('<ep2/>');
      expect(Buffer.from(s3UploadWorm.mock.calls[0][1] as Buffer).toString()).toBe('<ep2/>');
      expect(s3Upload).not.toHaveBeenCalled();
      expect(azureUpload).not.toHaveBeenCalled();
    });
  });
});
