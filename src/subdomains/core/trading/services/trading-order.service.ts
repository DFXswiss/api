import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementRuleStatus } from '../../liquidity-management/enums';
import { LiquidityManagementService } from '../../liquidity-management/services/liquidity-management.service';
import { TradingOrder } from '../entities/trading-order.entity';
import { TradingOrderStatus } from '../enums';
import { WaitingForLiquidityException } from '../exceptions/waiting-for-liquidity.exception';
import { TradingOrderRepository } from '../repositories/trading-order.respository';
import { TradingRuleRepository } from '../repositories/trading-rule.respository';

@Injectable()
export class TradingOrderService implements OnModuleInit {
  private readonly logger = new DfxLogger(TradingOrderService);

  @Inject() private readonly ruleRepo: TradingRuleRepository;
  @Inject() private readonly orderRepo: TradingOrderRepository;

  private chf: Fiat;

  constructor(
    private readonly dexService: DexService,
    private readonly notificationService: NotificationService,
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly liquidityService: LiquidityManagementService,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly assetService: AssetService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
  }

  // --- PUBLIC API --- //

  async processOrders() {
    await this.startNewOrders();
    await this.checkRunningOrders();
  }

  async getTradingOrderYield(from: Date): Promise<{ profit: number; fee: number }> {
    const { profit, fee } = await this.orderRepo
      .createQueryBuilder('tradingOrder')
      .select('SUM(profitChf)', 'profit')
      .addSelect('SUM(txFeeAmountChf)', 'fee')
      .where('created >= :from', { from })
      .getRawOne<{ profit: number; fee: number }>();

    return { profit: profit ?? 0, fee: fee ?? 0 };
  }

  // --- HELPER METHODS --- //

  private async startNewOrders(): Promise<void> {
    const orders = await this.orderRepo.findBy({ status: TradingOrderStatus.CREATED });

    for (const order of orders) {
      await this.executeOrder(order);
    }
  }

  private async executeOrder(order: TradingOrder): Promise<void> {
    try {
      if (!order.isCreated()) {
        this.logger.info(`Could not execute order ${order.id}: status is ${order.status}`);
        return;
      }

      order.inProgress();
      await this.orderRepo.save(order);

      await this.reserveLiquidity(order);
      await this.purchaseLiquidity(order);

      this.logger.verbose(`Trading order ${order.id} in progress`);
    } catch (e) {
      await this.handleOrderFail('execute', order, e);
    }
  }

  private async reserveLiquidity(order: TradingOrder): Promise<void> {
    const liquidityRequest: ReserveLiquidityRequest = {
      context: LiquidityOrderContext.TRADING,
      correlationId: `${order.id}`,
      referenceAmount: order.amountIn,
      referenceAsset: order.assetIn,
      targetAsset: order.assetIn,
    };

    // adapt the amount if not enough liquidity (down to half)
    let {
      reference: { availableAmount },
    } = await this.dexService.checkLiquidity(liquidityRequest);
    availableAmount *= 0.99; // 1% cap for rounding

    const minAmount = order.amountIn / 2;
    if (availableAmount < minAmount) {
      // order liquidity
      try {
        const deficitAmount = Util.round(order.amountIn - availableAmount, 8);
        const minDeficitAmount = Util.round(minAmount - availableAmount, 8);
        await this.liquidityService.buyLiquidity(order.assetIn.id, minDeficitAmount, deficitAmount, true);
      } catch (e) {
        if (!e.message?.includes(LiquidityManagementRuleStatus.PROCESSING))
          throw new Error(
            `Not enough liquidity of ${order.assetIn.uniqueName}: ${availableAmount} available, min. required ${minAmount}`,
          );
      }

      throw new WaitingForLiquidityException(`Waiting for liquidity of ${order.assetIn.uniqueName}`);
    } else {
      const adaptedAmount = Math.min(order.amountIn, availableAmount);

      order.amountExpected = Util.round((order.amountExpected * adaptedAmount) / order.amountIn, 8);
      liquidityRequest.referenceAmount = order.amountIn = adaptedAmount;
    }

    await this.dexService.reserveLiquidity(liquidityRequest);
  }

  private async closeReservation(order: TradingOrder): Promise<void> {
    await this.dexService.completeOrders(LiquidityOrderContext.TRADING, `${order.id}`);
  }

  private async purchaseLiquidity(order: TradingOrder): Promise<void> {
    const client = this.blockchainRegistryService.getEvmClient(order.assetIn.blockchain);

    order.txId = await client.swapPool(
      order.assetIn,
      order.assetOut,
      order.amountIn,
      order.tradingRule.poolFee,
      0.0000001,
    );
    await this.orderRepo.save(order);
  }

  private async checkRunningOrders(): Promise<void> {
    const runningOrders = await this.orderRepo.findBy({ status: TradingOrderStatus.IN_PROGRESS });

    for (const order of runningOrders) {
      await this.checkOrder(order);
    }
  }

  private async checkOrder(order: TradingOrder): Promise<void> {
    try {
      const client = this.blockchainRegistryService.getClient(order.assetIn.blockchain);

      const isComplete = await client.isTxComplete(order.txId);

      if (isComplete) await this.handleOrderCompletion(order);
    } catch (e) {
      await this.handleOrderFail('check', order, e);
    }
  }

  private async handleOrderCompletion(order: TradingOrder): Promise<void> {
    try {
      await this.closeReservation(order);

      const client = this.blockchainRegistryService.getEvmClient(order.assetIn.blockchain);

      const outputAmount = await client.getSwapResult(order.txId, order.assetOut);
      const txFee = await client.getTxActualFee(order.txId);
      const swapFee = order.amountIn * EvmUtil.poolFeeFactor(order.tradingRule.poolFee);

      const coin = await this.assetService.getNativeAsset(order.assetIn.blockchain);
      const coinChfPrice = await this.pricingService.getPrice(coin, this.chf, true);
      const inChfPrice = await this.pricingService.getPrice(order.assetIn, this.chf, true);
      const outChfPrice = await this.pricingService.getPrice(order.assetOut, this.chf, true);

      order.complete(
        outputAmount,
        txFee,
        coinChfPrice.convert(txFee),
        swapFee,
        inChfPrice.convert(swapFee),
        outChfPrice.convert(outputAmount, Config.defaultVolumeDecimal) -
          inChfPrice.convert(order.amountIn, Config.defaultVolumeDecimal),
      );
      await this.orderRepo.save(order);

      const rule = order.tradingRule.reactivate();
      await this.ruleRepo.save(rule);

      const message = `Trading order ${order.id} (rule ${order.tradingRule.id}) complete: swapped ${order.amountIn} ${order.assetIn.uniqueName} to ${order.assetOut.uniqueName}`;
      this.logger.verbose(message);
    } catch (e) {
      this.logger.error(`Failed to complete trading order ${order.id} (rule ${order.tradingRule.id}):`, e);
    }
  }

  private async handleOrderFail(process: string, order: TradingOrder, e: Error): Promise<void> {
    const message = `Failed to ${process} trading order ${order.id} (rule ${order.tradingRule.id}): ${e.message}`;

    await this.closeReservation(order);

    order.fail(message);
    await this.orderRepo.save(order);

    const rule = order.tradingRule.pause();
    await this.ruleRepo.save(rule);

    // send notification
    if (e instanceof WaitingForLiquidityException) {
      this.logger.warn(message, e);
    } else {
      this.logger.error(message, e);

      const mailRequest: MailRequest = {
        type: MailType.ERROR_MONITORING,
        context: MailContext.DEX,
        input: {
          subject: 'Trading order FAIL',
          errors: [message],
          isLiqMail: true,
        },
      };

      await this.notificationService.sendMail(mailRequest);
    }
  }
}
