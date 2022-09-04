import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutBSCService } from '../../services/payout-bsc.service';
import { PayoutStrategy } from './base/payout.strategy';

@Injectable()
export class PayoutBSCStrategy extends PayoutStrategy {
  constructor(private readonly bscService: PayoutBSCService, private readonly payoutOrderRepo: PayoutOrderRepository) {
    super();
  }

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      const txId = await this.bscService.send(order.destinationAddress, order.amount);
      order.pendingPayout(txId);

      await this.payoutOrderRepo.save(order);
    }
  }

  async checkPayoutCompletion(order: PayoutOrder): Promise<void> {
    try {
      const isComplete = this.bscService.checkPayoutCompletion(order.payoutTxId);

      if (isComplete) {
        order.complete();

        await this.payoutOrderRepo.save(order);
      }
    } catch (e) {
      console.error(`Error in checking payout order completion. Order ID: ${order.id}`, e);
    }
  }
}
