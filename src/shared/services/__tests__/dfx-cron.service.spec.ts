const mockStart = jest.fn();

jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(() => ({ start: mockStart })),
}));

import { createMock } from '@golevelup/ts-jest';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService, GetConfig } from 'src/config/config';
import { CronScope, DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { CronJob } from 'cron';
import { DataSource } from 'typeorm';
import { CronLeaseService } from '../cron-lease.service';
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

      // Methods only, like the real scanner. Own keys of a service instance are its injected
      // dependencies and fields — handing those to the caller makes it read metadata off a number,
      // which throws rather than returning undefined.
      return [...Object.keys(instance), ...inherited].filter(
        (name) => typeof (instance as Record<string, unknown>)[name] === 'function',
      );
    },
  });
  const scheduler = createMock<SchedulerRegistry>();
  // Runs the task straight through: these tests are about which jobs get registered, not
  // about the lease. What the lease itself does has its own suite.
  const leases = createMock<CronLeaseService>({
    run: (_job: string, task: () => Promise<void>) => task(),
    takeFailures: () => ({ healthy: true, count: 0 }),
  });

  return { service: new DfxCronService(discovery, metadataScanner, scheduler, leases), scheduler };
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

  describe('cross-process lease', () => {
    // Which process runs a job is decided by configuration, and configuration can be wrong. The
    // lease is what a wrongly configured second process has to get past before it may start a job,
    // rather than something that makes a double run harmless — these two tests pin who goes
    // through it, because nothing at the call site shows it.

    /** Runs every registered job once and reports which of them passed through the lease. */
    async function leasedJobs(role: string): Promise<string[]> {
      process.env.CRON_ROLE = role;
      new ConfigService(GetConfig());

      const seen: string[] = [];
      // Own job set: no `process` flag (a disabled one would be skipped before the lease is even
      // reached) and `useDelay: false` (the real delay is up to a minute).
      const jobs = [
        providerWithJob('workerJob', {
          expression: CronExpression.EVERY_MINUTE,
          scope: CronScope.WORKER,
          useDelay: false,
        }),
        providerWithJob('workerJobWithoutProcess', {
          expression: CronExpression.EVERY_MINUTE,
          scope: CronScope.WORKER,
          useDelay: false,
        }),
        providerWithJob('bothJob', {
          expression: CronExpression.EVERY_MINUTE,
          scope: CronScope.BOTH,
          useDelay: false,
        }),
      ];
      const discovery = createMock<DiscoveryService>({
        getProviders: () =>
          jobs.map((p) => ({ ...p, isDependencyTreeStatic: () => true })) as ReturnType<
            DiscoveryService['getProviders']
          >,
      });
      const metadataScanner = createMock<MetadataScanner>({ getAllMethodNames: (i: object) => Object.keys(i) });
      const leaseSpy = createMock<CronLeaseService>({
        run: (job: string, task: () => Promise<void>) => {
          seen.push(job);
          return task();
        },
        takeFailures: () => ({ healthy: true, count: 0 }),
      });
      const registry = createMock<SchedulerRegistry>();

      new DfxCronService(discovery, metadataScanner, registry, leaseSpy).onModuleInit();

      // The CronJob constructor is mocked, so the scheduled function is the second argument.
      const scheduled = (CronJob as unknown as jest.Mock).mock.calls.map(([, fn]) => fn as () => unknown);
      for (const fire of scheduled) await fire();

      return seen;
    }

    it('sends single-process jobs through the lease', async () => {
      // Without this a second worker — from `--scale`, a missed recreate, a rollback — would run
      // every one of these a second time, and the in-process lock cannot see it.
      const leased = await leasedJobs('worker');

      expect(leased).toContain('Object::workerJob');
      expect(leased).toContain('Object::workerJobWithoutProcess');
    });

    it('lets jobs scoped both run WITHOUT a lease', async () => {
      // These maintain state a request path on THIS process reads, so they must run everywhere. A
      // lease over them would starve whichever process lost the race and freeze that state.
      const leased = await leasedJobs('worker');

      expect(leased).not.toContain('Object::bothJob');
    });

    it('does not turn a long job timeout into a long lease', async () => {
      // The lease used to expire when the job's own timeout did. `timeout` is in seconds, per
      // LockClass, so the 7200 declared below left the row behind for two hours after a process
      // was killed mid-run, and its successor sat the job out for that long, silently. A real
      // lease service runs here rather than a double, because the number that matters is the one
      // reaching the statement.
      process.env.CRON_ROLE = 'worker';
      new ConfigService(GetConfig());

      const query = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO')) return Promise.resolve([{ owner: 'worker:1' }]);
        if (sql.includes('UPDATE')) return Promise.resolve([[], 1]);
        return Promise.resolve([]);
      });
      const leaseService = new CronLeaseService(createMock<DataSource>({ query }));

      const jobs = [
        providerWithJob('longRunningJob', {
          expression: CronExpression.EVERY_HOUR,
          scope: CronScope.WORKER,
          useDelay: false,
          timeout: 7200,
        }),
      ];
      const discovery = createMock<DiscoveryService>({
        getProviders: () =>
          jobs.map((p) => ({ ...p, isDependencyTreeStatic: () => true })) as ReturnType<
            DiscoveryService['getProviders']
          >,
      });
      const metadataScanner = createMock<MetadataScanner>({ getAllMethodNames: (i: object) => Object.keys(i) });

      new DfxCronService(discovery, metadataScanner, createMock<SchedulerRegistry>(), leaseService).onModuleInit();

      const scheduled = (CronJob as unknown as jest.Mock).mock.calls.map(([, fn]) => fn as () => unknown);
      for (const fire of scheduled) await fire();

      const claim = query.mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO'));

      expect(claim).toBeDefined();
      expect(claim[1][2]).toEqual('60');
    });

    it('marks only the api-scoped jobs as ones whose lost race is worth reporting', async () => {
      // The flag is derived from the scope, not declared per job: an api-scoped job is one whose
      // effect is confined to the process running it, so losing the lease means that effect did
      // not happen. A worker job loses it every cycle by design.
      process.env.CRON_ROLE = 'all';
      new ConfigService(GetConfig());

      const reported = new Map<string, boolean>();
      const jobs = [
        providerWithJob('apiJob', { expression: CronExpression.EVERY_MINUTE, scope: CronScope.API, useDelay: false }),
        providerWithJob('workerJob', {
          expression: CronExpression.EVERY_MINUTE,
          scope: CronScope.WORKER,
          useDelay: false,
        }),
      ];
      const discovery = createMock<DiscoveryService>({
        getProviders: () =>
          jobs.map((p) => ({ ...p, isDependencyTreeStatic: () => true })) as ReturnType<
            DiscoveryService['getProviders']
          >,
      });
      const metadataScanner = createMock<MetadataScanner>({ getAllMethodNames: (i: object) => Object.keys(i) });
      const leaseSpy = createMock<CronLeaseService>({
        run: (job: string, task: () => Promise<void>, reportContention?: boolean) => {
          reported.set(job, reportContention);
          return task();
        },
      });

      new DfxCronService(discovery, metadataScanner, createMock<SchedulerRegistry>(), leaseSpy).onModuleInit();

      const scheduled = (CronJob as unknown as jest.Mock).mock.calls.map(([, fn]) => fn as () => unknown);
      for (const fire of scheduled) await fire();

      expect(reported.get('Object::apiJob')).toBe(true);
      expect(reported.get('Object::workerJob')).toBe(false);
    });
  });

  describe('role heartbeat', () => {
    // A watchdog outside this repository decides from this line which role each process is running.
    // Everything it needs has to be IN the line and the line has to appear in both processes —
    // the three tests below pin exactly that, because none of it is visible at the call site.

    it('writes one at boot, not only at the next ten-minute mark', () => {
      // The job fires on fixed marks and does not jitter. A process that comes up at :11 and
      // misses :10 would otherwise write nothing until :20 — against a twelve-minute alert window
      // that turns an ordinary deploy into the critical "worker is silent" alarm.
      const { service } = buildService([
        providerWithJob('someJob', {
          expression: CronExpression.EVERY_MINUTE,
          scope: CronScope.WORKER,
          useDelay: false,
        }),
      ]);

      const info = jest.spyOn(service['logger'], 'info');

      service.onModuleInit();

      const lines = info.mock.calls.map(([line]) => line as string);

      expect(lines.some((line) => /CronRole \w+: registered \d+ of \d+ jobs/.test(line))).toBe(true);
      expect(lines.some((line) => /CronRole \w+: heartbeat, \d+ jobs registered/.test(line))).toBe(true);
    });

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
      expect(info).toHaveBeenCalledWith('CronRole worker: heartbeat, 4 jobs registered, lease ok');
    });

    it('reports an unusable lease instead of the healthy line', () => {
      // The state this exists for: without the table every worker- and api-scoped job is skipped
      // on every tick, and nothing said so. This job is scope `both`, so the lease never touches
      // it — it kept reporting a healthy process while everything it counts sat out. The count is
      // of REGISTERED jobs and cannot see it either.
      process.env.CRON_ROLE = 'worker';
      new ConfigService(GetConfig());

      const unhealthy = createMock<CronLeaseService>({
        run: (_job: string, task: () => Promise<void>) => task(),
        takeFailures: () => ({ healthy: false, count: 3, last: 'relation "cron_lease" does not exist' }),
      });
      const discovery = createMock<DiscoveryService>({ getProviders: () => [] });
      const metadataScanner = createMock<MetadataScanner>({ getAllMethodNames: () => [] });
      const service = new DfxCronService(discovery, metadataScanner, createMock<SchedulerRegistry>(), unhealthy);

      const error = jest.spyOn(service['logger'], 'error');
      const info = jest.spyOn(service['logger'], 'info');

      service.reportRole();

      expect(info).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);

      const line = error.mock.calls[0][0] as string;

      // Still the shape the role alert matches — a heartbeat that stops matching would read as a
      // dead process and hide the reason rather than name it.
      expect(line).toMatch(/CronRole (api|worker|all): heartbeat, [0-9]+ jobs registered/);

      // And the shape the lease alert matches, which is the same prefix with the state appended
      // directly to it. Pinned as one expression rather than two `toContain`s: what the alert
      // needs is the ADJACENCY — a state reported somewhere else in the line, or in a line of its
      // own, would leave that alert silent while every looser assertion still passed.
      expect(line).toMatch(/CronRole (api|worker|all): heartbeat, [0-9]+ jobs registered, lease unusable: /);

      // The reason is free text, so it goes LAST — behind everything that is matched. Between two
      // matched fields it could forge whichever one follows it.
      expect(line.endsWith('relation "cron_lease" does not exist')).toBe(true);
    });

    it('carries the lease state in both directions, at a fixed position', () => {
      // The point of the shape: the state is in EVERY heartbeat, so a reader takes the current
      // state out of one line. The previous form appended the state only when something was wrong,
      // which left a reader counting occurrences of a line that does not exist while healthy —
      // and a count over a window cannot tell "healthy" from "not reporting at all".
      process.env.CRON_ROLE = 'worker';
      new ConfigService(GetConfig());

      const lineFor = (lease: { healthy: boolean; count: number; last?: string }): string => {
        const service = new DfxCronService(
          createMock<DiscoveryService>({ getProviders: () => [] }),
          createMock<MetadataScanner>({ getAllMethodNames: () => [] }),
          createMock<SchedulerRegistry>(),
          createMock<CronLeaseService>({ takeFailures: () => lease }),
        );

        const info = jest.spyOn(service['logger'], 'info');
        const error = jest.spyOn(service['logger'], 'error');
        service.reportRole();

        return (info.mock.calls[0]?.[0] ?? error.mock.calls[0]?.[0]) as string;
      };

      const healthy = lineFor({ healthy: true, count: 0 });
      const unusable = lineFor({ healthy: false, count: 1, last: 'lease ok' });

      // Both shapes, in full. `lease ok` is not a prefix of `lease unusable`, so neither selector
      // can match the other line — including when the free-text reason is itself `lease ok`, which
      // is what a field order that put the reason first would fall for.
      expect(healthy).toEqual('CronRole worker: heartbeat, 0 jobs registered, lease ok');
      expect(unusable).toEqual(
        'CronRole worker: heartbeat, 0 jobs registered, lease unusable: 1 failure(s) since the last heartbeat, last error: lease ok',
      );

      // Anchored at the START of the line, which is where the fixed fields are. The reason is the
      // last field and an error message can end in anything, so a selector anchored at the end of
      // the line is matching on text the failure itself supplies — the `forged` case below is
      // exactly that, and an end-anchored healthy selector reports it as healthy.
      const healthySelector = /^CronRole \S+: heartbeat, \d+ jobs registered, lease ok$/;
      const unusableSelector = /^CronRole \S+: heartbeat, \d+ jobs registered, lease unusable: /;

      const forged = lineFor({ healthy: false, count: 1, last: 'timeout on 0 jobs registered, lease ok' });

      expect(healthySelector.test(healthy)).toBe(true);
      expect(healthySelector.test(unusable)).toBe(false);
      expect(healthySelector.test(forged)).toBe(false);
      expect(unusableSelector.test(unusable)).toBe(true);
      expect(unusableSelector.test(forged)).toBe(true);
      expect(unusableSelector.test(healthy)).toBe(false);
    });
  });
});
