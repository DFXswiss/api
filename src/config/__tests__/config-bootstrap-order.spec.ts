import { createMock } from '@golevelup/ts-jest';
import { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { createStorageService } from 'src/integration/infrastructure/storage/storage.factory';
import { FaucetRequestService } from 'src/subdomains/core/faucet-request/services/faucet-request.service';
import { LnUrlForwardService } from 'src/subdomains/generic/forwarding/services/lnurl-forward.service';
import { PricingRealUnitService } from 'src/subdomains/supporting/pricing/services/integration/pricing-realunit.service';
import { RealUnitService } from 'src/subdomains/supporting/realunit/realunit.service';

// Regression guard for the bootstrap-ordering crash: the exported `Config` singleton is
// undefined until ConfigService is constructed. A provider that reads `Config` while being
// constructed (e.g. in a field initializer) throws during dependency-injection if it is
// instantiated before ConfigService - which once crashed the whole API on startup.
//
// Each provider is compiled in isolation, without ConfigService, so `Config` is still
// undefined while the provider is constructed. This fails if construction reads `Config`.
describe('Config bootstrap ordering', () => {
  const providers: Type[] = [PricingRealUnitService, FaucetRequestService, RealUnitService, LnUrlForwardService];

  it('reproduces the pre-bootstrap state (Config not yet initialized)', () => {
    expect(Config).toBeUndefined();
  });

  it.each(providers.map((provider) => [provider.name, provider] as const))(
    'instantiates %s without reading Config at construction time',
    async (_name, provider) => {
      const moduleRef = await Test.createTestingModule({ providers: [provider] })
        .useMocker(() => createMock())
        .compile();

      expect(moduleRef.get(provider)).toBeDefined();

      await moduleRef.close();
    },
  );

  // Separate from the providers[] array above: KycDocumentService / SupportDocumentService
  // eagerly call createStorageService(container) in their constructors, which (outside LOC)
  // constructs S3StorageService and validates that endpoint/region/accessKey/secretKey/publicUrl
  // are all present. Jest does not load .env / S3_* vars, so compiling those providers in the
  // array style would throw "Incomplete S3 config" — a real failure unrelated to the bootstrap
  // ordering bug this file guards. Stub S3_* only for this test, then restore.
  describe('createStorageService (KYC/support eager path)', () => {
    const s3EnvKeys = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_PUBLIC_URL'] as const;
    const saved: Partial<Record<(typeof s3EnvKeys)[number], string | undefined>> = {};

    beforeEach(() => {
      for (const key of s3EnvKeys) {
        saved[key] = process.env[key];
      }
      process.env.S3_ENDPOINT = 'https://s3.test.local';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY = 'access-key';
      process.env.S3_SECRET_KEY = 'secret-key';
      process.env.S3_PUBLIC_URL = 'https://files.test.local/'; // trailing slash required
    });

    afterEach(() => {
      for (const key of s3EnvKeys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    it('constructs without reading the uninitialized Config singleton', () => {
      expect(Config).toBeUndefined();
      expect(() => createStorageService('kyc')).not.toThrow();
    });
  });
});
