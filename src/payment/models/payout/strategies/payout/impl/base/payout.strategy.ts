import { FeeResult } from 'src/payment/models/payout/interfaces';
import { PayoutOrder } from '../../../../entities/payout-order.entity';

export interface PayoutStrategy {
  doPayout(orders: PayoutOrder[]): Promise<void>;
  checkPayoutCompletion(order: PayoutOrder): Promise<void>;
  estimateFee(quantityOfTransactions: number): Promise<FeeResult>;
}
