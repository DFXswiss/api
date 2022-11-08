import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PrepareStrategy } from './prepare.strategy';

export abstract class AutoConfirmStrategy extends PrepareStrategy {
  constructor(protected readonly payoutOrderRepo: PayoutOrderRepository) {
    super();
  }

  async preparePayout(order: PayoutOrder): Promise<void> {
    order.preparationConfirmed();
    order.recordPreparationFee(await this.feeAsset(), 0);

    await this.payoutOrderRepo.save(order);
  }

  /**
   * no payout preparation needed
   */
  async checkPreparationCompletion(): Promise<void> {
    return;
  }

  async estimateFee(): Promise<FeeResult> {
    return { asset: await this.feeAsset(), amount: 0 };
  }
}
