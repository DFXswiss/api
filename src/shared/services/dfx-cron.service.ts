import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Config, CronRole } from 'src/config/config';
import { DisabledProcess } from 'src/shared/services/process.service';
import { CronScope, DFX_CRONJOB_PARAMS, DfxCronExpression, DfxCronParams } from 'src/shared/utils/cron';
import { LockClass } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CustomCronExpression } from '../utils/custom-cron-expression';
import { DfxLogger } from './dfx-logger';

interface CronJobData {
  instance: object;
  methodRef: any;
  methodName: string;
  params: DfxCronParams;
}

@Injectable()
export class DfxCronService implements OnModuleInit {
  private readonly logger = new DfxLogger(DfxCronService);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly schedulerRegisty: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const registered: CronScope[] = [];
    let skipped = 0;

    this.discovery
      .getProviders()
      .filter((wrapper) => wrapper.isDependencyTreeStatic())
      .filter(({ instance }) => instance && Object.getPrototypeOf(instance))
      .forEach(({ instance }) => {
        this.metadataScanner
          .getAllMethodNames(instance)
          .map((methodName) => {
            const methodRef = instance[methodName];

            return {
              instance,
              methodRef,
              methodName,
              params: Reflect.getMetadata(DFX_CRONJOB_PARAMS, methodRef),
            };
          })
          .filter((data) => data.params)
          .forEach((data) => {
            if (!this.runsInThisRole(data.params.scope)) {
              skipped++;
              return;
            }

            registered.push(data.params.scope);
            this.addCronJob(data);
          });
      });

    // The effective split is read from this line, not inferred from a table: a job registered
    // through a dynamically resolved provider or an abstract base class is counted here and
    // nowhere else. It stays on `info` so it is findable without changing the log level.
    const total = registered.length + skipped;
    const byScope = Object.values(CronScope)
      .map((scope) => `${scope}: ${registered.filter((s) => s === scope).length}`)
      .join(', ');

    this.logger.info(`CronRole ${Config.cronRole}: registered ${registered.length} of ${total} jobs (${byScope})`);
  }

  /**
   * `all` runs everything, which is the single-process mode. The other two roles each run their
   * own scope plus `both`, so a job maintaining process-local state that requests read is
   * registered in every process.
   */
  private runsInThisRole(scope: CronScope): boolean {
    switch (Config.cronRole) {
      case CronRole.All:
        return true;

      case CronRole.Api:
        return scope === CronScope.Api || scope === CronScope.Both;

      case CronRole.Worker:
        return scope === CronScope.Worker || scope === CronScope.Both;
    }
  }

  private addCronJob(data: CronJobData) {
    const lock = LockClass.create(data.params.timeout ?? Infinity);

    const context = { target: data.instance.constructor.name, method: data.methodName };
    const cronJob = new CronJob(data.params.expression, () => lock(this.wrapFunction(data), context));
    const cronJobName = `${context.target}::${context.method}`;

    this.schedulerRegisty.addCronJob(cronJobName, cronJob);
    cronJob.start();

    this.logger.verbose(`Registered ${cronJobName} (${data.params.scope})`);
  }

  private wrapFunction(data: CronJobData) {
    const context = { target: data.instance.constructor.name, method: data.methodName };

    return async (...args: any) => {
      if (data.params.process && DisabledProcess(data.params.process)) {
        this.logger.verbose(
          `Skipping ${context.target}::${context.method} - process ${data.params.process} is disabled`,
        );
        return;
      }

      if (data.params.useDelay ?? true) await this.cronJobDelay(data.params.expression);

      await data.methodRef.apply(data.instance, args);
    };
  }

  private async cronJobDelay(expression: DfxCronExpression): Promise<void> {
    const random = Math.random() * 1000;

    const delays = Config.cronJobDelay;

    switch (expression) {
      case CronExpression.EVERY_10_SECONDS:
        return Util.delay(random * (delays[0] ?? 5));

      case CustomCronExpression.EVERY_15_SECONDS:
        return Util.delay(random * (delays[1] ?? 5));

      case CronExpression.EVERY_30_SECONDS:
        return Util.delay(random * (delays[2] ?? 15));

      case CronExpression.EVERY_MINUTE:
        return Util.delay(random * (delays[3] ?? 30));

      case CronExpression.EVERY_5_MINUTES:
        return Util.delay(random * (delays[4] ?? 60));

      case CronExpression.EVERY_10_MINUTES:
        return Util.delay(random * (delays[5] ?? 60));

      case CustomCronExpression.EVERY_15_MINUTES:
        return Util.delay(random * (delays[6] ?? 60));

      case CronExpression.EVERY_HOUR:
        return Util.delay(random * (delays[7] ?? 120));
    }
  }
}
