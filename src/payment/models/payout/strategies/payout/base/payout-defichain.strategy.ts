import { MailService } from 'src/shared/services/mail.service';
import { Util } from 'src/shared/util';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutDeFiChainService, PayoutGroup } from '../../../services/payout-defichain.service';
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
    const isSameAsset = this.validateIfOrdersOfSameAsset(orders);

    if (!isSameAsset) throw new Error('Cannot group orders of different assets to same payout group');
    if (maxGroupSize === 0) throw new Error('Max group size for payout cannot be 0');

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

  protected async send(
    context: PayoutOrderContext,
    orders: PayoutOrder[],
    outputAsset: string,
    dispatcher: (context: PayoutOrderContext, payout: PayoutGroup, outputAsset: string) => Promise<string>,
  ): Promise<void> {
    let payoutTxId: string;

    try {
      const payout = this.aggregatePayout(orders);

      await this.designatePayout(orders);
      payoutTxId = await dispatcher(context, payout, outputAsset);
    } catch (e) {
      console.error(`Error on sending ${outputAsset} for payout. Order ID(s): ${orders.map((o) => o.id)}`, e);

      if (e.message.includes('timeout')) throw e;

      await this.rollbackPayoutDesignation(orders);
    }

    for (const order of orders) {
      try {
        const paidOrder = order.pendingPayout(payoutTxId);
        await this.payoutOrderRepo.save(paidOrder);
      } catch (e) {
        const errorMessage = `Error on saving payout payoutTxId to the database. Order ID: ${order.id}. Payout ID: ${payoutTxId}`;

        console.error(errorMessage, e);
        await this.sendNonRecoverableErrorMail(errorMessage, e);
      }
    }
  }

  protected aggregatePayout(orders: PayoutOrder[]): PayoutGroup {
    // sum up duplicated addresses, fallback in case orders to same address and asset end up in one payment round
    const payouts = Util.aggregate<PayoutOrder>(orders, 'destinationAddress', 'amount');

    return Object.entries(payouts).map(([addressTo, amount]) => ({ addressTo, amount: Util.round(amount, 8) }));
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

  //*** HELPER METHODS ***//

  private validateIfOrdersOfSameAsset(orders: PayoutOrder[]): boolean {
    return orders.every((order, i) => (orders[i + 1] ? order.asset.dexName === orders[i + 1].asset.dexName : true));
  }
}
