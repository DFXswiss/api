import { createMock } from '@golevelup/ts-jest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core';
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
//
// Two blind spots that used to belong on that list are covered now: a cron method INHERITED from a base class
// (discovery walks the whole prototype chain, exactly as the production scheduler does), and a ledger method
// scheduled with Nest's native `@Cron` instead of `@DfxCron` (its own test below fails on it instead of
// silently not discovering it).
const LEDGER_PROCESSES = new Set<Process>(
  (Object.keys(Process) as (keyof typeof Process)[])
    .filter((key) => key.startsWith('LEDGER'))
    .map((key) => Process[key]),
);

// Metadata key that Nest's NATIVE `@Cron` (from `@nestjs/schedule`) writes onto the decorated method. Held as
// a string literal on purpose: the exported constant lives in `@nestjs/schedule/dist/schedule.constants` and
// is NOT re-exported from the package root, so importing it would mean reaching into the package's dist
// internals — a far more brittle coupling than the key's value, which is what the decorator writes at runtime.
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

// The very scanner the production scheduler uses (`DfxCronService.onModuleInit`). Using anything narrower —
// e.g. a single `Object.getOwnPropertyNames(prototype)` level — would give this test a SMALLER view than the
// one that actually schedules jobs: a cron sitting on a base class is registered in production but would go
// unexamined here.
const metadataScanner = new MetadataScanner();

interface LedgerCronEntry {
  ProviderClass: new (...args: any[]) => any;
  methodName: string;
  process: Process;
}

// Every class in AccountingModule's OWN declared `providers` array (module metadata, not a hand-maintained
// list) paired with the methods the production scanner would see on it. A future ledger cron job only runs in
// production if its service class is registered there too — so scanning this array picks up a future job
// automatically, without any edit to this test file. Both checks below share this one list so they can never
// disagree about WHICH methods are in scope.
function scanProviderMethods(): { ProviderClass: new (...args: any[]) => any; methodNames: string[] }[] {
  const providers: any[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AccountingModule) ?? [];

  return providers
    .filter((ProviderClass) => typeof ProviderClass === 'function' && ProviderClass.prototype)
    .map((ProviderClass) => ({
      ProviderClass,
      // getAllMethodNames() takes the prototype itself (no instance needed), walks the chain up to — but not
      // including — Object.prototype, and already drops `constructor` and accessors.
      methodNames: metadataScanner.getAllMethodNames(ProviderClass.prototype),
    }));
}

// Discover every ledger cron entry point: a scanned method carrying `@DfxCron` metadata with a
// `Process.LEDGER_*` value.
function discoverLedgerCronEntries(): LedgerCronEntry[] {
  const entries: LedgerCronEntry[] = [];

  for (const { ProviderClass, methodNames } of scanProviderMethods()) {
    for (const methodName of methodNames) {
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

  // The discovery above — and with it every per-entry proof below — keys on `@DfxCron` metadata. A method
  // scheduled with Nest's NATIVE `@Cron` is started by `@nestjs/schedule` itself and never passes through
  // `DfxCronService`, so it would be silently absent from `entries`: scheduled in production, yet never shown
  // to consult the master switch (and out of reach of its `Process` kill-switch too). The native decorator is
  // legitimate elsewhere in the codebase, so this guards the ledger providers specifically rather than the
  // import as such.
  it('schedules no accounting cron via Nest-native @Cron, which the master switch cannot reach', () => {
    const nativeCronMethods = scanProviderMethods().flatMap(({ ProviderClass, methodNames }) =>
      methodNames
        .filter((methodName) => {
          const methodRef = (ProviderClass.prototype as Record<string, unknown>)[methodName];
          if (typeof methodRef !== 'function') return false;

          return Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, methodRef) != null;
        })
        .map((methodName) => `${ProviderClass.name}.${methodName}`),
    );

    // Asserted as a message rather than as an empty array so the failure states the CONSEQUENCE, not just the
    // offending method name.
    const violation =
      nativeCronMethods.length > 0
        ? `Scheduled with Nest-native @Cron: ${nativeCronMethods.join(', ')} — @nestjs/schedule starts these ` +
          `directly, so they bypass DfxCronService entirely and nothing subjects them to the ` +
          `Config.ledger.enabled master switch (or to their Process kill-switch). Use @DfxCron instead.`
        : '';

    expect(violation).toBe('');
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
