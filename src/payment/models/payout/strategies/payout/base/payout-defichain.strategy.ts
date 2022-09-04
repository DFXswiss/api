import { MailService } from 'src/shared/services/mail.service';
import { Util } from 'src/shared/util';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { PayoutStrategy } from './payout.strategy';

export abstract class PayoutDeFiChainStrategy implements PayoutStrategy {
  constructor(
    protected readonly mailService: MailService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly defichainService: PayoutDeFiChainService,
  ) {}

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    try {
      const groups = this.groupOrdersByContext(orders);

      for (const [context, group] of [...groups.entries()]) {
        if (!(await this.defichainService.isHealthy(context))) return;

        await this.doPayoutForContext(context, group);
      }
    } catch (e) {
      console.error('Error while executing payout orders', e);
    }
  }

  async checkPayoutCompletion(order: PayoutOrder): Promise<void> {
    try {
      const isComplete = await this.defichainService.checkPayoutCompletion(order.context, order.payoutTxId);

      if (isComplete) {
        order.complete();

        await this.payoutOrderRepo.save(order);
      }
    } catch (e) {
      console.error(`Error in checking payout order completion. Order ID: ${order.id}`, e);
    }
  }

  protected groupOrdersByContext(orders: PayoutOrder[]): Map<PayoutOrderContext, PayoutOrder[]> {
    const groups = new Map<PayoutOrderContext, PayoutOrder[]>();

    orders.forEach((order) => {
      const existingGroup = groups.get(order.context);

      if (existingGroup) {
        existingGroup.push(order);
      } else {
        groups.set(order.context, [order]);
      }
    });

    return groups;
  }

  protected abstract doPayoutForContext(context: PayoutOrderContext, group: PayoutOrder[]): Promise<void>;

  protected createPayoutGroups(orders: PayoutOrder[], maxGroupSize: number): PayoutOrder[][] {
    const result: Map<number, PayoutOrder[]> = new Map();

    orders.forEach((o) => {
      // find nearest non-full group without repeating address
      const suitableExistingGroups = [...result.entries()].filter(
        ([_, _orders]) =>
          _orders.length < maxGroupSize && !_orders.find((_o) => _o.destinationAddress === o.destinationAddress),
      );

      const [key, group] = suitableExistingGroups[0] ?? [result.size, []];
      result.set(key, [...group, o]);
    });

    return [...result.values()];
  }

  protected aggregatePayout(orders: PayoutOrder[]): { addressTo: string; amount: number }[] {
    // sum up duplicated addresses, fallback in case orders to same address and asset end up in one payment round
    const uniqueAddresses = new Map<string, number>();

    orders.forEach((o) => {
      const existingAmount = uniqueAddresses.get(o.destinationAddress);
      const increment = existingAmount ? Util.round(existingAmount + o.amount, 8) : o.amount;

      uniqueAddresses.set(o.destinationAddress, increment);
    });

    return [...uniqueAddresses.entries()].map(([addressTo, amount]) => ({ addressTo, amount }));
  }

  protected async designatePayout(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      order.designatePayout();
      await this.payoutOrderRepo.save(order);
    }
  }

  protected async rollbackPayoutDesignation(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      order.rollbackPayoutDesignation();
      await this.payoutOrderRepo.save(order);
    }
  }

  protected async sendNonRecoverableErrorMail(message: string, e?: Error): Promise<void> {
    const body = e ? [message, e.message] : [message];

    await this.mailService.sendErrorMail('Payout Error', body);
  }
}
