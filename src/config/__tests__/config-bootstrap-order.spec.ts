import { createMock } from '@golevelup/ts-jest';
import { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Config, Environment } from 'src/config/config';
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
  // constructs S3StorageService. Construction must stay boot-safe even when Config is still
  // undefined (S3 config is read lazily on first client use, not in the constructor).
  describe('createStorageService (KYC/support eager path)', () => {
    // Force a non-LOC environment so the factory constructs a real S3StorageService here.
    // Without this, sourcing a local .env with ENVIRONMENT=loc would make the factory return
    // a MockStorageService instead, and this test would pass vacuously even against the old,
    // broken (eager Config-reading) S3StorageService constructor.
    // Also pin STORAGE_WRITE_MODE / STORAGE_READ_SOURCE: for any non-LOC environment the
    // factory's cfg.storage.writeMode / readSource getter is fail-loud when those env vars
    // are missing/invalid (see assertValidStorageCombo in src/config/config.ts).
    let savedEnvironment: string | undefined;
    let savedStorageWriteMode: string | undefined;
    let savedStorageReadSource: string | undefined;

    beforeEach(() => {
      savedEnvironment = process.env.ENVIRONMENT;
      savedStorageWriteMode = process.env.STORAGE_WRITE_MODE;
      savedStorageReadSource = process.env.STORAGE_READ_SOURCE;
      process.env.ENVIRONMENT = Environment.DEV;
      process.env.STORAGE_WRITE_MODE = 's3';
      process.env.STORAGE_READ_SOURCE = 's3';
    });

    afterEach(() => {
      if (savedEnvironment === undefined) delete process.env.ENVIRONMENT;
      else process.env.ENVIRONMENT = savedEnvironment;
      if (savedStorageWriteMode === undefined) delete process.env.STORAGE_WRITE_MODE;
      else process.env.STORAGE_WRITE_MODE = savedStorageWriteMode;
      if (savedStorageReadSource === undefined) delete process.env.STORAGE_READ_SOURCE;
      else process.env.STORAGE_READ_SOURCE = savedStorageReadSource;
    });

    it('constructs without reading the uninitialized Config singleton', () => {
      expect(Config).toBeUndefined();
      expect(() => createStorageService('kyc')).not.toThrow();
    });
  });
});
