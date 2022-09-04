import { PayoutOrder } from '../../../entities/payout-order.entity';

export interface PayoutStrategy {
  doPayout(orders: PayoutOrder[]): Promise<void>;
  checkPayoutCompletion(order: PayoutOrder): Promise<void>;
}
