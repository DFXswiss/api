import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { Interval } from '@nestjs/schedule';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { Lock } from 'src/shared/lock';
import { IsNull, Not } from 'typeorm';
import { PayoutCompleteEvent } from '../../events/payout-complete.event';
import { PayoutPreparedEvent } from '../../events/payout-prepared.event';
import { PocPayoutOrder } from '../../models/payout-order.entity';
import { PocPayoutOrderRepository } from '../../repositories/payout-order.repository';

interface PayoutLiquidityRequest {
  amount: number;
  asset: string;
  destination: string;
}

@Injectable()
export class DeFiChainPayoutService {
  private readonly preparePayoutLock = new Lock(1800);
  private readonly checkPayoutLock = new Lock(1800);

  private dexClient: DeFiClient;
  private outClient: DeFiClient;

  constructor(
    readonly nodeService: NodeService,
    private readonly eventBus: EventBus,
    private readonly payoutOrderRepo: PocPayoutOrderRepository,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.outClient = client));
  }

  // *** JOBS *** //

  @Interval(60000)
  async checkLiquidityTransferCompletion() {
    if (!this.preparePayoutLock.acquire()) return;

    const openOrders = await this.payoutOrderRepo.find({
      chain: 'defichain',
      isLiquidityTransferComplete: IsNull(),
      liquidityTransferId: Not(IsNull()),
    });

    for (const order of openOrders) {
      const { blockhash, confirmations } = await this.dexClient.getTx(order.liquidityTransferId);

      if (blockhash && confirmations > 0) {
        await this.payoutOrderRepo.save({ ...order, isLiquidityTransferComplete: true });
        this.eventBus.publish(
          new PayoutPreparedEvent(order.correlationId, { payoutReservationId: order.id.toString() }),
        );
      }
    }

    this.preparePayoutLock.release();
  }

  @Interval(60000)
  async checkPayoutCompletion() {
    if (!this.preparePayoutLock.acquire()) return;

    const openOrders = await this.payoutOrderRepo.find({
      chain: 'defichain',
      isComplete: IsNull(),
      payoutId: Not(IsNull()),
    });

    for (const order of openOrders) {
      const { blockhash, confirmations } = await this.dexClient.getTx(order.liquidityTransferId);

      if (blockhash && confirmations > 0) {
        await this.payoutOrderRepo.save({ ...order, isComplete: true });
        this.eventBus.publish(new PayoutCompleteEvent(order.correlationId, { payoutTransactionId: order.payoutId }));
      }
    }

    this.preparePayoutLock.release();
  }

  // *** PUBLIC API *** //

  async preparePayout(request: PayoutLiquidityRequest, correlationId: string): Promise<void> {
    const txId = await this.dexClient.sendToken(
      Config.node.dexWalletAddress,
      Config.node.outWalletAddress,
      request.asset,
      request.amount,
    );

    await this.payoutOrderRepo.insert({
      chain: 'defichain',
      liquidityTransferId: txId,
      correlationId,
      asset: request.asset,
      amount: request.amount,
      destination: request.destination,
    });
  }

  async getOrder(id: string): Promise<PocPayoutOrder> {
    const order = this.payoutOrderRepo.findOne(id);

    if (!order) {
      throw new Error(`PayoutOrder not found. ID: ${id}`);
    }

    return order;
  }
}
