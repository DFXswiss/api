import { PayoutOrder } from '../../entities/payout-order.entity';

export abstract class PayoutStrategy {
  abstract doPayout(orders: PayoutOrder[]): Promise<void>;

  abstract checkPayoutCompletion(order: PayoutOrder): Promise<void>;
}
