import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { Blockchain } from 'src/blockchain/ain/node/node.service';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../entities/payout-order.entity';
import { PayoutOrderFactory } from '../factories/payout-order.factory';
import { PayoutOrderRepository } from '../repositories/payout-order.repository';
import { DexService } from '../../dex/services/dex.service';
import { DuplicatedEntryException } from '../exceptions/duplicated-entry.exception';
import { PayoutTokenStrategy } from '../strategies/payout-token.strategy';
import { PayoutDFIStrategy } from '../strategies/payout-dfi.strategy';
import { PayoutDeFiChainService } from './payout-defichain.service';
import { MailService } from 'src/shared/services/mail.service';

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
    private readonly mailService: MailService,
    private readonly dexService: DexService,
    private readonly defichainService: PayoutDeFiChainService,
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

      const order = this.payoutOrderFactory.createOrder(request, Blockchain.DEFICHAIN);

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
    await this.checkTransferCompletion();
    await this.checkPayoutCompletion();
  }

  private async checkTransferCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.TRANSFER_PENDING });
    const confirmedOrders = [];

    for (const order of orders) {
      try {
        const isTransferComplete = await this.dexService.checkTransferCompletion(order.transferTxId);

        if (isTransferComplete) {
          order.transferConfirmed();
          confirmedOrders.push(order);

          await this.payoutOrderRepo.save(order);
        }
      } catch (e) {
        console.error(`Error in checking completion of funds transfer for payout order. Order ID: ${order.id}`, e);
        continue;
      }
    }

    this.logTransferCompletion(confirmedOrders);
  }

  private async checkPayoutCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PAYOUT_PENDING });
    const confirmedOrders = [];

    for (const order of orders) {
      try {
        const isComplete = await this.defichainService.checkPayoutCompletion(order.context, order.payoutTxId);

        if (isComplete) {
          order.complete();
          confirmedOrders.push(order);

          await this.payoutOrderRepo.save(order);
        }
      } catch (e) {
        console.error(`Error in checking payout order completion. Order ID: ${order.id}`, e);
      }
    }

    this.logPayoutCompletion(confirmedOrders);
  }

  private async prepareNewOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.CREATED });
    const confirmedOrders = [];

    for (const order of orders) {
      try {
        const { asset, amount, context } = order;
        const destinationAddress = this.defichainService.getWallet(context);
        const request = { asset, amount, destinationAddress };

        const transferTxId = await this.dexService.transferLiquidity(request);

        order.pendingTransfer(transferTxId);
      } catch (e) {
        console.error(`Error in transferring liquidity for payout order. Order ID: ${order.id}`, e);
        return;
      }

      try {
        await this.payoutOrderRepo.save(order);
        confirmedOrders.push(order);
      } catch (e) {
        // db failure case, internal transfer - just logging is sufficient
        console.error(`Error in saving liquidity transfer txId to payout order. Order ID: ${order.id}`, e);
      }
    }

    this.logNewPayoutOrders(confirmedOrders);
  }

  private async payoutOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.TRANSFER_CONFIRMED });

    const DFIOrders = orders.filter((o) => o.asset === 'DFI');
    const tokenOrders = orders.filter((o) => o.asset !== 'DFI');

    await this.payoutDFIStrategy.doPayout(DFIOrders);
    await this.payoutTokenStrategy.doPayout(tokenOrders);
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
