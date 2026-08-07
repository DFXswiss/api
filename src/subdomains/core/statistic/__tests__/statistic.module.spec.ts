import { createMock } from '@golevelup/ts-jest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserRepository } from 'src/subdomains/generic/user/models/user/user.repository';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { PartnerStatisticRateLimitGuard } from '../partner-statistic-rate-limit.guard';
import { PartnerStatisticController } from '../partner-statistic.controller';
import { PartnerStatisticService } from '../partner-statistic.service';
import { StatisticController } from '../statistic.controller';
import { StatisticModule } from '../statistic.module';
import { StatisticService } from '../statistic.service';

// Compile/wiring test: instantiate the module's own controllers + providers with every external
// dependency mocked, then assert each provider actually resolves. Catches a constructor that can
// no longer be satisfied or a provider dropped from the @Module() metadata, without booting
// TypeORM or the transitive feature modules.
describe('StatisticModule', () => {
  let testingModule: TestingModule;

  const controllers: any[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StatisticModule);
  const providers: any[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StatisticModule);

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({ controllers, providers })
      .useMocker(() => createMock())
      .compile();
  });

  afterAll(async () => {
    await testingModule?.close();
  });

  it('declares StatisticController and PartnerStatisticController', () => {
    expect(controllers).toEqual([StatisticController, PartnerStatisticController]);
  });

  it('resolves StatisticController', () => {
    expect(testingModule.get(StatisticController)).toBeInstanceOf(StatisticController);
  });

  it('resolves PartnerStatisticController', () => {
    expect(testingModule.get(PartnerStatisticController)).toBeInstanceOf(PartnerStatisticController);
  });

  const coreProviders: [string, any][] = [
    ['StatisticService', StatisticService],
    ['PartnerStatisticService', PartnerStatisticService],
    ['PartnerStatisticRateLimitGuard', PartnerStatisticRateLimitGuard],
    ['BuyFiatRepository', BuyFiatRepository],
    ['UserRepository', UserRepository],
    ['WalletRepository', WalletRepository],
  ];

  it.each(coreProviders)('resolves the provider %s', (_name, token) => {
    expect(testingModule.get(token)).toBeInstanceOf(token);
  });

  it('registers every metadata provider as resolvable', () => {
    for (const token of providers) {
      expect(testingModule.get(token)).toBeDefined();
    }
  });

  it('exports nothing', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, StatisticModule);
    expect(exports).toEqual([]);
  });
});
