import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DisabledProcess } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronExpression, DfxCronParams } from 'src/shared/utils/cron';
import { LockClass } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CustomCronExpression } from '../utils/custom-cron-expression';

interface CronJobData {
  instance: object;
  methodRef: any;
  methodName: string;
  params: DfxCronParams;
}

@Injectable()
export class DfxCronService implements OnModuleInit {
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

    const cronJob = new CronJob(data.params.expression, () => lock(this.wrapFunction(data)));
    const cronJobName = `${data.instance.constructor.name}::${data.methodName}`;

    this.schedulerRegisty.addCronJob(cronJobName, cronJob);
    cronJob.start();
  }

  private wrapFunction(data: CronJobData) {
    return async (...args: any) => {
      if (data.params.process && DisabledProcess(data.params.process)) return;

      if (data.params.useDelay ?? true) await this.cronJobDelay(data.params.expression as CronExpression);

      await data.methodRef.apply(data.instance, args);
    };
  }

  private async cronJobDelay(expression: DfxCronExpression): Promise<void> {
    const random = Math.random() * 1000;

    switch (expression) {
      case CronExpression.EVERY_10_SECONDS:
        return Util.delay(random * 5); // 0 .. 5 sec

      case CustomCronExpression.EVERY_15_SECONDS:
        return Util.delay(random * 5); // 0 .. 5 sec

      case CronExpression.EVERY_30_SECONDS:
        return Util.delay(random * 10); // 0 .. 10 sec

      case CronExpression.EVERY_MINUTE:
        return Util.delay(random * 10); // 0 .. 10 sec

      case CronExpression.EVERY_5_MINUTES:
        return Util.delay(random * 30); // 0 .. 30 sec

      case CronExpression.EVERY_10_MINUTES:
        return Util.delay(random * 30); // 0 .. 30 sec

      case CustomCronExpression.EVERY_15_MINUTES:
        return Util.delay(random * 30); // 0 .. 30 sec

      case CronExpression.EVERY_HOUR:
        return Util.delay(random * 60); // 0 .. 60 sec
    }
  }
}
