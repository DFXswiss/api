import { CronScope, DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { SparkService } from '../spark.service';

jest.mock('@buildonspark/spark-sdk', () => ({
  SparkWallet: { initialize: jest.fn().mockResolvedValue({ wallet: { on: jest.fn() } }) },
}));

/**
 * Wallet maintenance moved out of a timer inside SparkClient and into a job here. What that buys
 * is not visible at the call site: a job registered through @DfxCron passes the scope filter and
 * the cross-process lease, and a timer does neither. These assertions are the only place that
 * says so.
 */
describe('SparkService', () => {
  const params = (): DfxCronParams =>
    Reflect.getMetadata(DFX_CRONJOB_PARAMS, SparkService.prototype.optimizeTokenOutputs);

  it('registers the wallet maintenance as a scheduled job', () => {
    // Without the decorator it is a plain method nobody calls, and the maintenance stops.
    expect(params()).toBeDefined();
  });

  it('scopes it to the worker, so it goes through the lease', () => {
    // `worker` is what puts it behind the cross-process lease — `both` is the one scope exempt
    // from it, and would put every process on the same wallet by design.
    expect(params().scope).toEqual(CronScope.WORKER);
  });
});
