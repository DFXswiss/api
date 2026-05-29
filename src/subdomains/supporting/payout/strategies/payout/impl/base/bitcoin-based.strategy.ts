import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import {
  PayoutBitcoinBasedService,
  PayoutGroup,
} from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder, PayoutOrderContext } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PayoutStrategy } from './payout.strategy';

// Operator-alert threshold for recurring payout RPC failures. With the ~30s payout
// cron interval, 5 attempts maps to ~2.5 min of silent retry-loop before the first
// notification fires. `suppressRecurring` then debounces follow-ups so the operator
// inbox stays clean.
const RECURRING_PAYOUT_FAILURE_THRESHOLD = 5;

export abstract class BitcoinBasedStrategy extends PayoutStrategy {
  protected abstract readonly logger: DfxLogger;

  constructor(
    protected readonly notificationService: NotificationService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly bitcoinBasedService: PayoutBitcoinBasedService,
  ) {
    super();
  }

  abstract estimateFee(asset: Asset): Promise<FeeResult>;

  async estimateBlockchainFee(asset: Asset): Promise<FeeResult> {
    return this.estimateFee(asset);
  }

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    try {
      const groups = Util.groupBy<PayoutOrder, PayoutOrderContext>(orders, 'context');

      for (const [context, group] of groups.entries()) {
        if (!(await this.bitcoinBasedService.isHealthy(context))) continue;

        await this.doPayoutForContext(context, group);
      }
    } catch (e) {
      this.logger.error('Error while executing Bitcoin payout orders:', e);
    }
  }

  async checkPayoutCompletionData(orders: PayoutOrder[]): Promise<void> {
    try {
      const groups = Util.groupBy<PayoutOrder, PayoutOrderContext>(orders, 'context');

      for (const [context, group] of groups.entries()) {
        if (!(await this.bitcoinBasedService.isHealthy(context))) continue;

        await this.checkPayoutCompletionDataForContext(context, group);
      }
    } catch (e) {
      this.logger.error('Error while checking payout completion of Bitcoin payout orders:', e);
    }
  }

  protected abstract doPayoutForContext(context: PayoutOrderContext, group: PayoutOrder[]): Promise<void>;

  async checkPayoutCompletionDataForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const groups = Util.groupBy<PayoutOrder, string>(orders, 'payoutTxId');

    for (const [payoutTxId, group] of groups.entries()) {
      try {
        await this.checkPayoutCompletionDataForTx(context, group, payoutTxId);
      } catch (e) {
        this.logger.error(
          `Error while checking payout completion data of payout orders ${group.map(
            (o) => o.id,
          )} for context ${context} and payoutTxId ${payoutTxId}:`,
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
    const [isComplete, totalPayoutFee] = await this.bitcoinBasedService.getPayoutCompletionData(context, payoutTxId);
    const totalPayoutAmount = Util.sumObjValue<PayoutOrder>(orders, 'amount');

    if (isComplete) {
      for (const order of orders) {
        const orderPayoutFee = this.calculateOrderPayoutFee(order, totalPayoutFee, totalPayoutAmount);

        order.complete();

        const feeAsset = await this.feeAsset();
        const price = await this.pricingService.getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
        order.recordPayoutFee(feeAsset, orderPayoutFee, price.convert(orderPayoutFee, Config.defaultVolumeDecimal));

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
      // find nearest non-full group (based on unique addresses)
      const suitableExistingGroups = [...result.entries()].filter(([_, _orders]) => {
        const uniqueAddresses = new Set(_orders.map((_o) => _o.destinationAddress));

        return uniqueAddresses.has(o.destinationAddress) || uniqueAddresses.size < maxGroupSize;
      });

      const [key, group] = suitableExistingGroups[0] ?? [result.size, []];
      result.set(key, [...group, o]);
    });

    return [...result.values()];
  }

  protected abstract dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup, token?: Asset): Promise<string>;

  protected async send(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    let payoutTxId: string;

    if (orders.some((o) => o.payoutTxId) && !DisabledProcess(Process.TX_SPEEDUP))
      throw new Error(`Transaction speedup is not implemented for ${this.blockchain}`);

    try {
      const payout = this.aggregatePayout(orders);

      await this.designatePayout(orders);
      payoutTxId = await this.dispatchPayout(context, payout, orders[0].asset);
    } catch (e) {
      this.logger.error(
        `Error on sending ${orders[0].asset.name} for payout. Order ID(s): ${orders.map((o) => o.id)}:`,
        e,
      );

      await this.trackPayoutFailure(orders, e);

      if (e.message.includes('timeout')) throw e;

      await this.rollbackPayoutDesignation(orders);

      return;
    }

    for (const order of orders) {
      try {
        order.resetPayoutRetry();
        const paidOrder = order.pendingPayout(payoutTxId);
        await this.payoutOrderRepo.save(paidOrder);
      } catch (e) {
        const errorMessage = `Error on saving payout payoutTxId to the database. Order ID: ${order.id}. Payout ID: ${payoutTxId}`;

        this.logger.error(errorMessage, e);
        await this.sendNonRecoverableErrorMail(order, errorMessage, e);
      }
    }
  }

  protected aggregatePayout(orders: PayoutOrder[]): PayoutGroup {
    // sum up duplicated addresses, fallback in case orders to same address and asset end up in one payment round
    const payouts = Util.aggregate<PayoutOrder>(orders, 'destinationAddress', 'amount');
    const roundedPayouts = Object.entries(payouts)
      .map(([addressTo, amount]) => ({ addressTo, amount: Util.round(amount, 8) }))
      .filter(({ amount }) => amount !== 0);

    return this.fixRoundingMismatch(orders, roundedPayouts);
  }

  private fixRoundingMismatch(orders: PayoutOrder[], roundedPayouts: PayoutGroup): PayoutGroup {
    const payoutTotal = Util.round(Util.sumObjValue(orders, 'amount'), 8);

    return Util.fixRoundingMismatch(roundedPayouts, 'amount', payoutTotal);
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
      context: MailContext.PAYOUT,
      input: { subject: 'Payout Error', errors, isLiqMail: true },
      options: { suppressRecurring: true },
      correlationId,
    });
  }

  // Persistent retry tracking + threshold-based operator alert. Without this, an
  // RPC error like "Invalid amount" silently loops every 30 s with no escalation
  // (real incident 2026-05-29: 43 min stalled BTC payout, see PR #3729 context).
  // Uses Math.max so a single stuck order escalates even when the group later
  // gains fresh orders — the underlying RPC error fails the whole sendmany call,
  // so any order over threshold is a signal worth surfacing.
  protected async trackPayoutFailure(orders: PayoutOrder[], error: Error): Promise<void> {
    if (!orders.length) return;

    const message = error?.message ?? 'Unknown payout error';
    for (const order of orders) {
      order.recordPayoutFailure(message);
      await this.payoutOrderRepo.save(order);
    }

    const maxRetryCount = Math.max(...orders.map((o) => o.retryCount));
    if (maxRetryCount >= RECURRING_PAYOUT_FAILURE_THRESHOLD) {
      await this.sendRecurringPayoutFailureAlert(orders, message);
    }
  }

  protected async sendRecurringPayoutFailureAlert(orders: PayoutOrder[], lastError: string): Promise<void> {
    // Sort ids so the correlationId is stable across retries regardless of how
    // Postgres returns the rows (findBy has no ORDER BY) — otherwise the 1h
    // debounce on Notification keys on a moving correlationId and never matches.
    const stableIds = orders.map((o) => o.id).sort((a, b) => a - b);
    const maxRetry = Math.max(...orders.map((o) => o.retryCount));

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.PAYOUT,
      input: {
        subject: `Recurring ${orders[0].asset.name} payout failure: order(s) ${stableIds.join(', ')}`,
        errors: [`Retry count: ${maxRetry}`, `Last error: ${lastError}`],
        isLiqMail: true,
      },
      // debounce only (no suppressRecurring): Notification.isSuppressed evaluates
      // `suppressRecurring || isDebounced` and short-circuits — combining both
      // would silence every retry forever. With debounce alone the operator gets
      // one alert per hour per group while the incident continues.
      options: { debounce: 3600000 },
      correlationId: `PayoutOrderRecurringFailure&${orders[0].context}&${stableIds.join('-')}`,
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
