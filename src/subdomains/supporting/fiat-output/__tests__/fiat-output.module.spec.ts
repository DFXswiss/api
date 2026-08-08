import { createMock } from '@golevelup/ts-jest';
import { Provider, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { Ep2ReportService } from '../ep2-report.service';
import { FiatOutputFiatRepublicService } from '../fiat-output-fiat-republic.service';
import { FiatOutputFrickService } from '../fiat-output-frick.service';
import { FiatOutputJobService } from '../fiat-output-job.service';
import { FiatOutputController } from '../fiat-output.controller';
import { FiatOutputModule } from '../fiat-output.module';
import { FiatOutputService } from '../fiat-output.service';

// Compile/wiring test in the shape of accounting.module.spec.ts: instantiate this module's own
// controllers and providers with every external dependency mocked, then assert each one resolves.
// Catches a constructor that can no longer be satisfied, or a provider dropped from the metadata,
// without booting the real DataSource or the transitive feature modules.
describe('FiatOutputModule', () => {
  let testingModule: TestingModule;

  const controllers: Type[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, FiatOutputModule);
  const providers: Provider[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FiatOutputModule);
  const imports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, FiatOutputModule);
  const exports: unknown[] = Reflect.getMetadata(MODULE_METADATA.EXPORTS, FiatOutputModule);

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({ controllers, providers })
      .useMocker(() => createMock())
      .compile();
  });

  afterAll(async () => {
    await testingModule?.close();
  });

  it('resolves the FiatOutputController', () => {
    expect(testingModule.get(FiatOutputController)).toBeInstanceOf(FiatOutputController);
  });

  it.each([
    ['FiatOutputService', FiatOutputService],
    ['FiatOutputJobService', FiatOutputJobService],
    ['FiatOutputFrickService', FiatOutputFrickService],
    ['FiatOutputFiatRepublicService', FiatOutputFiatRepublicService],
    ['Ep2ReportService', Ep2ReportService],
  ])('resolves the provider %s', (_name, token) => {
    expect(testingModule.get(token)).toBeInstanceOf(token);
  });

  it('registers a transmission service per automated payout rail', () => {
    // FiatOutputJobService drives each rail's transmitPayments from the minutely job; a service
    // missing here would silently stop that rail from ever sending.
    expect(providers).toContain(FiatOutputFrickService);
    expect(providers).toContain(FiatOutputFiatRepublicService);
  });

  it('exports what other modules depend on', () => {
    expect(exports).toEqual([FiatOutputService]);
  });

  // forwardRef arguments are lazy thunks Nest only calls while resolving the graph. A broken (circular)
  // import makes one resolve to undefined, which surfaces as an opaque boot failure — resolving them
  // here turns that into a failing test instead.
  it('resolves every forward reference to a real module', () => {
    const forwardRefs = imports.filter(
      (entry): entry is { forwardRef: () => unknown } =>
        typeof (entry as { forwardRef?: unknown })?.forwardRef === 'function',
    );
    expect(forwardRefs.length).toBeGreaterThan(0);

    for (const entry of forwardRefs) {
      expect(entry.forwardRef()).toBeDefined();
    }
  });
});
