import { Test } from '@nestjs/testing';
import { Environment } from 'src/config/config';
import { TestUtil } from 'src/shared/utils/test.util';
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

// The factory branches on `GetConfig().environment`, which reads process.env.ENVIRONMENT
// directly (a fresh Configuration), so the environment is driven via the env var here.
// The injected ConfigService still supplies the global `Config` (s3 block) used by the
// S3StorageService constructor.
async function provideConfig(environment: Environment, s3 = validS3): Promise<void> {
  process.env.ENVIRONMENT = environment;
  await Test.createTestingModule({
    providers: [TestUtil.provideConfig({ environment, s3 })],
  }).compile();
}

describe('createStorageService', () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  afterAll(() => {
    process.env.ENVIRONMENT = originalEnvironment;
  });

  it('returns a MockStorageService for the LOC environment', async () => {
    await provideConfig(Environment.LOC);

    expect(createStorageService('kyc')).toBeInstanceOf(MockStorageService);
  });

  it('returns an S3StorageService for the DEV environment', async () => {
    await provideConfig(Environment.DEV);

    expect(createStorageService('kyc')).toBeInstanceOf(S3StorageService);
  });

  it('returns an S3StorageService for the PRD environment', async () => {
    await provideConfig(Environment.PRD);

    expect(createStorageService('kyc')).toBeInstanceOf(S3StorageService);
  });

  it('fails fast on an incomplete S3 config in a non-LOC environment', async () => {
    await provideConfig(Environment.DEV, { ...validS3, endpoint: undefined });

    expect(() => createStorageService('kyc')).toThrow('Incomplete S3 config');
  });
});
