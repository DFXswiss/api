import { PocPayoutOrder } from '../../models/payout-order.entity';

export abstract class DoPayoutStrategy {
  abstract doPayout(order: PocPayoutOrder): Promise<void>;
}
