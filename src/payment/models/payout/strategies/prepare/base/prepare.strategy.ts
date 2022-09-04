import { PayoutOrder } from '../../../entities/payout-order.entity';

export interface PrepareStrategy {
  preparePayout(order: PayoutOrder): Promise<void>;
  checkPreparationCompletion(order: PayoutOrder): Promise<void>;
}
