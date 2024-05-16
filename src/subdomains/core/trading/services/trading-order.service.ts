import { Inject, Injectable } from '@nestjs/common';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { TradingOrder } from '../entities/trading-order.entity';
import { TradingOrderStatus } from '../enums';
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
      const message = `Failed to execute trading order ${order.id} (rule ${order.tradingRule.id}): ${e.message}`;
      await this.handleOrderFail(order, message);
      this.logger.error(message, e);
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
      throw new Error(
        `Not enough liquidity of ${order.assetIn.uniqueName}: ${availableAmount} available, min. required ${minAmount}`,
      );
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

    order.txId = await client.swapPool(order.assetIn, order.assetOut, order.amountIn, order.tradingRule.poolFee, 0.2);
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
      const message = `Failed to check trading order ${order.id} (rule ${order.tradingRule.id}): ${e.message}`;
      await this.handleOrderFail(order, message);
      this.logger.error(message, e);
    }
  }

  private async handleOrderCompletion(order: TradingOrder): Promise<void> {
    await this.closeReservation(order);

    const client = this.evmRegistryService.getClient(order.assetIn.blockchain);
    const outputAmount = await client.getSwapResult(order.txId, order.assetOut);

    order.complete(outputAmount);
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

  private async handleOrderFail(order: TradingOrder, message: string): Promise<void> {
    await this.closeReservation(order);

    order.fail(message);
    await this.orderRepo.save(order);

    const rule = order.tradingRule.pause();
    await this.ruleRepo.save(rule);

    // send mail
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
