import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../entities/payout-order.entity';
import { PayoutOrderFactory } from '../factories/payout-order.factory';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { DuplicatedEntryException } from '../exceptions/duplicated-entry.exception';
import { PayoutStrategiesFacade, PayoutStrategyAlias } from '../strategies/strategies.facade';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { PayoutLogService } from './payout-log.service';
import { PayoutRequest } from '../interfaces';
import { MailContext, MailType } from 'src/notification/enums';
import { NotificationService } from 'src/notification/services/notification.service';
import { MailRequest } from 'src/notification/interfaces';

@Injectable()
export class PayoutService {
  private readonly processOrdersLock = new Lock(1800);

  constructor(
    private readonly strategies: PayoutStrategiesFacade,
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
  ): Promise<{ isComplete: boolean; payoutTxId: string }> {
    const order = await this.payoutOrderRepo.findOne({ context, correlationId });
    const payoutTxId = order && order.payoutTxId;

    return { isComplete: order && order.status === PayoutOrderStatus.COMPLETE, payoutTxId };
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
      const strategy = this.strategies.getPrepareStrategy(order.asset);

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
      const strategy = this.strategies.getPayoutStrategy(order.asset);

      try {
        await strategy.checkPayoutCompletion(order);
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
      const strategy = this.strategies.getPrepareStrategy(order.asset);

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

    const dfiOrders = orders.filter((o) => o.asset.blockchain === Blockchain.DEFICHAIN && o.asset.dexName === 'DFI');
    const tokenOrders = orders.filter((o) => o.asset.blockchain === Blockchain.DEFICHAIN && o.asset.dexName !== 'DFI');
    const ethOrders = orders.filter((o) => o.asset.blockchain === Blockchain.ETHEREUM && o.asset.dexName === 'ETH');
    const bnbOrders = orders.filter(
      (o) => o.asset.blockchain === Blockchain.BINANCE_SMART_CHAIN && o.asset.dexName === 'BNB',
    );

    const dfiStrategy = this.strategies.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_DFI);
    const tokenStrategy = this.strategies.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_TOKEN);
    const ethStrategy = this.strategies.getPayoutStrategy(PayoutStrategyAlias.ETHEREUM_DEFAULT);
    const bnbStrategy = this.strategies.getPayoutStrategy(PayoutStrategyAlias.BSC_DEFAULT);

    await dfiStrategy.doPayout(dfiOrders);
    await tokenStrategy.doPayout(tokenOrders);
    await ethStrategy.doPayout(ethOrders);
    await bnbStrategy.doPayout(bnbOrders);
  }

  private async processFailedOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PAYOUT_DESIGNATED });

    if (orders.length === 0) return;

    const logMessage = this.logs.logFailedOrders(orders);
    const mailRequest = this.createMailRequest(orders, logMessage);

    await this.notificationService.sendMail(mailRequest);

    for (const order of orders) {
      order.pendingInvestigation();
      await this.payoutOrderRepo.save(order);
    }
  }

  private createMailRequest(orders: PayoutOrder[], errorMessage: string): MailRequest {
    const correlationId = JSON.stringify(orders.map((o) => `${o.id}&${o.context}`));

    return {
      type: MailType.ERROR,
      input: { subject: 'Payout Error', errors: [errorMessage] },
      metadata: {
        context: MailContext.PAYOUT,
        correlationId,
      },
      options: { suppressRecurring: true },
    };
  }
}
