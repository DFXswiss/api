import { Inject, Injectable } from '@nestjs/common';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
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
export class TradingOrderService {
  private readonly logger = new DfxLogger(TradingOrderService);

  @Inject() private readonly ruleRepo: TradingRuleRepository;
  @Inject() private readonly orderRepo: TradingOrderRepository;

  constructor(
    private readonly dexService: DexService,
    private readonly notificationService: NotificationService,
    private readonly evmRegistryService: EvmRegistryService,
    private readonly liquidityService: LiquidityManagementService,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly assetService: AssetService,
  ) {}

  // --- PUBLIC API --- //

  async processOrders() {
    await this.startNewOrders();
    await this.checkRunningOrders();
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
        await this.liquidityService.buyLiquidity(order.assetIn.id, deficitAmount, true);
      } catch (e) {
        if (!e.message?.includes(LiquidityManagementRuleStatus.PROCESSING))
          throw new Error(
            `Not enough liquidity of ${order.assetIn.uniqueName}: ${availableAmount} available, min. required ${minAmount}`,
          );
      }

      throw new WaitingForLiquidityException(`Waiting for liquidity of ${order.assetIn.uniqueName}`);
    } else {
      liquidityRequest.referenceAmount = order.amountIn = Math.min(order.amountIn, availableAmount);
    }

    await this.dexService.reserveLiquidity(liquidityRequest);
  }

  private async closeReservation(order: TradingOrder): Promise<void> {
    await this.dexService.completeOrders(LiquidityOrderContext.TRADING, `${order.id}`);
  }

  private async purchaseLiquidity(order: TradingOrder): Promise<void> {
    const client = this.evmRegistryService.getClient(order.assetIn.blockchain);

    order.txId = await client.swapPool(
      order.assetIn,
      order.assetOut,
      order.amountIn,
      order.tradingRule.poolFee,
      0.0001,
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
      const client = this.evmRegistryService.getClient(order.assetIn.blockchain);

      const isComplete = await client.isTxComplete(order.txId);

      if (isComplete) await this.handleOrderCompletion(order);
    } catch (e) {
      await this.handleOrderFail('check', order, e);
    }
  }

  private async handleOrderCompletion(order: TradingOrder): Promise<void> {
    await this.closeReservation(order);

    const client = this.evmRegistryService.getClient(order.assetIn.blockchain);
    const outputAmount = await client.getSwapResult(order.txId, order.assetOut);
    const fee = await client.getTxActualFee(order.txId);

    const chf = await this.fiatService.getFiatByName('CHF');
    const coin = await this.assetService.getNativeAsset(order.assetIn.blockchain);
    const chfPrice = await this.pricingService.getPrice(coin, chf, true);

    order.complete(outputAmount, fee, chfPrice.convert(fee));
    await this.orderRepo.save(order);

    const rule = order.tradingRule.reactivate();
    await this.ruleRepo.save(rule);

    const message = `Trading order ${order.id} (rule ${order.tradingRule.id}) complete: swapped ${order.amountIn} ${order.assetIn.uniqueName} to ${order.assetOut.uniqueName}`;
    this.logger.verbose(message);

    // send mail
    const mailRequest: MailRequest = {
      type: MailType.ERROR_MONITORING,
      context: MailContext.DEX,
      input: {
        subject: 'Trading order SUCCESS',
        errors: [message],
        isLiqMail: true,
      },
    };

    await this.notificationService.sendMail(mailRequest);
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
