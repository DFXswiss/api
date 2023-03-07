import { Injectable } from '@nestjs/common';
import { LiquidityOrder, LiquidityOrderContext, LiquidityOrderType } from '../entities/liquidity-order.entity';
import { DexDeFiChainService } from './dex-defichain.service';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderNotReadyException } from '../exceptions/liquidity-order-not-ready.exception';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { Not, IsNull } from 'typeorm';
import { LiquidityOrderFactory } from '../factories/liquidity-order.factory';
import { CheckLiquidityStrategies } from '../strategies/check-liquidity/check-liquidity.facade';
import {
  CheckLiquidityResult,
  TransferRequest,
  LiquidityTransactionResult,
  PurchaseLiquidityRequest,
  ReserveLiquidityRequest,
  CheckLiquidityRequest,
  SellLiquidityRequest,
  TransactionQuery,
  TransactionResult,
} from '../interfaces';
import { PurchaseLiquidityStrategies } from '../strategies/purchase-liquidity/purchase-liquidity.facade';
import { SellLiquidityStrategies } from '../strategies/sell-liquidity/sell-liquidity.facade';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { SupplementaryStrategies } from '../strategies/supplementary/supplementary.facade';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TransferNotRequiredException } from '../exceptions/transfer-not-required.exception';

@Injectable()
export class DexService {
  private readonly verifyPurchaseOrdersLock = new Lock(1800);

  constructor(
    private readonly checkStrategies: CheckLiquidityStrategies,
    private readonly purchaseStrategies: PurchaseLiquidityStrategies,
    private readonly sellStrategies: SellLiquidityStrategies,
    private readonly supplementaryStrategies: SupplementaryStrategies,
    private readonly dexDeFiChainService: DexDeFiChainService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {}

  // *** MAIN PUBLIC API *** //

  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { context, correlationId, targetAsset } = request;

    try {
      const strategy = this.checkStrategies.getCheckLiquidityStrategy(targetAsset);

      if (!strategy) {
        throw new Error(`No check liquidity strategy for asset ${targetAsset.uniqueName}`);
      }

      return await strategy.checkLiquidity(request);
    } catch (e) {
      console.error(e.message);

      throw new Error(`Error while checking liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async reserveLiquidity(request: ReserveLiquidityRequest): Promise<number> {
    const { context, correlationId, targetAsset } = request;

    try {
      console.info(`Reserving ${targetAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`);

      const strategy = this.checkStrategies.getCheckLiquidityStrategy(targetAsset);

      if (!strategy) {
        throw new Error(`No check liquidity strategy for asset ${targetAsset.uniqueName}`);
      }

      const liquidity = await strategy.checkLiquidity(request);

      this.handleCheckLiquidityResult(liquidity);

      const order = this.liquidityOrderFactory.createReservationOrder(request, targetAsset.blockchain);
      order.reserved(liquidity.target.amount);

      await this.liquidityOrderRepo.save(order);

      return order.targetAmount;
    } catch (e) {
      // publicly exposed exceptions
      if (e instanceof NotEnoughLiquidityException) throw e;
      if (e instanceof PriceSlippageException) throw e;

      console.error(e.message);

      // default public exception
      throw new Error(`Error while reserving liquidity. Context: ${context}. Correlation ID: ${correlationId}.`);
    }
  }

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const { context, correlationId, targetAsset } = request;
    const strategy = this.purchaseStrategies.getPurchaseLiquidityStrategy(targetAsset);

    if (!strategy) {
      throw new Error(`No purchase liquidity strategy for asset ${targetAsset.uniqueName}`);
    }

    try {
      console.info(
        `Purchasing ${targetAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`,
      );
      await strategy.purchaseLiquidity(request);
    } catch (e) {
      // publicly exposed exception
      if (e instanceof PriceSlippageException) throw e;
      if (e instanceof NotEnoughLiquidityException) throw e;

      console.error(e.message);

      // default public exception
      throw new Error(`Error while purchasing liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async sellLiquidity(request: SellLiquidityRequest): Promise<void> {
    const { context, correlationId, sellAsset } = request;
    const strategy = this.sellStrategies.getSellLiquidityStrategy(sellAsset);

    if (!strategy) {
      throw new Error(`No sell liquidity strategy for asset ${sellAsset.uniqueName}`);
    }

    try {
      console.info(`Selling ${sellAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`);
      await strategy.sellLiquidity(request);
    } catch (e) {
      // publicly exposed exception
      if (e instanceof PriceSlippageException) throw e;
      if (e instanceof NotEnoughLiquidityException) throw e;

      console.error(e.message);

      // default public exception
      throw new Error(`Error while selling liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async fetchLiquidityTransactionResult(
    context: LiquidityOrderContext,
    correlationId: string,
  ): Promise<LiquidityTransactionResult> {
    const order = await this.liquidityOrderRepo.findOne({ where: { context, correlationId } });

    if (!order) {
      throw new Error(`Order not found. Context: ${context}. Correlation ID: ${correlationId}.`);
    }

    if (!order.targetAmount) {
      throw new LiquidityOrderNotReadyException(`Order is not ready. Order ID: ${order.id}`);
    }

    return order.getLiquidityTransactionResult();
  }

  async checkOrderReady(
    context: LiquidityOrderContext,
    correlationId: string,
  ): Promise<{ isReady: boolean; purchaseTxId: string }> {
    const order = await this.liquidityOrderRepo.findOne({ context, correlationId });

    const purchaseTxId = order && order.txId;
    const isReady = order && order.isReady;

    return { isReady, purchaseTxId };
  }

  async checkOrderCompletion(
    context: LiquidityOrderContext,
    correlationId: string,
  ): Promise<{ isComplete: boolean; purchaseTxId: string }> {
    const order = await this.liquidityOrderRepo.findOne({ context, correlationId });

    const purchaseTxId = order && order.txId;
    const isComplete = order && order.isComplete;

    return { isComplete, purchaseTxId };
  }

  async completeOrders(context: LiquidityOrderContext, correlationId: string): Promise<void> {
    const incompleteOrders = await this.liquidityOrderRepo.find({
      where: { context, correlationId, isComplete: false, isReady: true },
    });

    for (const order of incompleteOrders) {
      order.complete();
      await this.liquidityOrderRepo.save(order);
    }
  }

  async getPendingOrdersCount(asset: Asset): Promise<number> {
    return this.liquidityOrderRepo.count({
      where: [
        { targetAsset: asset, isComplete: false },
        { targetAsset: asset, isReady: false },
        { swapAsset: asset, isComplete: false },
        { swapAsset: asset, isReady: false },
      ],
    });
  }

  // *** SUPPLEMENTARY PUBLIC API *** //

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { asset, amount } = request;
    const strategy = this.supplementaryStrategies.getSupplementaryStrategy(asset);

    if (!strategy) {
      throw new Error(`No supplementary strategy found for asset ${asset.uniqueName} during #transferLiquidity(...)`);
    }

    try {
      console.info(`Transferring ${amount} ${asset.uniqueName} liquidity.`);
      return await strategy.transferLiquidity(request);
    } catch (e) {
      console.error(e.message);

      // default public exception
      throw new Error(`Error while transferring  ${amount} ${asset.uniqueName} liquidity.`);
    }
  }

  async transferMinimalCoin(address: BlockchainAddress): Promise<string> {
    const strategy = this.supplementaryStrategies.getSupplementaryStrategy(address.blockchain);

    if (!strategy) {
      throw new Error(
        `No supplementary strategy found for blockchain ${address.blockchain} during #transferMinimalCoin(...)`,
      );
    }

    try {
      console.info(`Transferring minimal coin amount to address: ${address.address} ${address.blockchain}.`);
      return await strategy.transferMinimalCoin(address.address);
    } catch (e) {
      console.error(e.message);

      // default public exception
      throw new Error(
        `Error while transferring minimal coin amount to address: ${address.address} ${address.blockchain}.`,
      );
    }
  }

  async checkTransferCompletion(transferTxId: string, blockchain: Blockchain): Promise<boolean> {
    const strategy = this.supplementaryStrategies.getSupplementaryStrategy(blockchain);

    if (!strategy) {
      throw new Error(
        `No supplementary strategy found for blockchain ${blockchain} during #checkTransferCompletion(...)`,
      );
    }

    try {
      return await strategy.checkTransferCompletion(transferTxId);
    } catch (e) {
      console.error(e.message);

      // default public exception
      throw new Error(`Error while checking transfer completion for transferTxId: ${transferTxId}.`);
    }
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { asset, amount, since } = query;
    const strategy = this.supplementaryStrategies.getSupplementaryStrategy(asset);

    if (!strategy) {
      throw new Error(`No supplementary strategy found for asset ${asset.uniqueName} during #findTransaction(...)`);
    }

    try {
      return await strategy.findTransaction(query);
    } catch (e) {
      console.error(e.message);

      // default public exception
      throw new Error(`Error while searching ${amount} ${asset.uniqueName} transaction since ${since.toDateString()}.`);
    }
  }

  //*** JOBS ***//

  @Interval(30000)
  async finalizePurchaseOrders(): Promise<void> {
    if (!this.verifyPurchaseOrdersLock.acquire()) return;

    try {
      const standingOrders = await this.liquidityOrderRepo.find({
        isReady: false,
        txId: Not(IsNull()),
      });

      await this.addPurchaseDataToOrders(standingOrders);
    } finally {
      this.verifyPurchaseOrdersLock.release();
    }
  }

  // *** HELPER METHODS *** //

  private handleCheckLiquidityResult(liquidity: CheckLiquidityResult): void {
    const { metadata, target } = liquidity;
    if (!metadata.isEnoughAvailableLiquidity) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${target.asset.dexName}. Available amount: ${target.availableAmount}.`,
      );
    }

    if (metadata.isSlippageDetected) {
      throw new PriceSlippageException(metadata.slippageMessage);
    }
  }

  private async addPurchaseDataToOrders(orders: LiquidityOrder[]): Promise<void> {
    for (const order of orders) {
      switch (order.type) {
        case LiquidityOrderType.PURCHASE:
          await this.addPurchaseDataToOrder(order);
          break;

        case LiquidityOrderType.SELL:
          await this.addSellDataToOrder(order);
          break;

        default:
          continue;
      }
    }
  }

  private async addPurchaseDataToOrder(order: LiquidityOrder): Promise<void> {
    try {
      const strategy = this.purchaseStrategies.getPurchaseLiquidityStrategy(order.targetAsset);

      if (!strategy) {
        throw new Error(`No purchase liquidity strategy for asset ${order.targetAsset.uniqueName}`);
      }

      await strategy.addPurchaseData(order);

      console.info(
        `Liquidity purchase is ready. Order ID: ${order.id}. Context: ${order.context}. Correlation ID: ${order.correlationId}`,
      );
    } catch (e) {
      console.error(`Error while trying to add purchase data to liquidity order. Order ID: ${order.id}`, e);
    }
  }

  private async addSellDataToOrder(order: LiquidityOrder): Promise<void> {
    try {
      const strategy = this.sellStrategies.getSellLiquidityStrategy(order.targetAsset);

      if (!strategy) {
        throw new Error(`No sell liquidity strategy for asset ${order.targetAsset.uniqueName}`);
      }

      await strategy.addSellData(order);

      console.info(
        `Liquidity sell is ready. Order ID: ${order.id}. Context: ${order.context}. Correlation ID: ${order.correlationId}`,
      );
    } catch (e) {
      console.error(`Error while trying to add sell data to liquidity order. Order ID: ${order.id}`, e);
    }
  }
}
