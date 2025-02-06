import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { LockClass } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';

interface CronJobData {
  instance: object;
  methodRef: any;
  methodName: string;
  params: DfxCronParams;
}

@Injectable()
export class DfxCronService implements OnModuleInit {
  private readonly logger: DfxLogger = new DfxLogger(DfxCronService);

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

    const cronJob = new CronJob(data.params.expression, () => lock(this.wrapFunctionInTryCatchBlocks(data)));
    const cronJobName = `${data.instance.constructor.name}::${data.methodName}`;

    this.schedulerRegisty.addCronJob(cronJobName, cronJob);
    cronJob.start();

    this.logger.info(`CronJob ${cronJobName} started`);
  }

  private wrapFunctionInTryCatchBlocks(data: CronJobData) {
    return async (...args: any) => {
      if (data.params.process && DisabledProcess(data.params.process)) return;

      if (data.params.useDelay ?? true) await Util.cronJobDelay(data.params.expression as CronExpression);

      await data.methodRef.apply(data.instance, args);
    };
  }
}
