import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Config } from 'src/config/config';
import { DisabledProcess } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronExpression, DfxCronParams } from 'src/shared/utils/cron';
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
          .forEach((data) => this.addCronJob(data));
      });
  }

  private addCronJob(data: CronJobData) {
    const lock = LockClass.create(data.params.timeout ?? Infinity);

    const context = { target: data.instance.constructor.name, method: data.methodName };
    const cronJob = new CronJob(data.params.expression, () => lock(this.wrapFunction(data), context));
    const cronJobName = `${context.target}::${context.method}`;

    this.schedulerRegisty.addCronJob(cronJobName, cronJob);
    cronJob.start();
  }

  private wrapFunction(data: CronJobData) {
    return async (...args: any) => {
      if (data.params.process && DisabledProcess(data.params.process)) return;

      if (data.params.useDelay ?? true) await this.cronJobDelay(data.params.expression);

      const starttime = Date.now();

      await data.methodRef.apply(data.instance, args);

      const runtime = Date.now() - starttime;

      if (runtime > 500) {
        const cronJobName = `${data.instance.constructor.name}::${data.methodName}`;
        this.logger.info(`Cron Job: ${cronJobName} / Runtime: ${runtime}`);
      }
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
