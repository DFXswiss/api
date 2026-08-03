import { CronExpression } from '@nestjs/schedule';
import { Process } from '../services/process.service';
import { CustomCronExpression } from './custom-cron-expression';

/**
 * Which process a job belongs to.
 *
 * The distinction is not about importance but about where a job's effect is visible. Most jobs
 * only touch the database or an external system, so any process can run them and exactly one
 * should. The exceptions are jobs maintaining state that lives inside the process itself - a
 * class field, a module-global variable, a Node process metric - because such state is only
 * useful in the process whose requests read it.
 */
export enum CronScope {
  /** Worker process only. The normal case: anything writing to the database or driving business forward. */
  WORKER = 'worker',
  /**
   * API process only. Maintains or measures state read exclusively from a request path, or
   * drives work bound to the connections that process holds open.
   */
  API = 'api',
  /**
   * Every process. Maintains or measures process-local state that both sides read.
   *
   * Running such a job twice must be harmless by construction: refreshing an in-memory copy of
   * global state, expiring a local cache or writing a log line qualifies. Writing to the
   * database or driving business forward does not - cron locks are per-process and cannot
   * prevent duplicate execution across processes.
   */
  BOTH = 'both',
}

export interface DfxCronOptParams {
  process?: Process;
  useDelay?: boolean;
  timeout?: number;
}

/**
 * Parameters of a cron job. `scope` is mandatory and has no default.
 *
 * A wrong classification fails silently - a job wrongly scoped `worker` leaves the cache it
 * maintains empty in the process that reads it, with no error anywhere. Requiring the field puts
 * that decision in front of whoever adds a job, and the compiler enforces it. A default plus a
 * list of exceptions would move the same decision into a list the compiler does not see, where a
 * test can only pin the entries it already has.
 */
export interface DfxCronRequiredParams extends DfxCronOptParams {
  scope: CronScope;
}

export type DfxCronExpression = CronExpression | CustomCronExpression;

export interface DfxCronParams extends DfxCronRequiredParams {
  expression: DfxCronExpression;
}

export const DFX_CRONJOB_PARAMS = 'DFXCronjobParams';

export function DfxCron(expression: DfxCronExpression, required: DfxCronRequiredParams): MethodDecorator {
  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const methodRef = target[propertyKey];

    const params: DfxCronParams = { expression, ...required };

    Reflect.defineMetadata(DFX_CRONJOB_PARAMS, params, methodRef);

    return descriptor;
  };
}
