import { createMock } from '@golevelup/ts-jest';
import { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Config } from 'src/config/config';
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
});
