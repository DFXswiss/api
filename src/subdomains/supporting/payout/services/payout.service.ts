import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../entities/payout-order.entity';
import { PayoutOrderFactory } from '../factories/payout-order.factory';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { PayoutLogService } from './payout-log.service';
import { FeeResult, PayoutRequest } from '../interfaces';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { PayoutStrategiesFacade } from '../strategies/payout/payout.facade';
import { PrepareStrategiesFacade } from '../strategies/prepare/prepare.facade';
import { Util } from 'src/shared/utils/util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IsNull, Not } from 'typeorm';
import { Config, Process } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class PayoutService {
  private readonly logger = new DfxLogger(PayoutService);

  constructor(
    private readonly payoutStrategies: PayoutStrategiesFacade,
    private readonly prepareStrategies: PrepareStrategiesFacade,
    private readonly logs: PayoutLogService,
    private readonly notificationService: NotificationService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
    private readonly payoutOrderFactory: PayoutOrderFactory,
  ) {}

  //*** PUBLIC API ***//

  async doPayout(request: PayoutRequest): Promise<void> {
    try {
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
  ): Promise<{ isComplete: boolean; payoutTxId: string; payoutFee: FeeResult }> {
    const order = await this.payoutOrderRepo.findOneBy({ context, correlationId });
    const payoutTxId = order && order.payoutTxId;
    const payoutFee = order && order.payoutFee;

    return { isComplete: order && order.status === PayoutOrderStatus.COMPLETE, payoutTxId, payoutFee };
  }

  async estimateFee(asset: Asset): Promise<FeeResult> {
    const prepareStrategy = this.prepareStrategies.getPrepareStrategy(asset);
    const payoutStrategy = this.payoutStrategies.getPayoutStrategy(asset);

    const prepareFee = await prepareStrategy.estimateFee(asset);
    const payoutFee = await payoutStrategy.estimateFee(asset);

    const totalFeeAmount = Util.round(prepareFee.amount + payoutFee.amount, 16);

    return { asset: payoutFee.asset, amount: totalFeeAmount };
  }

  //*** JOBS ***//
  @Cron(CronExpression.EVERY_30_SECONDS)
  @Lock(1800)
  async processOrders(): Promise<void> {
    if (Config.processDisabled(Process.PAY_OUT)) return;
    await this.checkExistingOrders();
    await this.prepareNewOrders();
    await this.payoutOrders();
    await this.processFailedOrders();
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
    return Util.secondsDiff(date, new Date()) > 5;
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
    const groups = this.groupByStrategies(orders, this.prepareStrategies.getPrepareStrategyAlias);

    for (const group of groups.entries()) {
      try {
        const strategy = this.prepareStrategies.getPrepareStrategy(group[0]);
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
    const groups = this.groupByStrategies(orders, this.payoutStrategies.getPayoutStrategyAlias);

    for (const group of groups.entries()) {
      try {
        const strategy = this.payoutStrategies.getPayoutStrategy(group[0]);
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
    const groups = this.groupByStrategies(orders, this.prepareStrategies.getPrepareStrategyAlias);

    for (const group of groups.entries()) {
      try {
        const strategy = this.prepareStrategies.getPrepareStrategy(group[0]);
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
    const groups = this.groupByStrategies(orders, this.payoutStrategies.getPayoutStrategyAlias);

    for (const group of groups.entries()) {
      try {
        const strategy = this.payoutStrategies.getPayoutStrategy(group[0]);
        await strategy.doPayout(group[1]);
      } catch (e) {
        this.logger.error(`Error while paying out new payout orders ${group[1].map((o) => o.id)}:`, e);
        continue;
      }
    }
  }

  private async processFailedOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.findBy({ status: PayoutOrderStatus.PAYOUT_DESIGNATED });

    if (orders.length === 0) return;

    const logMessage = this.logs.logFailedOrders(orders);
    const mailRequest = this.createMailRequest(logMessage, orders);

    await this.notificationService.sendMail(mailRequest);

    for (const order of orders) {
      order.pendingInvestigation();
      await this.payoutOrderRepo.save(order);
    }
  }

  private groupByStrategies<T>(orders: PayoutOrder[], getter: (asset: Asset) => T): Map<T, PayoutOrder[]> {
    const groups = new Map<T, PayoutOrder[]>();

    for (const order of orders) {
      const alias = getter(order.asset);

      if (!alias) {
        this.logger.warn(
          `No alias found by getter ${getter.name} for payout order ID ${order.id}. Ignoring the payout`,
        );
        continue;
      }

      const group = groups.get(alias) ?? [];
      group.push(order);

      groups.set(alias, group);
    }

    return groups;
  }

  private createMailRequest(errorMessage: string, orders: PayoutOrder[] = []): MailRequest {
    const correlationId = orders.reduce((acc, o) => acc + `|${o.id}&${o.context}|`, '');

    return {
      type: MailType.ERROR_MONITORING,
      input: { subject: 'Payout Error', errors: [errorMessage] },
      metadata: {
        context: MailContext.PAYOUT,
        correlationId,
      },
      options: { suppressRecurring: true },
    };
  }
}
