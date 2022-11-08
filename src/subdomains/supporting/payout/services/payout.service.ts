import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../entities/payout-order.entity';
import { PayoutOrderFactory } from '../factories/payout-order.factory';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { DuplicatedEntryException } from '../exceptions/duplicated-entry.exception';
import { PayoutLogService } from './payout-log.service';
import { FeeRequest, FeeResult, PayoutRequest } from '../interfaces';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { PayoutStrategiesFacade, PayoutStrategyAlias } from '../strategies/payout/payout.facade';
import { PrepareStrategiesFacade } from '../strategies/prepare/prepare.facade';
import { Util } from 'src/shared/utils/util';

@Injectable()
export class PayoutService {
  private readonly processOrdersLock = new Lock(1800);

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
      const { context, correlationId } = request;

      const existingOrder = await this.payoutOrderRepo.findOne({ context, correlationId });

      if (existingOrder) {
        throw new DuplicatedEntryException(
          `Payout order for context ${context} and correlationId ${correlationId} already exists. Order ID: ${existingOrder.id}`,
        );
      }

      const order = this.payoutOrderFactory.createOrder(request);

      await this.payoutOrderRepo.save(order);
    } catch (e) {
      if (e instanceof DuplicatedEntryException) throw e;

      console.error(e);
      throw new Error(
        `Error while trying to create PayoutOrder for context ${request.context} and correlationId: ${request.correlationId}`,
      );
    }
  }

  async checkOrderCompletion(
    context: PayoutOrderContext,
    correlationId: string,
  ): Promise<{ isComplete: boolean; payoutTxId: string; payoutFee: FeeResult }> {
    const order = await this.payoutOrderRepo.findOne({ context, correlationId });
    const payoutTxId = order && order.payoutTxId;
    const payoutFee = order && order.payoutFee;

    return { isComplete: order && order.status === PayoutOrderStatus.COMPLETE, payoutTxId, payoutFee };
  }

  async estimateFee(request: FeeRequest): Promise<FeeResult> {
    const prepareStrategy = this.prepareStrategies.getPrepareStrategy(request.asset);
    const payoutStrategy = this.payoutStrategies.getPayoutStrategy(request.asset);

    const prepareFee = await prepareStrategy.estimateFee(request.asset);
    const payoutFee = await payoutStrategy.estimateFee(request.quantityOfTransactions, request.asset);

    const totalFeeAmount = Util.round(prepareFee.amount + payoutFee.amount, 8);

    return { asset: payoutFee.asset, amount: totalFeeAmount };
  }

  //*** JOBS ***//

  @Interval(30000)
  async processOrders(): Promise<void> {
    if (!this.processOrdersLock.acquire()) return;

    await this.checkExistingOrders();
    await this.prepareNewOrders();
    await this.payoutOrders();
    await this.processFailedOrders();

    this.processOrdersLock.release();
  }

  //*** HELPER METHODS ***//

  private async checkExistingOrders(): Promise<void> {
    await this.checkPreparationCompletion();
    await this.checkPayoutCompletion();
  }

  private async checkPreparationCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PREPARATION_PENDING });
    const confirmedOrders = [];

    for (const order of orders) {
      const strategy = this.prepareStrategies.getPrepareStrategy(order.asset);

      try {
        await strategy.checkPreparationCompletion(order);
        order.status === PayoutOrderStatus.PREPARATION_CONFIRMED && confirmedOrders.push(order);
      } catch (e) {
        console.error('Error while checking payout preparation status', e);
        continue;
      }
    }

    this.logs.logTransferCompletion(confirmedOrders);
  }

  private async checkPayoutCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PAYOUT_PENDING });
    const confirmedOrders = [];

    for (const order of orders) {
      const strategy = this.payoutStrategies.getPayoutStrategy(order.asset);

      try {
        await strategy.checkPayoutCompletionData(order);
        order.status === PayoutOrderStatus.COMPLETE && confirmedOrders.push(order);
      } catch {
        continue;
      }
    }

    this.logs.logPayoutCompletion(confirmedOrders);
  }

  private async prepareNewOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.CREATED });
    const confirmedOrders = [];

    for (const order of orders) {
      const strategy = this.prepareStrategies.getPrepareStrategy(order.asset);

      try {
        await strategy.preparePayout(order);
        order.status !== PayoutOrderStatus.CREATED && confirmedOrders.push(order);
      } catch {
        continue;
      }
    }

    this.logs.logNewPayoutOrders(confirmedOrders);
  }

  private async payoutOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PREPARATION_CONFIRMED });
    const groups = this.groupOrdersByPayoutStrategies(orders);

    for (const group of groups.entries()) {
      try {
        const strategy = this.payoutStrategies.getPayoutStrategy(group[0]);
        await strategy.doPayout(group[1]);
      } catch {
        continue;
      }
    }
  }

  private async processFailedOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PAYOUT_DESIGNATED });

    if (orders.length === 0) return;

    const logMessage = this.logs.logFailedOrders(orders);
    const mailRequest = this.createMailRequest(logMessage, orders);

    await this.notificationService.sendMail(mailRequest);

    for (const order of orders) {
      order.pendingInvestigation();
      await this.payoutOrderRepo.save(order);
    }
  }

  private groupOrdersByPayoutStrategies(orders: PayoutOrder[]): Map<PayoutStrategyAlias, PayoutOrder[]> {
    const groups = new Map<PayoutStrategyAlias, PayoutOrder[]>();

    for (const order of orders) {
      const alias = this.payoutStrategies.getPayoutStrategyAlias(order.asset);

      if (!alias) {
        console.warn(`No payout alias found for payout order ID ${order.id}. Ignoring the order`);
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
