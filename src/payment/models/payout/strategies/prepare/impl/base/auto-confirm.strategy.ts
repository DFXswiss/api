import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PrepareStrategy } from './prepare.strategy';

export abstract class AutoConfirmStrategy implements PrepareStrategy {
  constructor(protected readonly payoutOrderRepo: PayoutOrderRepository) {}

  async preparePayout(order: PayoutOrder): Promise<void> {
    order.preparationConfirmed();

    await this.payoutOrderRepo.save(order);
  }

  /**
   * no payout preparation needed for ethereum
   */
  async checkPreparationCompletion(): Promise<void> {
    return;
  }
}
