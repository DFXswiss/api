import { PayoutOrder } from '../../entities/payout-order.entity';

export abstract class PrepareStrategy {
  abstract preparePayout(order: PayoutOrder): Promise<void>;

  abstract checkPreparationCompletion(order: PayoutOrder): Promise<void>;
}
