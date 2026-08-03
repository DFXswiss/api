import { DFX_CRONJOB_PARAMS, CronScope, DfxCronParams } from 'src/shared/utils/cron';
import { PaymentCronService } from '../payment-cron.service';

/**
 * The scopes of these three jobs are the whole point of the split between writing and delivering,
 * and nothing at runtime notices when one of them changes: a writing job scoped `both` would
 * duplicate its webhooks, and the delivery job scoped `worker` or `api` would take the lease and
 * leave the callers of every other process unreleased. Both are silent.
 */
describe('PaymentCronService', () => {
  function scopeOf(method: keyof PaymentCronService): CronScope {
    const params: DfxCronParams = Reflect.getMetadata(DFX_CRONJOB_PARAMS, PaymentCronService.prototype[method]);

    return params?.scope;
  }

  it.each(['processExpiredPayments', 'checkTxConfirmations', 'forwardDeposits'] as const)(
    'runs %s in one process, because it writes and calls out',
    (method) => {
      expect(scopeOf(method)).toEqual(CronScope.WORKER);
    },
  );

  it('runs the delivery in every process, because each holds its own callers and devices', () => {
    expect(scopeOf('deliverPaymentUpdates')).toEqual(CronScope.BOTH);
  });
});
