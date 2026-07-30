import { createMock } from '@golevelup/ts-jest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { Process } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { TestUtil } from 'src/shared/utils/test.util';
import { AccountingModule } from '../../accounting.module';

// Ledger-domain Process values, derived from the enum's OWN key names (never hardcoded) — a future
// `Process.LEDGER_*` entry is picked up automatically, no edit to this file required.
//
// Known limitation (accepted, not fixed here): this only sees a cron method that (a) lives on a class
// registered in AccountingModule's OWN `providers` array and (b) carries a `Process.LEDGER_*` value on its
// `@DfxCron` metadata. A ledger job registered in a DIFFERENT module, or one whose `@DfxCron` omits
// `process` (or sets it to something other than a `LEDGER*` enum member), is invisible to this discovery —
// exactly as it would already be invisible to the existing per-process `DISABLED_PROCESSES` kill-switches,
// which depend on the very same `process` flag. Not this test's job to fix; CONTRIBUTING requires every
// cron to carry its own Process flag regardless.
const LEDGER_PROCESSES = new Set<Process>(
  (Object.keys(Process) as (keyof typeof Process)[])
    .filter((key) => key.startsWith('LEDGER'))
    .map((key) => Process[key]),
);

interface LedgerCronEntry {
  ProviderClass: new (...args: any[]) => any;
  methodName: string;
  process: Process;
}

// Discover every ledger cron entry point from AccountingModule's OWN declared `providers` array (module
// metadata, not a hand-maintained list). A future ledger cron job only runs in production if its service
// class is registered there too — so scanning this array picks up a future job automatically, without any
// edit to this test file.
function discoverLedgerCronEntries(): LedgerCronEntry[] {
  const providers: any[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AccountingModule) ?? [];
  const entries: LedgerCronEntry[] = [];

  for (const ProviderClass of providers) {
    if (typeof ProviderClass !== 'function' || !ProviderClass.prototype) continue;

    for (const methodName of Object.getOwnPropertyNames(ProviderClass.prototype)) {
      if (methodName === 'constructor') continue;
      const methodRef = (ProviderClass.prototype as Record<string, unknown>)[methodName];
      if (typeof methodRef !== 'function') continue;

      const params: DfxCronParams | undefined = Reflect.getMetadata(DFX_CRONJOB_PARAMS, methodRef);
      if (params?.process != null && LEDGER_PROCESSES.has(params.process)) {
        entries.push({ ProviderClass, methodName, process: params.process });
      }
    }
  }

  return entries;
}

// Wraps golevelup's createMock() in a Proxy that counts every ACTUAL invocation (not mere property access)
// of any mocked/external dependency — SettingService, LogService, NotificationService, the TypeORM
// EntityManager underlying the real repositories, etc. AccountingModule's OWN providers (services,
// consumers, repositories) are constructed for real (see providers list below), so a real intra-module
// delegation (e.g. LedgerMarkToMarketService.run() → the real LedgerBookingJobService.isLedgerReady())
// still executes for real; only the genuinely EXTERNAL leaf dependencies are mocked, which is exactly where
// every real DB call ultimately lands.
function createCountingMocker(counter: { calls: number }) {
  return () => {
    const mock = createMock<any>();
    return new Proxy(mock as object, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          counter.calls++;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  };
}

describe('Ledger master switch (Config.ledger.enabled) — sustainability guard', () => {
  const providers: any[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AccountingModule);
  const controllers: any[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AccountingModule);
  const entries = discoverLedgerCronEntries();

  // Sanity: the dynamic discovery must actually find the currently known ledger cron entries — an empty or
  // undersized result would make every test below vacuously pass without checking anything.
  it('discovers at least the 13 known ledger cron entry points', () => {
    expect(entries.length).toBeGreaterThanOrEqual(13);
  });

  describe.each(
    entries.map((e): [string, LedgerCronEntry] => [`${e.ProviderClass.name}.${e.methodName} (${e.process})`, e]),
  )('%s', (_label, entry) => {
    it('reads Config.ledger.enabled and blocks every external call while it is false', async () => {
      const counter = { calls: 0 };
      const configProvider = TestUtil.provideConfig({ ledger: { enabled: false } });

      // "Zero calls" alone is too weak a proof: a future ledger cron WITHOUT any gate could coincidentally
      // return early too (e.g. an unrelated createMock() default) and this test would stay green without
      // having checked anything. Redefine `enabled` as an accessor on the (freshly built, per-test)
      // Configuration instance so we can tell whether the gate ACTUALLY consulted the switch — either
      // directly (LedgerCutoverService.run()) or transitively (isLedgerReady(), which itself reads it) —
      // rather than merely observing that nothing happened to be called.
      let switchWasRead = false;
      const originalDescriptor = Object.getOwnPropertyDescriptor(Config.ledger, 'enabled');
      Object.defineProperty(Config.ledger, 'enabled', {
        configurable: true,
        enumerable: true,
        get: () => {
          switchWasRead = true;
          return false;
        },
      });

      let testingModule: TestingModule | undefined;

      try {
        testingModule = await Test.createTestingModule({
          controllers,
          providers: [...providers, configProvider],
        })
          .useMocker(createCountingMocker(counter))
          .compile();

        const instance = testingModule.get(entry.ProviderClass);

        // Reset AFTER compile(): module compilation itself may cause harmless construction-time chatter
        // (e.g. a TypeORM repository reading entity metadata off its injected EntityManager). Only calls made
        // from HERE ON — i.e. from actually invoking the cron method below — must count.
        counter.calls = 0;

        await (instance as Record<string, () => Promise<void>>)[entry.methodName]();

        expect(switchWasRead).toBe(true); // the gate was actually consulted, not just coincidentally silent
        expect(counter.calls).toBe(0);
      } finally {
        // Undo the module compile()'s side effects first, then restore the descriptor — both run regardless
        // of whether the assertions above passed, failed, or the cron method itself threw. `Config.ledger` is
        // a single instance SHARED across every iteration of this describe.each; its getter must not leak into
        // the next entry's run and leave it in a state prepared by THIS iteration.
        if (testingModule) await testingModule.close();

        if (originalDescriptor) {
          Object.defineProperty(Config.ledger, 'enabled', originalDescriptor);
        } else {
          delete (Config.ledger as { enabled?: boolean }).enabled;
        }
      }
    });
  });
});
