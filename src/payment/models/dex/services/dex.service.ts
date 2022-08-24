import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrder, LiquidityOrderContext } from '../entities/liquidity-order.entity';
import { DexDeFiChainService } from './dex-defichain.service';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderNotReadyException } from '../exceptions/liquidity-order-not-ready.exception';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { Not, IsNull } from 'typeorm';
import { LiquidityOrderFactory } from '../factories/liquidity-order.factory';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { MailService } from 'src/shared/services/mail.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { DexStrategiesFacade } from '../strategies/strategies.facade';

export interface LiquidityRequest {
  context: LiquidityOrderContext;
  correlationId: string;
  referenceAsset: string;
  referenceAmount: number;
  targetAsset: Asset;
}

export interface TransferRequest {
  asset: Asset;
  amount: number;
  destinationAddress: string;
}

@Injectable()
export class DexService {
  private readonly verifyPurchaseOrdersLock = new Lock(1800);

  constructor(
    readonly mailService: MailService,
    readonly settingService: SettingService,
    readonly assetService: AssetService,
    private readonly strategies: DexStrategiesFacade,
    private readonly dexDeFiChainService: DexDeFiChainService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {}

  // *** PUBLIC API *** //

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const { context, correlationId, targetAsset } = request;

    try {
      const strategy = this.strategies.getCheckLiquidityStrategy(targetAsset);

      return strategy.checkLiquidity(request);
    } catch (e) {
      // publicly exposed exceptions
      if (e instanceof NotEnoughLiquidityException) return 0;
      if (e instanceof PriceSlippageException) throw e;

      console.error(e.message);

      // default public exception
      throw new Error(`Error while checking liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async reserveLiquidity(request: LiquidityRequest): Promise<number> {
    const { context, correlationId, targetAsset } = request;

    try {
      console.info(`Reserving ${targetAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`);

      const strategy = this.strategies.getCheckLiquidityStrategy(targetAsset);

      const liquidity = await strategy.checkLiquidity(request);

      if (liquidity !== 0) {
        const order = this.liquidityOrderFactory.createReservationOrder(request, Blockchain.DEFICHAIN);
        order.reserved(liquidity);

        await this.liquidityOrderRepo.save(order);

        return order.targetAmount;
      }

      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${targetAsset.dexName}. Available amount: 0. Fallback error message.`,
      );
    } catch (e) {
      // publicly exposed exceptions
      if (e instanceof NotEnoughLiquidityException) throw e;
      if (e instanceof PriceSlippageException) throw e;

      console.error(e.message);

      // default public exception
      throw new Error(`Error while reserving liquidity. Context: ${context}. Correlation ID: ${correlationId}.`);
    }
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const { context, correlationId, targetAsset } = request;
    const strategy = this.strategies.getPurchaseLiquidityStrategy(targetAsset);

    if (!strategy) {
      throw new Error(`No purchase liquidity strategy for asset category ${targetAsset?.category}`);
    }

    try {
      console.info(
        `Purchasing ${targetAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`,
      );
      await strategy.purchaseLiquidity(request);
    } catch (e) {
      // publicly exposed exception
      if (e instanceof PriceSlippageException) throw e;

      console.error(e.message);

      // default public exception
      throw new Error(`Error while purchasing liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    try {
      return await this.dexDeFiChainService.transferLiquidity(destinationAddress, asset.dexName, amount);
    } catch (e) {}
  }

  async transferMinimalUtxo(address: string): Promise<string> {
    return this.dexDeFiChainService.transferMinimalUtxo(address);
  }

  async fetchTargetLiquidityAfterPurchase(context: LiquidityOrderContext, correlationId: string): Promise<number> {
    const order = await this.liquidityOrderRepo.findOne({ where: { context, correlationId } });

    if (!order) {
      throw new Error(`Order not found. Context: ${context}. Correlation ID: ${correlationId}.`);
    }

    if (!order.targetAmount) {
      throw new LiquidityOrderNotReadyException(`Order is not ready. Order ID: ${order.id}`);
    }

    return order.targetAmount;
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexDeFiChainService.checkTransferCompletion(transferTxId);
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

  @Interval(30000)
  async verifyPurchaseOrders(): Promise<void> {
    if (!this.verifyPurchaseOrdersLock.acquire()) return;

    const standingOrders = await this.liquidityOrderRepo.find({
      isReady: false,
      purchaseTxId: Not(IsNull()),
    });

    await this.addPurchasedAmountsToOrders(standingOrders);

    this.verifyPurchaseOrdersLock.release();
  }

  // *** HELPER METHODS *** //

  private async addPurchasedAmountsToOrders(orders: LiquidityOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const amount = await this.dexDeFiChainService.getPurchasedAmount(order.purchaseTxId, order.targetAsset.dexName);

        order.purchased(amount);
        await this.liquidityOrderRepo.save(order);

        console.info(
          `Liquidity purchase is ready. Order ID: ${order.id}. Context: ${order.context}. Correlation ID: ${order.correlationId}`,
        );
      } catch {
        continue;
      }
    }
  }
}
