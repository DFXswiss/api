import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../entities/payout-order.entity';
import { PayoutOrderFactory } from '../factories/payout-order.factory';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { DuplicatedEntryException } from '../exceptions/duplicated-entry.exception';
import { MailService } from 'src/shared/services/mail.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutStrategiesFacade } from '../strategies/strategies.facade';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';

export interface PayoutRequest {
  context: PayoutOrderContext;
  correlationId: string;
  asset: Asset;
  amount: number;
  destinationAddress: string;
}

@Injectable()
export class PayoutService {
  private readonly processOrdersLock = new Lock(1800);

  constructor(
    private readonly strategies: PayoutStrategiesFacade,
    private readonly mailService: MailService,
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
      } catch {
        continue;
      }

      confirmedOrders.push(order);
    }

    this.logTransferCompletion(confirmedOrders);
  }

  private async checkPayoutCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PAYOUT_PENDING });
    const confirmedOrders = [];

    for (const order of orders) {
      const strategy = this.strategies.getPayoutStrategy(order.asset);

      try {
        await strategy.checkPayoutCompletion(order);
      } catch {
        continue;
      }

      confirmedOrders.push(order);
    }

    this.logPayoutCompletion(confirmedOrders);
  }

  private async prepareNewOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.CREATED });
    const confirmedOrders = [];

    for (const order of orders) {
      const strategy = this.strategies.getPrepareStrategy(order.asset);

      try {
        await strategy.preparePayout(order);
      } catch {
        continue;
      }

      confirmedOrders.push(order);
    }

    this.logNewPayoutOrders(confirmedOrders);
  }

  private async payoutOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PREPARATION_CONFIRMED });

    const DFIOrders = orders.filter(
      (o) => [Blockchain.DEFICHAIN, Blockchain.BITCOIN].includes(o.asset.blockchain) && o.asset.dexName === 'DFI',
    );

    const tokenOrders = orders.filter(
      (o) => [Blockchain.DEFICHAIN, Blockchain.BITCOIN].includes(o.asset.blockchain) && o.asset.dexName !== 'DFI',
    );

    const ethOrders = orders.filter((o) => o.asset.blockchain === Blockchain.ETHEREUM && o.asset.dexName === 'ETH');

    const DFIStrategy = this.strategies.getPayoutStrategy({ blockchain: 'default', assetName: 'DFI' });
    const tokenStrategy = this.strategies.getPayoutStrategy({ blockchain: 'default', assetName: 'default' });
    const ethStrategy = this.strategies.getPayoutStrategy({
      blockchain: Blockchain.ETHEREUM,
      assetName: 'ETH',
    });

    await DFIStrategy.doPayout(DFIOrders);
    await tokenStrategy.doPayout(tokenOrders);
    await ethStrategy.doPayout(ethOrders);
  }

  private async processFailedOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PAYOUT_DESIGNATED });

    if (orders.length === 0) return;

    const logMessage = this.logFailedOrders(orders);
    await this.mailService.sendErrorMail('Payout Error', [logMessage]);

    for (const order of orders) {
      order.pendingInvestigation();
      await this.payoutOrderRepo.save(order);
    }
  }

  //*** LOGS ***//

  private logTransferCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    confirmedOrders.length &&
      console.info(`Prepared funds for ${confirmedOrders.length} payout order(s). ${confirmedOrdersLogs}`);
  }

  private logPayoutCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    confirmedOrders.length &&
      console.info(`Completed ${confirmedOrders.length} payout order(s). ${confirmedOrdersLogs}`);
  }

  private logNewPayoutOrders(newOrders: PayoutOrder[]): void {
    const newOrdersLogs = this.createDefaultOrdersLog(newOrders);

    newOrders.length && console.info(`Processing ${newOrders.length} new payout order(s). ${newOrdersLogs}`);
  }

  private logFailedOrders(failedOrders: PayoutOrder[]): string {
    const failedOrdersLogs = this.createDefaultOrdersLog(failedOrders);
    const message = `${failedOrders.length} payout order(s) failed and pending investigation. ${failedOrdersLogs}`;

    failedOrders.length && console.info(message);

    return message;
  }

  private createDefaultOrdersLog(orders: PayoutOrder[]): string[] {
    return orders.map((o) => `[Order ID: ${o.id}, Context: ${o.context}, CorrelationID: ${o.correlationId}] `);
  }
}
