const mockStart = jest.fn();

jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(() => ({ start: mockStart })),
}));

import { createMock } from '@golevelup/ts-jest';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Config, ConfigService, GetConfig } from 'src/config/config';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { Process } from '../process.service';
import { DfxCronService } from '../dfx-cron.service';

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
    getAllMethodNames: (instance: object) => Object.keys(instance),
  });
  const scheduler = createMock<SchedulerRegistry>();

  return { service: new DfxCronService(discovery, metadataScanner, scheduler), scheduler };
}

describe('DfxCronService', () => {
  const configuredJobs = [
    providerWithJob('withProcess', { expression: CronExpression.EVERY_MINUTE, process: Process.MONITOR_EVENT_LOOP }),
    // A job without `process` — DISABLED_PROCESSES cannot stop this one, only the global switch can.
    providerWithJob('withoutProcess', { expression: CronExpression.EVERY_MINUTE }),
  ];

  afterEach(() => {
    jest.clearAllMocks();
    new ConfigService(GetConfig());
  });

  it('registers jobs when cron is enabled', () => {
    new ConfigService({ ...GetConfig(), cronJobsEnabled: true } as typeof Config);

    const { service, scheduler } = buildService(configuredJobs);
    service.onModuleInit();

    expect(scheduler.addCronJob).toHaveBeenCalledTimes(2);
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  it('registers no job at all when cron is disabled, including jobs without a process', () => {
    // The safety property of the HTTP-only instance: were a job without `process` still
    // registered here, it would run on both the HTTP and the job instance simultaneously.
    // Cron locks are per-process, so duplicate execution would go unnoticed.
    new ConfigService({ ...GetConfig(), cronJobsEnabled: false } as typeof Config);

    const { service, scheduler } = buildService(configuredJobs);
    service.onModuleInit();

    expect(scheduler.addCronJob).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });
});
