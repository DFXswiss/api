import {
  PayoutGroup,
  PayoutJellyfishService,
} from 'src/subdomains/supporting/payout/services/base/payout-jellyfish.service';
import { Util } from 'src/shared/utils/util';
import { PayoutOrder, PayoutOrderContext } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PayoutStrategy } from './payout.strategy';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';

export abstract class JellyfishStrategy extends PayoutStrategy {
  constructor(
    protected readonly notificationService: NotificationService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly jellyfishService: PayoutJellyfishService,
  ) {
    super();
  }

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    try {
      const groups = this.groupOrdersByContext(orders);

      for (const [context, group] of [...groups.entries()]) {
        if (!(await this.jellyfishService.isHealthy(context))) return;

        await this.doPayoutForContext(context, group);
      }
    } catch (e) {
      console.error('Error while executing DeFiChain payout orders', e);
    }
  }

  async checkPayoutCompletionData(order: PayoutOrder): Promise<void> {
    try {
      const [isComplete, totalPayoutFee] = await this.jellyfishService.getPayoutCompletionData(
        order.context,
        order.payoutTxId,
      );

      if (isComplete) {
        const orderPayoutFee = await this.calculateOrderPayoutFee(order, totalPayoutFee);

        order.complete();
        order.recordPayoutFee(await this.feeAsset(), orderPayoutFee);

        await this.payoutOrderRepo.save(order);
      }
    } catch (e) {
      console.error(`Error in checking DeFiChain payout order completion. Order ID: ${order.id}`, e);
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

  protected abstract dispatchPayout(
    context: PayoutOrderContext,
    payout: PayoutGroup,
    outputAssetName: string,
  ): Promise<string>;

  protected async send(context: PayoutOrderContext, orders: PayoutOrder[], outputAssetName: string): Promise<void> {
    let payoutTxId: string;

    try {
      const payout = this.aggregatePayout(orders);

      await this.designatePayout(orders);
      payoutTxId = await this.dispatchPayout(context, payout, outputAssetName);
    } catch (e) {
      console.error(`Error on sending ${outputAssetName} for payout. Order ID(s): ${orders.map((o) => o.id)}`, e);

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
        await this.sendNonRecoverableErrorMail(order, errorMessage, e);
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

  protected async sendNonRecoverableErrorMail(order: PayoutOrder, message: string, e?: Error): Promise<void> {
    const correlationId = `PayoutOrder&${order.context}&${order.id}`;
    const errors = e ? [message, e.message] : [message];

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      input: { subject: 'Payout Error', errors },
      options: { suppressRecurring: true },
      metadata: { context: MailContext.PAYOUT, correlationId },
    });
  }

  //*** HELPER METHODS ***//

  private validateIfOrdersOfSameAsset(orders: PayoutOrder[]): boolean {
    return orders.every((order, i) => (orders[i + 1] ? order.asset.dexName === orders[i + 1].asset.dexName : true));
  }

  private async calculateOrderPayoutFee(order: PayoutOrder, totalPayoutFee: number): Promise<number> {
    const ordersWithSamePayoutTxId = await this.payoutOrderRepo.find({ payoutTxId: order.payoutTxId });

    const totalOrdersAmount = Util.sumObj<PayoutOrder>(ordersWithSamePayoutTxId, 'amount');

    return Util.round((totalPayoutFee / totalOrdersAmount) * order.amount, 8);
  }
}
