import { Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { CommandBus, EventBus } from '@nestjs/cqrs';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { NotifyAdminCommand } from 'src/poc/subdomains/notification/commands/notify-admin.command';
import { LiquiditySecuredEvent } from '../../events/liquidity-secured.event';
import { PocLiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { PocLiquidityOrder } from '../../models/liquidity-order.entity';
import { DeFiChainUtil } from '../../utils/defichain.util';

interface LiquidityCheckRequest {
  referenceAsset: string;
  targetAsset: string;
  referenceAmount: number;
}

@Injectable()
export class DeFiChainDexLiquidityService {
  private readonly lock = new Lock(1800);

  private dexClient: DeFiClient;

  constructor(
    readonly nodeService: NodeService,
    private readonly eventBus: EventBus,
    private readonly commandBus: CommandBus,
    private readonly liquidityOrderRepo: PocLiquidityOrderRepository,
    private readonly deFiChainUtil: DeFiChainUtil,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  // *** JOBS *** //

  @Interval(30000)
  async checkLiquidityOrders() {
    if (!this.lock.acquire()) return;

    const openOrders = await this.liquidityOrderRepo.find({ isComplete: IsNull(), chain: 'defichain' });

    if (openOrders.length === 0) return;

    for (const order of openOrders) {
      const { blockhash, confirmations } = await this.dexClient.getTx(order.purchaseId);

      if (blockhash && confirmations > 0) {
        console.log(`Liquidity purchased. Order ID: ${order.id}. CorrelationID: ${order.correlationId}`);

        const amount = await this.getLiquidityAfterPurchase(order);

        await this.liquidityOrderRepo.save({ ...order, isComplete: true, amount });
        this.eventBus.publish(
          new LiquiditySecuredEvent(order.correlationId, {
            securedAsset: order.asset,
            securedAmount: amount,
          }),
        );
      }
    }

    this.lock.release();
  }

  // *** PUBLIC API *** //

  async checkAvailableLiquidity(request: LiquidityCheckRequest, correlationId: string): Promise<boolean> {
    console.log(`Checking liquidity for correlationID: ${correlationId}`);

    const requiredAmount = await this.dexClient.testCompositeSwap(
      request.referenceAsset,
      request.targetAsset,
      request.referenceAmount,
    );

    const availableAmount = await this.getAvailableTokenAmount(request.targetAsset);
    const amount = availableAmount >= requiredAmount ? requiredAmount : 0;

    if (amount !== 0) {
      this.eventBus.publish(
        new LiquiditySecuredEvent(correlationId, {
          securedAsset: request.targetAsset,
          securedAmount: amount,
        }),
      );

      return true;
    }

    return false;
  }

  async purchaseLiquidity(swapAmount: number, outputAsset: string, correlationId: string): Promise<void> {
    console.log(`Purchasing liquidity for correlationID: ${correlationId}`);

    const availableDFIAmount = await this.getAvailableTokenAmount('DFI');

    if (swapAmount > availableDFIAmount) {
      const errorMessage = `Not enough DFI liquidity on DEX Node. Trying to purchase ${swapAmount} DFI worth liquidity for asset ${outputAsset}. Available amount: ${availableDFIAmount}`;

      console.error(errorMessage);
      this.commandBus.execute(
        new NotifyAdminCommand(correlationId, { subject: 'Purchase Liquidity Error', errors: [errorMessage] }),
      );

      return;
    }

    const txId = await this.dexClient.compositeSwap(
      Config.node.dexWalletAddress,
      'DFI',
      Config.node.dexWalletAddress,
      outputAsset,
      swapAmount,
    );

    await this.liquidityOrderRepo.insert({
      chain: 'defichain',
      purchaseId: txId,
      correlationId,
      asset: outputAsset,
    });
  }

  // *** HELPER METHODS *** //

  private async getAvailableTokenAmount(outputAsset: string): Promise<number> {
    const tokens = await this.dexClient.getToken();
    const token = tokens.map((t) => this.dexClient.parseAmount(t.amount)).find((pt) => pt.asset === outputAsset);

    return token ? token.amount : 0;
  }

  private async getLiquidityAfterPurchase(order: PocLiquidityOrder): Promise<number> {
    const { purchaseId, asset } = order;

    const historyEntry = await this.deFiChainUtil.getHistoryEntryForTx(purchaseId, this.dexClient);

    if (!historyEntry) {
      throw new Error(`Could not find transaction with ID: ${purchaseId} while trying to extract purchased liquidity`);
    }

    const amounts = historyEntry.amounts.map((a) => this.dexClient.parseAmount(a));

    const { amount } = amounts.find((a) => a.asset === asset);

    if (!amount) {
      throw new Error(`Failed to get amount for TX: ${purchaseId} while trying to extract purchased liquidity`);
    }

    return amount;
  }
}
