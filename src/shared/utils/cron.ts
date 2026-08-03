import { CronExpression } from '@nestjs/schedule';
import { Process } from '../services/process.service';
import { CustomCronExpression } from './custom-cron-expression';

export interface DfxCronOptParams {
  process?: Process;
  useDelay?: boolean;
  timeout?: number;
  /**
   * Marks a job as per-instance housekeeping that must run in every process, even where the
   * scheduler is otherwise switched off (CRON_JOBS_ENABLED=false).
   *
   * Use it only for work whose effect is confined to the current process: refreshing an
   * in-memory copy of global state, or expiring a local cache. Running it twice must be
   * harmless by construction, because it will run on every instance.
   *
   * Anything that writes to the database or drives business forward is NOT per-instance — such
   * a job would then execute once per instance, and cron locks are per-process and cannot
   * prevent that.
   */
  perInstance?: boolean;
}

export type DfxCronExpression = CronExpression | CustomCronExpression;

export interface DfxCronParams extends DfxCronOptParams {
  expression: DfxCronExpression;
}

export const DFX_CRONJOB_PARAMS = 'DFXCronjobParams';

export function DfxCron(expression: DfxCronExpression, optional?: DfxCronOptParams) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const methodRef = target[propertyKey];

    const params: DfxCronParams = { expression, ...optional };

    Reflect.defineMetadata(DFX_CRONJOB_PARAMS, params, methodRef);

    return descriptor;
  };
}
