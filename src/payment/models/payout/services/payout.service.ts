import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { Blockchain } from 'src/ain/node/node.service';
import { PayoutOrderContext, PayoutOrderStatus } from '../entities/payout-order.entity';
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

  @Interval(30000)
  async processOrders(): Promise<void> {
    if (!this.processOrdersLock.acquire()) return;

    await this.checkExistingOrders();
    await this.prepareNewOrders();
    await this.payoutOrders();

    this.processOrdersLock.release();
  }

  private async checkExistingOrders(): Promise<void> {
    await this.checkTransferCompletion();
    await this.checkPayoutCompletion();
  }

  private async checkTransferCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.TRANSFER_PENDING });

    for (const order of orders) {
      const isComplete = await this.dexService.checkTransferCompletion(order.transferTxId);

      if (isComplete) {
        order.transferConfirmed();
        await this.payoutOrderRepo.save(order);
      }
    }
  }

  private async checkPayoutCompletion(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.PAYOUT_PENDING });

    for (const order of orders) {
      const isComplete = await this.chainService.checkPayoutCompletion(order.payoutTxId);

      if (isComplete) {
        order.payoutConfirmed();
        await this.payoutOrderRepo.save(order);
      }
    }
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
  }

  private async payoutOrders(): Promise<void> {
    const orders = await this.payoutOrderRepo.find({ status: PayoutOrderStatus.TRANSFER_CONFIRMED });

    const DFIOrders = orders.filter((o) => o.asset === 'DFI');
    const tokenOrders = orders.filter((o) => o.asset !== 'DFI');

    await this.payoutDFIStrategy.doPayout(DFIOrders);
    await this.payoutTokenStrategy.doPayout(tokenOrders);
  }
}
