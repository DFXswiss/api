import { PayoutOrderContext } from '../../entities/payout-order.entity';

export type PayoutGroup = { addressTo: string; amount: number }[];

export abstract class PayoutJellyfishService {
  abstract isHealthy(context: PayoutOrderContext): Promise<boolean>;
  abstract checkPayoutCompletion(context: PayoutOrderContext, payoutTxId: string): Promise<boolean>;
}
