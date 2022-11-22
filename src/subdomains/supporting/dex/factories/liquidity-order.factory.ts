import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrder, LiquidityOrderType } from '../entities/liquidity-order.entity';
import { PurchaseLiquidityRequest, ReserveLiquidityRequest, SellLiquidityRequest } from '../interfaces';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class LiquidityOrderFactory {
  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository) {}

  // *** PUBLIC API *** //

  createPurchaseOrder(request: PurchaseLiquidityRequest, chain: Blockchain, strategy: string): LiquidityOrder {
    const order = this.createGetLiquidityOrder(request, chain, LiquidityOrderType.PURCHASE);
    order.strategy = strategy;

    return order;
  }

  createReservationOrder(request: ReserveLiquidityRequest, chain: Blockchain): LiquidityOrder {
    return this.createGetLiquidityOrder(request, chain, LiquidityOrderType.RESERVATION);
  }

  createSellOrder(
    request: SellLiquidityRequest,
    chain: Blockchain,
    strategy: string,
    targetAsset: Asset,
  ): LiquidityOrder {
    const { context, correlationId, sellAsset, sellAmount } = request;

    return this.liquidityOrderRepo.create({
      type: LiquidityOrderType.SELL,
      context,
      correlationId,
      chain,
      referenceAsset: sellAsset,
      referenceAmount: sellAmount,
      targetAsset,
      strategy,
    });
  }

  // *** HELPER METHODS *** //

  private createGetLiquidityOrder(
    request: PurchaseLiquidityRequest | ReserveLiquidityRequest,
    chain: Blockchain,
    type: LiquidityOrderType,
  ): LiquidityOrder {
    const { context, correlationId, referenceAsset, referenceAmount, targetAsset } = request;

    return this.liquidityOrderRepo.create({
      type,
      context,
      correlationId,
      chain,
      referenceAsset,
      referenceAmount,
      targetAsset,
    });
  }
}
