import { CronExpression } from '@nestjs/schedule';
import { Process } from '../services/process.service';
import { CustomCronExpression } from './custom-cron-expression';

export interface DfxCronOptParams {
  process?: Process;
  useDelay?: boolean;
  timeout?: number;
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
