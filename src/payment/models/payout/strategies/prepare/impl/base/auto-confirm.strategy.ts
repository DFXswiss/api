import { FeeResult } from 'src/payment/models/payout/interfaces';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PrepareStrategy } from './prepare.strategy';

export abstract class AutoConfirmStrategy extends PrepareStrategy {
  constructor(protected readonly payoutOrderRepo: PayoutOrderRepository) {
    super();
  }

  async preparePayout(order: PayoutOrder): Promise<void> {
    order.preparationConfirmed();

    await this.payoutOrderRepo.save(order);
  }

  /**
   * no payout preparation needed
   */
  async checkPreparationCompletion(): Promise<void> {
    return;
  }

  async estimateFee(): Promise<FeeResult> {
    this.feeAsset = this.feeAsset ?? (await this.getFeeAsset());

    return { asset: this.feeAsset, amount: 0 };
  }
}
