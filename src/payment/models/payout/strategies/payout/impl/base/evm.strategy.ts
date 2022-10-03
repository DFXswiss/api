import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PayoutEvmService } from '../../../../services/payout-evm.service';
import { PayoutStrategy } from './payout.strategy';

export abstract class EvmStrategy implements PayoutStrategy {
  constructor(
    protected readonly payoutEvmService: PayoutEvmService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {}

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const txId = await this.payoutEvmService.send(order.destinationAddress, order.amount);
        order.pendingPayout(txId);

        await this.payoutOrderRepo.save(order);
      } catch (e) {
        console.error(`Error while executing EVM payout order. Order ID: ${order.id}`, e);
      }
    }
  }

  async checkPayoutCompletion(order: PayoutOrder): Promise<void> {
    try {
      const isComplete = this.payoutEvmService.checkPayoutCompletion(order.payoutTxId);

      if (isComplete) {
        order.complete();

        await this.payoutOrderRepo.save(order);
      }
    } catch (e) {
      console.error(`Error in checking EVM payout order completion. Order ID: ${order.id}`, e);
    }
  }
}
