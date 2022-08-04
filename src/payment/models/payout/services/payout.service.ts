import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { Blockchain } from 'src/ain/node/node.service';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../entities/payout-order.entity';
import { PayoutOrderFactory } from '../factories/payout-order.factory';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { DexService } from '../../dex/services/dex.service';
import { Config } from 'src/config/config';
import { DuplicatedEntryException } from '../exceptions/duplicated-entry.exception';
import { PayoutTokenStrategy } from '../strategies/payout-token.strategy';
import { PayoutDFIStrategy } from '../strategies/payout-dfi.strategy';
import { PayoutChainService } from './payout-chain.service';

export interface PayoutRequest {
  context: PayoutOrderContext;
  correlationId: string;
  asset: string;
  amount: number;
  destinationAddress: string;
}

@Injectable()
export class PayoutService {
  private readonly processOrdersLock = new Lock(1800);

  constructor(
    readonly payoutDFIStrategy: PayoutDFIStrategy,
    readonly payoutTokenStrategy: PayoutTokenStrategy,
    private readonly dexService: DexService,
    private readonly chainService: PayoutChainService,
    private readonly payoutOrderRepo: PayoutOrderRepository,
    private readonly payoutOrderFactory: PayoutOrderFactory,
  ) {}

  //*** PUBLIC API ***//

  async payout(request: PayoutRequest): Promise<void> {
    const { context, correlationId } = request;

    const existingOrder = await this.payoutOrderRepo.findOne({ context, correlationId });

    if (existingOrder) {
      throw new DuplicatedEntryException(
        `Payout order for context ${context} and correlationId ${correlationId} already exists. Order ID: ${existingOrder.id}`,
      );
    }

    const order = this.payoutOrderFactory.createOrder(request, Blockchain.DEFICHAIN);

    await this.payoutOrderRepo.save(order);
  }

  async checkOrderCompletion(
    context: PayoutOrderContext,
    correlationId: string,
  ): Promise<{ isComplete: boolean; payoutTxId: string }> {
    const order = await this.payoutOrderRepo.findOne({ context, correlationId });
    const payoutTxId = order && order.payoutTxId;

    return { isComplete: order && order.status === PayoutOrderStatus.COMPLETED, payoutTxId };
  }

  //*** JOBS ***//

  @Interval(30000)
  async processOrders(): Promise<void> {
    if (!this.processOrdersLock.acquire()) return;

    await this.checkExistingOrders();
    await this.prepareNewOrders();
    await this.payoutOrders();

    this.processOrdersLock.release();
  }

  //*** HELPER METHODS ***//

  private async checkExistingOrders(): Promise<void> {
    await this.checkTransferCompletion();
    await this.checkPayoutCompletion();
  }

  private async checkTransferCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.TRANSFER_PENDING });
    const confirmedOrders = [];

    for (const order of orders) {
      const isTransferComplete = await this.dexService.checkTransferCompletion(order.transferTxId);

      if (isTransferComplete) {
        order.transferConfirmed();
        confirmedOrders.push(order);

        await this.payoutOrderRepo.save(order);
      }
    }

    this.logTransferCompletion(confirmedOrders);
  }

  private async checkPayoutCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PAYOUT_PENDING });
    const confirmedOrders = [];

    for (const order of orders) {
      const isComplete = await this.chainService.checkPayoutCompletion(order.payoutTxId);

      if (isComplete) {
        order.complete();
        confirmedOrders.push(order);

        await this.payoutOrderRepo.save(order);
      }
    }

    this.logPayoutCompletion(confirmedOrders);
  }

  private async prepareNewOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.CREATED });

    for (const order of orders) {
      const { asset, amount } = order;
      const request = { asset, amount, destinationAddress: Config.node.outWalletAddress };

      const transferTxId = await this.dexService.transferLiquidity(request);

      order.pendingTransfer(transferTxId);
      await this.payoutOrderRepo.save(order);
    }

    this.logNewPayoutOrders(orders);
  }

  private async payoutOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.TRANSFER_CONFIRMED });

    const DFIOrders = orders.filter((o) => o.asset === 'DFI');
    const tokenOrders = orders.filter((o) => o.asset !== 'DFI');

    await this.payoutDFIStrategy.doPayout(DFIOrders);
    await this.payoutTokenStrategy.doPayout(tokenOrders);
  }

  //*** LOGS ***//

  private logTransferCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    confirmedOrders.length &&
      console.info(`Prepared liquidity for ${confirmedOrders.length} PayoutOrder(s). ${confirmedOrdersLogs}`);
  }

  private logPayoutCompletion(confirmedOrders: PayoutOrder[]): void {
    const confirmedOrdersLogs = this.createDefaultOrdersLog(confirmedOrders);

    confirmedOrders.length &&
      console.info(`Completed ${confirmedOrders.length} PayoutOrder(s). ${confirmedOrdersLogs}`);
  }

  private logNewPayoutOrders(newOrders: PayoutOrder[]): void {
    const newOrdersLogs = this.createDefaultOrdersLog(newOrders);

    newOrders.length && console.info(`Processing ${newOrders.length} new PayoutOrder(s). ${newOrdersLogs}`);
  }

  private createDefaultOrdersLog(orders: PayoutOrder[]): string[] {
    return orders.map((o) => `Order ID: ${o.id}, Context: ${o.context}, CorrelationID: ${o.correlationId}`);
  }
}
