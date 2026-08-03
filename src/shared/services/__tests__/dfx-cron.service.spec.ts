const mockStart = jest.fn();

jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(() => ({ start: mockStart })),
}));

import { createMock } from '@golevelup/ts-jest';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService, GetConfig } from 'src/config/config';
import { CronScope, DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { DfxCronService } from '../dfx-cron.service';
import { Process } from '../process.service';

/** Builds a provider instance carrying @DfxCron metadata, as the decorator would. */
function providerWithJob(methodName: string, params: DfxCronParams): { instance: object } {
  const instance = {
    [methodName]: function () {
      // no-op job body
    },
  };

  Reflect.defineMetadata(DFX_CRONJOB_PARAMS, params, instance[methodName]);

  return { instance };
}

function buildService(providers: { instance: object }[]): {
  service: DfxCronService;
  scheduler: SchedulerRegistry;
} {
  const discovery = createMock<DiscoveryService>({
    getProviders: () =>
      providers.map((p) => ({ ...p, isDependencyTreeStatic: () => true })) as ReturnType<
        DiscoveryService['getProviders']
      >,
  });
  const metadataScanner = createMock<MetadataScanner>({
    // Nest walks the prototype chain. The plain test doubles carry their job as an own key, a real
    // service class carries it on its prototype — both have to be visible here, otherwise a job
    // declared on an actual service would be invisible to this suite while every assertion passes.
    getAllMethodNames: (instance: object) => {
      const proto = Object.getPrototypeOf(instance);
      const inherited =
        proto && proto !== Object.prototype
          ? Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor')
          : [];

      return [...Object.keys(instance), ...inherited];
    },
  });
  const scheduler = createMock<SchedulerRegistry>();

  return { service: new DfxCronService(discovery, metadataScanner, scheduler), scheduler };
}

describe('DfxCronService', () => {
  const original = process.env.CRON_ROLE;

  const configuredJobs = [
    providerWithJob('workerJob', {
      expression: CronExpression.EVERY_MINUTE,
      scope: CronScope.WORKER,
      process: Process.MONITOR_EVENT_LOOP,
    }),
    // A worker job without `process` — DISABLED_PROCESSES cannot stop this one, only the role can.
    providerWithJob('workerJobWithoutProcess', { expression: CronExpression.EVERY_MINUTE, scope: CronScope.WORKER }),
    providerWithJob('apiJob', { expression: CronExpression.EVERY_MINUTE, scope: CronScope.API }),
    providerWithJob('bothJob', { expression: CronExpression.EVERY_MINUTE, scope: CronScope.BOTH }),
  ];

  function registeredJobNames(scheduler: SchedulerRegistry): string[] {
    return (scheduler.addCronJob as jest.Mock).mock.calls.map(([name]) => name as string);
  }

  function runWithRole(role: string): SchedulerRegistry {
    process.env.CRON_ROLE = role;
    new ConfigService(GetConfig());

    const { service, scheduler } = buildService(configuredJobs);
    service.onModuleInit();

    return scheduler;
  }

  afterEach(() => {
    jest.clearAllMocks();

    if (original == null) delete process.env.CRON_ROLE;
    else process.env.CRON_ROLE = original;

    new ConfigService(GetConfig());
  });

  it('registers every job in the single-process role', () => {
    // The mode of local development, the test suite and any deployment without a worker: no job
    // may be dropped, otherwise `all` would not reproduce today's behaviour.
    const scheduler = runWithRole('all');

    expect(registeredJobNames(scheduler)).toEqual([
      'Object::workerJob',
      'Object::workerJobWithoutProcess',
      'Object::apiJob',
      'Object::bothJob',
    ]);
    expect(mockStart).toHaveBeenCalledTimes(4);
  });

  it('drops worker jobs in the API role, including those without a process', () => {
    // The safety property of the API process: were a worker job still registered here, it would
    // run in both processes simultaneously. Cron locks are per-process, so duplicate execution
    // would go unnoticed — and DISABLED_PROCESSES cannot catch a job without a `process`.
    const scheduler = runWithRole('api');

    expect(registeredJobNames(scheduler)).toEqual(['Object::apiJob', 'Object::bothJob']);
  });

  it('drops API jobs in the worker role', () => {
    // The counterpart: an api-scoped job drives work bound to the process holding the open
    // connections, so running it in the worker would do the work where nobody can see it.
    const scheduler = runWithRole('worker');

    expect(registeredJobNames(scheduler)).toEqual([
      'Object::workerJob',
      'Object::workerJobWithoutProcess',
      'Object::bothJob',
    ]);
  });

  it('keeps jobs scoped both in every role', () => {
    // Jobs scoped `both` refresh process-local state (the JWT denylists, the disabled-process
    // map, local caches) that requests on THIS process read. Dropping them in either role would
    // freeze that state at boot — a revoked token would keep working until the next restart.
    for (const role of ['all', 'api', 'worker']) {
      const scheduler = runWithRole(role);

      expect(registeredJobNames(scheduler)).toContain('Object::bothJob');

      jest.clearAllMocks();
    }
  });

  describe('role heartbeat', () => {
    // The alert dfx-api-role-mismatch decides from this line which role each process is running.
    // Everything it needs has to be IN the line and the line has to appear in both processes —
    // the three tests below pin exactly that, because none of it is visible at the call site.

    it('runs in every process, so neither one is invisible to the alert', () => {
      // Were this scoped `worker`, the API process would stop reporting and the alert could no
      // longer distinguish "runs the wrong role" from "reports nothing".
      const params: DfxCronParams = Reflect.getMetadata(DFX_CRONJOB_PARAMS, DfxCronService.prototype.reportRole);

      expect(params.scope).toEqual(CronScope.BOTH);
    });

    it('cannot be switched off, so a missing line always means a sick process', () => {
      // With a `process` flag, a disabled watchdog would look exactly like a process that stopped
      // writing the line.
      const params: DfxCronParams = Reflect.getMetadata(DFX_CRONJOB_PARAMS, DfxCronService.prototype.reportRole);

      expect(params.process).toBeUndefined();
    });

    it('names the role this process is actually running, and counts itself', () => {
      process.env.CRON_ROLE = 'worker';
      new ConfigService(GetConfig());

      // The service is handed its OWN instance among the providers, the way Nest does it: the job
      // lives on DfxCronService itself, so a scan that skipped it would leave the heartbeat
      // unregistered while every metadata assertion above still passed.
      const { service } = buildService(configuredJobs);
      const { service: scanned } = buildService([...configuredJobs, { instance: service }]);
      scanned.onModuleInit();

      const info = jest.spyOn(scanned['logger'], 'info');
      scanned.reportRole();

      // Three worker/both jobs plus reportRole itself. The role is what the alert matches on; the
      // count tells the reader on call whether the process registered a plausible number of jobs.
      expect(info).toHaveBeenCalledWith('CronRole worker: heartbeat, 4 jobs registered');
    });

    it('produces a line the alert query actually matches', () => {
      // The alert reads this line with `CronRole (api|worker|all): heartbeat, [0-9]+ jobs
      // registered`. Pinning the wording here is the only place that couples the two: nothing in
      // this repository fails if the message drifts, the alert just goes quiet.
      process.env.CRON_ROLE = 'api';
      new ConfigService(GetConfig());

      const { service } = buildService(configuredJobs);
      service.onModuleInit();

      const info = jest.spyOn(service['logger'], 'info');
      service.reportRole();

      const line = info.mock.calls[0][0] as string;

      expect(line).toMatch(/CronRole (api|worker|all): heartbeat, [0-9]+ jobs registered/);
    });
  });
});
