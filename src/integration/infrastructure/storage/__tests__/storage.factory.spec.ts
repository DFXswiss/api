import { Test } from '@nestjs/testing';
import { Environment } from 'src/config/config';
import { TestUtil } from 'src/shared/utils/test.util';
import { AzureStorageService } from '../azure-storage.service';
import { CompositeStorageService } from '../composite-storage.service';
import { MockStorageService } from '../mock-storage.service';
import { S3StorageService } from '../s3-storage.service';
import { createStorageService } from '../storage.factory';

const validS3 = {
  endpoint: 'https://s3.test.local',
  region: 'us-east-1',
  accessKey: 'access-key',
  secretKey: 'secret-key',
  publicUrl: 'https://files.test.local/',
};

// The factory branches on `GetConfig().environment` / `GetConfig().storage`, which read
// process.env directly (a fresh Configuration), so the environment and migration knobs are
// driven via env vars here. The injected ConfigService still supplies the global `Config`
// (s3/azure blocks); backend constructors are side-effect-free and do not read them —
// credentials are only read lazily, by the memoized client getters, on the first storage I/O call.
async function provideConfig(
  environment: Environment,
  s3 = validS3,
  writeMode?: string,
  readSource?: string,
): Promise<void> {
  process.env.ENVIRONMENT = environment;
  if (writeMode === undefined) delete process.env.STORAGE_WRITE_MODE;
  else process.env.STORAGE_WRITE_MODE = writeMode;
  if (readSource === undefined) delete process.env.STORAGE_READ_SOURCE;
  else process.env.STORAGE_READ_SOURCE = readSource;
  await Test.createTestingModule({
    providers: [TestUtil.provideConfig({ environment, s3 })],
  }).compile();
}

describe('createStorageService', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalWriteMode = process.env.STORAGE_WRITE_MODE;
  const originalReadSource = process.env.STORAGE_READ_SOURCE;

  afterAll(() => {
    process.env.ENVIRONMENT = originalEnvironment;
    if (originalWriteMode === undefined) delete process.env.STORAGE_WRITE_MODE;
    else process.env.STORAGE_WRITE_MODE = originalWriteMode;
    if (originalReadSource === undefined) delete process.env.STORAGE_READ_SOURCE;
    else process.env.STORAGE_READ_SOURCE = originalReadSource;
  });

  it('returns a MockStorageService for the LOC environment', async () => {
    await provideConfig(Environment.LOC);

    expect(createStorageService('kyc')).toBeInstanceOf(MockStorageService);
  });

  it('returns an S3StorageService when writeMode=s3 (DEV)', async () => {
    await provideConfig(Environment.DEV, validS3, 's3', 's3');

    expect(createStorageService('kyc')).toBeInstanceOf(S3StorageService);
  });

  it('returns an S3StorageService when writeMode=s3 (PRD)', async () => {
    await provideConfig(Environment.PRD, validS3, 's3', 's3');

    expect(createStorageService('kyc')).toBeInstanceOf(S3StorageService);
  });

  it('returns an AzureStorageService when writeMode=azure', async () => {
    await provideConfig(Environment.DEV, validS3, 'azure', 'azure');

    expect(createStorageService('kyc')).toBeInstanceOf(AzureStorageService);
  });

  it('returns a CompositeStorageService when writeMode=dual', async () => {
    await provideConfig(Environment.DEV, validS3, 'dual', 'azure');

    expect(createStorageService('kyc')).toBeInstanceOf(CompositeStorageService);
  });

  it('throws on invalid combo (azure write / s3 read) when the factory is invoked', async () => {
    await provideConfig(Environment.DEV, validS3, 'azure', 's3');

    expect(() => createStorageService('kyc')).toThrow(/Invalid storage config/);
  });

  it('throws when STORAGE_WRITE_MODE and STORAGE_READ_SOURCE are completely unset in a non-LOC environment', async () => {
    await provideConfig(Environment.DEV);

    expect(() => createStorageService('kyc')).toThrow(/Missing\/invalid STORAGE_WRITE_MODE/);
  });

  it('fails on the first storage call when the S3 config is incomplete', async () => {
    await provideConfig(Environment.DEV, { ...validS3, endpoint: undefined }, 's3', 's3');

    await expect(createStorageService('kyc').getBlob('x')).rejects.toThrow('Incomplete S3 config');
  });
});
