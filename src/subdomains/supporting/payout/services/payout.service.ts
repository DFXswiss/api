import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FindOptionsRelations, IsNull, MoreThan, Not } from 'typeorm';
import { MailRequest } from '../../notification/interfaces';
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
      if (DisabledProcess(Process.CRYPTO_PAYOUT)) throw new BadRequestException('Safety module deactivated');

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
  ): Promise<{ isComplete: boolean; payoutTxId: string; payoutFee: FeeResult }> {
    const order = await this.payoutOrderRepo.findOneBy({ context, correlationId });
    const payoutTxId = order && order.payoutTxId;
    const payoutFee = order && order.payoutFee;

    return { isComplete: order && order.status === PayoutOrderStatus.COMPLETE, payoutTxId, payoutFee };
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

    const strategy = this.payoutStrategyRegistry.getPayoutStrategy(order.asset);

    await strategy.doPayout([order]);
  }

  //*** JOBS ***//
  @DfxCron(CronExpression.EVERY_30_SECONDS, { process: Process.PAY_OUT, timeout: 1800 })
  async processOrders(): Promise<void> {
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
