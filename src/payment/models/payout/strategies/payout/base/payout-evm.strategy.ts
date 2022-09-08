import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutEVMService } from '../../../services/payout-evm.service';
import { PayoutStrategy } from './payout.strategy';

export abstract class PayoutEVMStrategy implements PayoutStrategy {
  constructor(
    protected readonly payoutEVMService: PayoutEVMService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {}

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const txId = await this.payoutEVMService.send(order.destinationAddress, order.amount);
        order.pendingPayout(txId);

        await this.payoutOrderRepo.save(order);
      } catch (e) {
        console.error(`Error while executing EVM payout order. Order ID: ${order.id}`, e);
      }
    }
  }

  async checkPayoutCompletion(order: PayoutOrder): Promise<void> {
    try {
      const isComplete = this.payoutEVMService.checkPayoutCompletion(order.payoutTxId);

      if (isComplete) {
        order.complete();

        await this.payoutOrderRepo.save(order);
      }
    } catch (e) {
      console.error(`Error in checking EVM payout order completion. Order ID: ${order.id}`, e);
    }
  }
}
