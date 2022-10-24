import { FeeResult } from 'src/payment/models/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutOrder } from '../../../../entities/payout-order.entity';

export abstract class PayoutStrategy {
  abstract doPayout(orders: PayoutOrder[]): Promise<void>;
  abstract checkPayoutCompletion(order: PayoutOrder): Promise<void>;
  abstract estimateFee(quantityOfTransactions: number, asset: Asset): Promise<FeeResult>;
}
