import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PrepareStrategy } from './base/prepare.strategy';

@Injectable()
export class PrepareOnEthereumStrategy extends PrepareStrategy {
  constructor(private readonly payoutOrderRepo: PayoutOrderRepository) {
    super();
  }

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
