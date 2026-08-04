import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FindOptionsRelations, In, IsNull, LessThan, MoreThan, Not } from 'typeorm';
import { MailRequest } from '../../notification/interfaces';
import { RetryPayoutDto } from '../dto/retry-payout.dto';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../entities/payout-order.entity';
import { PayoutOrderFactory } from '../factories/payout-order.factory';
import { FeeResult, PayoutRequest } from '../interfaces';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { PayoutStrategyRegistry } from '../strategies/payout/impl/base/payout.strategy-registry';
import { PrepareStrategyRegistry } from '../strategies/prepare/impl/base/prepare.strategy-registry';
import { PayoutLogService } from './payout-log.service';

@Injectable()
export class PayoutService {
  private readonly logger = new DfxLogger(PayoutService);

  constructor(
    private readonly logs: PayoutLogService,
    private readonly notificationService: NotificationService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
    private readonly payoutOrderFactory: PayoutOrderFactory,
    private readonly payoutStrategyRegistry: PayoutStrategyRegistry,
    private readonly prepareStrategyRegistry: PrepareStrategyRegistry,
  ) {}

  //*** PUBLIC API ***//

  async getPayoutOrders(from: Date, relations?: FindOptionsRelations<PayoutOrder>): Promise<PayoutOrder[]> {
    return this.payoutOrderRepo.find({ where: { created: MoreThan(from) }, relations });
  }

  async doPayout(request: PayoutRequest): Promise<void> {
    try {
      if (DisabledProcess(Process.CRYPTO_PAYOUT)) throw new BadRequestException('Process disabled');

      if (request.amount < 0) throw new Error('Amount is lower 0');

      const order = this.payoutOrderFactory.createOrder(request);

      await this.payoutOrderRepo.save(order);
    } catch (e) {
      this.logger.error('Error during payout creation:', e);

      throw new Error(
        `Error while trying to create PayoutOrder for context ${request.context} and correlationId: ${request.correlationId}`,
      );
    }
  }

  async checkOrderCompletion(
    context: PayoutOrderContext,
    correlationId: string,
  ): Promise<{
    isComplete: boolean;
    payoutTxId: string;
    payoutFee: FeeResult;
    payoutAmount: number;
    payoutAsset: Asset;
    payoutAmountBaseUnits: string | null;
  }> {
    const order = await this.payoutOrderRepo.findOneBy({ context, correlationId });
    const payoutTxId = order && order.payoutTxId;
    const payoutFee = order && order.payoutFee;
    const payoutAmount = order && order.amount;
    const payoutAsset = order && order.asset;
    // §2.3 native-first exactness (#4287 stage 4): expose the EXACT integer base units the payout actually broadcast
    // on-chain (payout_order.amountBaseUnits, stage 1) as a STRING — never a bigint, since this result is JSON-
    // serialised by the payout controller. Null when uncaptured; consumers fall back to the float amount (fail-open).
    const payoutAmountBaseUnits = order?.amountBaseUnits != null ? order.amountBaseUnits.toString() : null;

    return {
      isComplete: order && order.status === PayoutOrderStatus.COMPLETE,
      payoutTxId,
      payoutFee,
      payoutAmount,
      payoutAsset,
      payoutAmountBaseUnits,
    };
  }

  async getRecentPayoutSentCorrelationIds(context: PayoutOrderContext): Promise<Set<string>> {
    const since = new Date(Date.now() - 3600_000); // 1 hour
    const orders = await this.payoutOrderRepo.findBy({
      context,
      status: In([PayoutOrderStatus.PAYOUT_PENDING, PayoutOrderStatus.COMPLETE]),
      updated: MoreThan(since),
    });
    return new Set(orders.map((o) => o.correlationId));
  }

  async estimateFee(targetAsset: Asset, address: string, amount: number, asset: Asset): Promise<FeeResult> {
    const prepareStrategy = this.prepareStrategyRegistry.getPrepareStrategy(targetAsset);
    const payoutStrategy = this.payoutStrategyRegistry.getPayoutStrategy(targetAsset);

    const prepareFee = await prepareStrategy.estimateFee(targetAsset);
    const payoutFee = await payoutStrategy.estimateFee(targetAsset, address, amount, asset);

    const totalFeeAmount = Util.round(prepareFee.amount + payoutFee.amount, 16);

    return { asset: payoutFee.asset, amount: totalFeeAmount };
  }

  async estimateBlockchainFee(asset: Asset): Promise<FeeResult> {
    const payoutStrategy = this.payoutStrategyRegistry.getPayoutStrategy(asset);
    return payoutStrategy.estimateBlockchainFee(asset);
  }

  async speedupTransaction(id: number): Promise<void> {
    const order = await this.payoutOrderRepo.findOneBy({ id });
    if (!order) throw new NotFoundException('Payout order not found');

    // Only an already-broadcast order (payoutTxId set) may be sped up. Any other status would
    // enter doPayout without a payoutTxId, trip the designate-before-broadcast guard and trigger
    // a fresh broadcast — a double-payout risk on an order the operator only meant to accelerate.
    if (order.status !== PayoutOrderStatus.PAYOUT_PENDING)
      throw new BadRequestException(
        `Payout order ${id} cannot be sped up in status ${order.status}, expected ${PayoutOrderStatus.PAYOUT_PENDING}`,
      );

    const strategy = this.payoutStrategyRegistry.getPayoutStrategy(order.asset);

    // Speedup reuses the pending tx's nonce to replace it; only EVM implements that (and only while
    // TX_SPEEDUP is enabled). On any other chain doPayout would broadcast a second, independent
    // transaction while the original stays valid — a double payout. Reject rather than risk it.
    if (!strategy.supportsSpeedup || DisabledProcess(Process.TX_SPEEDUP))
      throw new BadRequestException(`Payout order ${id} does not support transaction speedup`);

    await strategy.doPayout([order]);
  }

  async retryUncertainPayout(accountId: number, dto: RetryPayoutDto): Promise<void> {
    const order = await this.payoutOrderRepo.findOneBy({ id: dto.id });
    if (!order) throw new NotFoundException('Payout order not found');

    if (order.status !== PayoutOrderStatus.PAYOUT_UNCERTAIN)
      throw new BadRequestException(
        `Payout order ${dto.id} cannot be retried in status ${order.status}, expected ${PayoutOrderStatus.PAYOUT_UNCERTAIN}`,
      );

    // An order with a payoutTxId needs reconciliation against the chain, not a retry.
    if (order.payoutTxId)
      throw new BadRequestException(
        `Payout order ${dto.id} has payoutTxId ${order.payoutTxId} and must be reconciled, not retried`,
      );

    if (dto.noBroadcastVerified !== true)
      throw new BadRequestException('On-chain absence must be verified and confirmed (noBroadcastVerified)');

    // Atomic conditional transition — a concurrent state change must not be overwritten.
    // Restore the pre-broadcast retry budget: orders that escalated via the cap still carry
    // retryCount = maxPreBroadcastRetries; without this reset the first transient pre-broadcast
    // error on the manual retry would silently re-escalate to PayoutUncertain.
    //
    // Discarding a signed-but-unrelayed transaction (#4673) belongs to the same transition. The
    // automatic path re-relays such a transaction, which is always safe — but one that can no longer
    // be relayed at all would loop forever, since nothing else ever clears these columns. It is
    // noBroadcastVerified that licenses the discard: the operator has confirmed signedPayoutTxId is
    // absent from the chain, the same assertion every other chain's retry already rebuilds on, and
    // now a lookup rather than an inference. The discarded id is logged below.
    const result = await this.payoutOrderRepo.update(
      { id: order.id, status: PayoutOrderStatus.PAYOUT_UNCERTAIN },
      {
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
        retryCount: 0,
        signedPayoutTxId: null,
        signedPayoutTxMetadata: null,
      },
    );
    if (!result.affected) throw new ConflictException(`Payout order ${dto.id} changed state concurrently, not retried`);

    // Audit trail (before → after): failure MESSAGE history (lastError/lastAttemptDate) is kept
    // until the next broadcast attempt overwrites it; the retry BUDGET is restored above so a
    // verified manual retry tolerates transient pre-broadcast errors instead of re-escalating.
    this.logger.info(
      `Manual payout retry authorized for order ${dto.id} by account ${accountId}: status ${PayoutOrderStatus.PAYOUT_UNCERTAIN} -> ${PayoutOrderStatus.PREPARATION_CONFIRMED}, retryCount ${order.retryCount}, lastError '${order.lastError}', discarded signedPayoutTxId '${order.signedPayoutTxId}', reference: ${dto.verificationReference}`,
    );
  }

  //*** JOBS ***//
  @DfxCron(CronExpression.EVERY_30_SECONDS, { scope: CronScope.WORKER, process: Process.PAY_OUT, timeout: 1800 })
  async processOrders(): Promise<void> {
    await this.checkExistingOrders();
    await this.prepareNewOrders();
    await this.payoutOrders();
    await this.processFailedOrders();
  }

  // Current-state source for the PayoutUncertain alert. Deliberately flagged MONITORING rather
  // than PAY_OUT: disabling payouts must not hide orders which were already parked for
  // investigation, while the flag keeps the job switchable without a deploy — switching it off
  // stops the heartbeat, which the missing-heartbeat alert then surfaces.
  // The logger also emits an empty heartbeat, allowing monitoring to alert separately if this
  // query/job/log path disappears instead of treating missing data as "zero uncertain orders".
  // Scope BOTH, not WORKER: writing a log line is listed in CronScope.BOTH as a qualifying
  // example, and running this job twice is harmless by construction — every line restates the
  // CURRENT stored status per order, so a second producer repeats facts instead of advancing
  // anything. The gain is that the heartbeat survives while one of the two processes is down,
  // which is exactly when parked payout orders must not go dark.
  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.BOTH, process: Process.MONITORING, timeout: 1800 })
  async logUncertainOrdersSnapshot(): Promise<void> {
    const uncertainOrders = await this.payoutOrderRepo.findBy({ status: PayoutOrderStatus.PAYOUT_UNCERTAIN });
    this.logs.logUncertainOrdersSnapshot(uncertainOrders);
  }

  //*** HELPER METHODS ***//

  private async waitForStableInput(): Promise<boolean> {
    const latestDate = await this.getLatestOrderDate();

    return this.verifyDebounceTime(latestDate);
  }

  private async getLatestOrderDate(): Promise<Date> {
    return this.payoutOrderRepo.findOne({ where: {}, order: { created: 'DESC' } }).then((o) => o?.created);
  }

  private verifyDebounceTime(date: Date): boolean {
    return Util.secondsDiff(date) > 5;
  }

  private async checkExistingOrders(): Promise<void> {
    await this.checkPreparationCompletion();
    await this.checkPayoutCompletion();
  }

  private async checkPreparationCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.findBy({
      status: PayoutOrderStatus.PREPARATION_PENDING,
      transferTxId: Not(IsNull()),
    });
    const groups = this.groupByStrategies(orders, (a) => this.prepareStrategyRegistry.getPrepareStrategy(a));

    for (const group of groups.entries()) {
      try {
        const strategy = group[0];
        await strategy.checkPreparationCompletion(group[1]);
      } catch (e) {
        this.logger.error(`Error while checking payout preparation status of payouts ${group[1].map((o) => o.id)}:`, e);
        continue;
      }
    }

    this.logs.logTransferCompletion(orders.filter((o) => o.status === PayoutOrderStatus.PREPARATION_CONFIRMED));
  }

  private async checkPayoutCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.findBy({
      status: PayoutOrderStatus.PAYOUT_PENDING,
      payoutTxId: Not(IsNull()),
    });
    const groups = this.groupByStrategies(orders, (a) => this.payoutStrategyRegistry.getPayoutStrategy(a));

    for (const group of groups.entries()) {
      try {
        const strategy = group[0];
        await strategy.checkPayoutCompletionData(group[1]);
      } catch (e) {
        this.logger.error(`Error while checking payout completion status of payouts ${group[1].map((o) => o.id)}:`, e);
        continue;
      }
    }

    this.logs.logPayoutCompletion(orders.filter((o) => o.status === PayoutOrderStatus.COMPLETE));
  }

  private async prepareNewOrders(): Promise<void> {
    const stable = await this.waitForStableInput();
    if (!stable) return;

    const orders = await this.payoutOrderRepo.findBy({ status: PayoutOrderStatus.CREATED });
    const groups = this.groupByStrategies(orders, (a) => this.prepareStrategyRegistry.getPrepareStrategy(a));

    for (const group of groups.entries()) {
      try {
        const strategy = group[0];
        await strategy.preparePayout(group[1]);
      } catch (e) {
        this.logger.error(`Error while preparing new payout orders ${group[1].map((o) => o.id)}:`, e);
        continue;
      }
    }

    this.logs.logNewPayoutOrders(orders.filter((o) => o.status != PayoutOrderStatus.CREATED));
  }

  private async payoutOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.findBy({ status: PayoutOrderStatus.PREPARATION_CONFIRMED });
    const groups = this.groupByStrategies(orders, (a) => this.payoutStrategyRegistry.getPayoutStrategy(a));

    for (const group of groups.entries()) {
      try {
        const strategy = group[0];
        await strategy.doPayout(group[1]);
      } catch (e) {
        this.logger.error(`Error while paying out new payout orders ${group[1].map((o) => o.id)}:`, e);
        continue;
      }
    }
  }

  private async processFailedOrders(): Promise<void> {
    // A freshly designated order is being broadcast now and its run will resolve it; a crash leftover will still
    // be DESIGNATED one cycle later. Waiting two cron periods avoids false positives and delays escalation once.
    const orders = await this.payoutOrderRepo.findBy({
      status: PayoutOrderStatus.PAYOUT_DESIGNATED,
      updated: LessThan(Util.minutesBefore(1)),
    });
    const escalatedOrders: PayoutOrder[] = [];

    for (const order of orders) {
      try {
        const result = await this.payoutOrderRepo.update(
          { id: order.id, status: PayoutOrderStatus.PAYOUT_DESIGNATED },
          { status: PayoutOrderStatus.PAYOUT_UNCERTAIN },
        );
        if (!result.affected) {
          this.logger.info(`Skipping failed payout order ${order.id}: state changed concurrently`);
          continue;
        }

        escalatedOrders.push(order);
      } catch (e) {
        this.logger.warn(`Failed to escalate payout order ${order.id}; retrying next cycle:`, e);
        continue;
      }
    }

    if (escalatedOrders.length === 0) return;

    const logMessage = this.logs.logFailedOrders(escalatedOrders);
    const mailRequest = this.createMailRequest(logMessage, escalatedOrders);

    // Escalation-then-mail keeps the alert truthful by listing only orders this run actually escalated.
    // Reverting after a mail failure keeps the alert retryable for errors up to the notification
    // persistence; transport-level delivery is owned by the notification subsystem. Residuals (a crash
    // between escalation and mail, a delivery failure after persistence): the orders stay findable by
    // querying PAYOUT_UNCERTAIN.
    try {
      await this.notificationService.sendMail(mailRequest);
    } catch (e) {
      this.logger.error(`Failed to send payout failure alert for orders ${escalatedOrders.map((o) => o.id)}:`, e);

      for (const order of escalatedOrders) {
        try {
          const result = await this.payoutOrderRepo.update(
            { id: order.id, status: PayoutOrderStatus.PAYOUT_UNCERTAIN },
            { status: PayoutOrderStatus.PAYOUT_DESIGNATED },
          );
          if (!result.affected)
            this.logger.warn(
              `Failed to revert payout order ${order.id} after alert failure: state changed concurrently`,
            );
        } catch (revertError) {
          this.logger.warn(`Failed to revert payout order ${order.id} after alert failure:`, revertError);
        }
      }
    }
  }

  private groupByStrategies<T>(orders: PayoutOrder[], getter: (asset: Asset) => T): Map<T, PayoutOrder[]> {
    const groups = new Map<T, PayoutOrder[]>();

    for (const order of orders) {
      const payoutStrategy = getter(order.asset);

      if (!payoutStrategy) {
        this.logger.warn(
          `No PayoutStrategy found by getter ${getter.name} for payout order ID ${order.id}. Ignoring the payout`,
        );
        continue;
      }

      const group = groups.get(payoutStrategy) ?? [];
      group.push(order);

      groups.set(payoutStrategy, group);
    }

    return groups;
  }

  private createMailRequest(errorMessage: string, orders: PayoutOrder[] = []): MailRequest {
    const correlationId = orders.reduce((acc, o) => acc + `|${o.id}&${o.context}|`, '');

    return {
      type: MailType.ERROR_MONITORING,
      context: MailContext.PAYOUT,
      input: { subject: 'Payout Error', errors: [errorMessage], isLiqMail: true },
      correlationId,
      options: { suppressRecurring: true },
    };
  }
}
