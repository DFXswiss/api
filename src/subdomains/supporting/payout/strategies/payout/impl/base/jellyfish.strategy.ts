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
      const groups = Util.groupBy<PayoutOrder, PayoutOrderContext>(orders, 'context');

      for (const [context, group] of groups.entries()) {
        if (!(await this.jellyfishService.isHealthy(context))) continue;

        await this.doPayoutForContext(context, group);
      }
    } catch (e) {
      console.error('Error while executing DeFiChain payout orders', e);
    }
  }

  async checkPayoutCompletionData(orders: PayoutOrder[]): Promise<void> {
    try {
      const groups = Util.groupBy<PayoutOrder, PayoutOrderContext>(orders, 'context');

      for (const [context, group] of groups.entries()) {
        if (!(await this.jellyfishService.isHealthy(context))) continue;

        await this.checkPayoutCompletionDataForContext(context, group);
      }
    } catch (e) {
      console.error('Error while checking payout completion of DeFiChain payout orders', e);
    }
  }

  protected abstract doPayoutForContext(context: PayoutOrderContext, group: PayoutOrder[]): Promise<void>;

  async checkPayoutCompletionDataForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const groups = Util.groupBy<PayoutOrder, string>(orders, 'payoutTxId');

    for (const [payoutTxId, group] of groups.entries()) {
      try {
        await this.checkPayoutCompletionDataForTx(context, group, payoutTxId);
      } catch (e) {
        console.error(
          `Error while checking payout completion data of payout orders for context ${context} and payoutTxId ${payoutTxId}`,
          group.map((o) => o.id),
          e,
        );
        continue;
      }
    }
  }

  private async checkPayoutCompletionDataForTx(
    context: PayoutOrderContext,
    orders: PayoutOrder[],
    payoutTxId: string,
  ): Promise<void> {
    const [isComplete, totalPayoutFee] = await this.jellyfishService.getPayoutCompletionData(context, payoutTxId);
    const totalPayoutAmount = Util.sumObj<PayoutOrder>(orders, 'amount');

    if (isComplete) {
      for (const order of orders) {
        const orderPayoutFee = this.calculateOrderPayoutFee(order, totalPayoutFee, totalPayoutAmount);

        order.complete();
        order.recordPayoutFee(await this.feeAsset(), orderPayoutFee);

        await this.payoutOrderRepo.save(order);
      }
    }
  }

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

      return;
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

  private calculateOrderPayoutFee(order: PayoutOrder, totalPayoutFee: number, totalPayoutAmount: number): number {
    return Util.round((totalPayoutFee / totalPayoutAmount) * order.amount, 8);
  }
}
