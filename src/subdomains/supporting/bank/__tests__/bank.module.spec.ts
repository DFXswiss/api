import { createMock } from '@golevelup/ts-jest';
import { Provider, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { BankModule } from '../bank.module';
import { BankAccountController } from '../bank-account/bank-account.controller';
import { BankAccountService } from '../bank-account/bank-account.service';
import { IsDfxIbanValidator } from '../bank-account/is-dfx-iban.validator';
import { BankController } from '../bank/bank.controller';
import { BankService } from '../bank/bank.service';
import { FiatRepublicVibanProvider } from '../virtual-iban/providers/fiat-republic-viban.provider';
import { FrickVibanProvider } from '../virtual-iban/providers/frick-viban.provider';
import { YapealVibanProvider } from '../virtual-iban/providers/yapeal-viban.provider';
import { VirtualIbanFrickIssuanceReconciliationService } from '../virtual-iban/virtual-iban-frick-issuance-reconciliation.service';
import { VirtualIbanService } from '../virtual-iban/virtual-iban.service';

// Compile/wiring test in the shape of accounting.module.spec.ts: instantiate this module's own
// controllers and providers with every external dependency mocked, then assert each one resolves.
// Catches a constructor that can no longer be satisfied, or a provider dropped from the metadata,
// without booting the real DataSource or the transitive feature modules.
describe('BankModule', () => {
  let testingModule: TestingModule;

  const controllers: Type[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BankModule);
  const providers: Provider[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BankModule);
  const imports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, BankModule);
  const exports: unknown[] = Reflect.getMetadata(MODULE_METADATA.EXPORTS, BankModule);

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({ controllers, providers })
      .useMocker(() => createMock())
      .compile();
  });

  afterAll(async () => {
    await testingModule?.close();
  });

  it.each([
    ['BankController', BankController],
    ['BankAccountController', BankAccountController],
  ])('resolves the controller %s', (_name, token) => {
    expect(testingModule.get(token)).toBeInstanceOf(token);
  });

  it.each([
    ['BankService', BankService],
    ['BankAccountService', BankAccountService],
    ['VirtualIbanService', VirtualIbanService],
    ['VirtualIbanFrickIssuanceReconciliationService', VirtualIbanFrickIssuanceReconciliationService],
    ['YapealVibanProvider', YapealVibanProvider],
    ['FrickVibanProvider', FrickVibanProvider],
    ['FiatRepublicVibanProvider', FiatRepublicVibanProvider],
    ['IsDfxIbanValidator', IsDfxIbanValidator],
  ])('resolves the provider %s', (_name, token) => {
    expect(testingModule.get(token)).toBeInstanceOf(token);
  });

  it('registers every virtual-IBAN provider, so none can be dropped silently', () => {
    // VirtualIbanService resolves a persisted bank name against its registered providers and fails
    // closed on an unknown one — a provider missing here would break issuance at runtime only.
    expect(providers).toContain(YapealVibanProvider);
    expect(providers).toContain(FrickVibanProvider);
    expect(providers).toContain(FiatRepublicVibanProvider);
  });

  it('exports what other modules depend on', () => {
    expect(exports).toEqual([BankAccountService, BankService, VirtualIbanService]);
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
