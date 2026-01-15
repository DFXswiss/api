import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  ScryptOrderSide,
  ScryptOrderStatus,
  ScryptService,
  ScryptTransactionStatus,
} from 'src/integration/exchange/services/scrypt.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

export enum ScryptAdapterCommands {
  WITHDRAW = 'withdraw',
  SELL = 'sell',
}

@Injectable()
export class ScryptAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(ScryptAdapter);

  protected commands = new Map<string, Command>();

  constructor(
    private readonly scryptService: ScryptService,
    private readonly dexService: DexService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
  ) {
    super(LiquidityManagementSystem.SCRYPT);

    this.commands.set(ScryptAdapterCommands.WITHDRAW, this.withdraw.bind(this));
    this.commands.set(ScryptAdapterCommands.SELL, this.sell.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case ScryptAdapterCommands.WITHDRAW:
        return this.checkWithdrawCompletion(order);

      case ScryptAdapterCommands.SELL:
        return this.checkSellCompletion(order);

      default:
        return false;
    }
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case ScryptAdapterCommands.WITHDRAW:
        return this.validateWithdrawParams(params);

      case ScryptAdapterCommands.SELL:
        return this.validateSellParams(params);

      default:
        throw new Error(`Command ${command} not supported by ScryptAdapter`);
    }
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  private async withdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { address, asset } = this.parseWithdrawParams(order.action.paramMap);

    const token = asset ?? order.pipeline.rule.targetAsset.dexName;

    const balance = await this.scryptService.getAvailableBalance(token);
    if (order.minAmount > balance) {
      throw new OrderNotProcessableException(
        `Scrypt: not enough balance for ${token} (balance: ${balance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );
    }

    const amount = Util.floor(Math.min(order.maxAmount, balance), 6);

    order.inputAmount = amount;
    order.inputAsset = token;
    order.outputAsset = token;

    try {
      const response = await this.scryptService.withdrawFunds(token, amount, address);

      return response.id;
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }

      throw e;
    }
  }

  private async sell(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { tradeAsset } = this.parseSellParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    const availableBalance = await this.scryptService.getAvailableBalance(asset);
    const effectiveMax = Math.min(order.maxAmount, availableBalance);

    if (effectiveMax < order.minAmount) {
      throw new OrderNotProcessableException(
        `Scrypt: not enough balance for ${asset} (balance: ${availableBalance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );
    }

    const amount = Util.floor(effectiveMax, 6);

    order.inputAmount = amount;
    order.inputAsset = asset;
    order.outputAsset = tradeAsset;

    try {
      return await this.scryptService.sell(asset, tradeAsset, amount);
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }

      throw e;
    }
  }

  // --- COMPLETION CHECKS --- //

  private async checkWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { correlationId } = order;

    const withdrawal = await this.scryptService.getWithdrawalStatus(correlationId);
    if (!withdrawal?.txHash) {
      this.logger.verbose(`No withdrawal id for id ${correlationId} at ${this.scryptService.name} found`);
      return false;
    } else if ([ScryptTransactionStatus.FAILED, ScryptTransactionStatus.REJECTED].includes(withdrawal.status)) {
      const rejectMessage = withdrawal.rejectReason
        ? `${withdrawal.rejectReason} (${withdrawal.rejectText})`
        : 'unknown reason';
      throw new OrderFailedException(
        `Withdrawal ${correlationId} has failed with status ${withdrawal.status}: ${rejectMessage}`,
      );
    }

    order.outputAmount = withdrawal.amount;

    const { blockchain } = this.parseWithdrawParams(order.action.paramMap);
    return this.dexService.checkTransferCompletion(withdrawal.txHash, blockchain);
  }

  private async checkSellCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { correlationId } = order;
    const { tradeAsset } = this.parseSellParams(order.action.paramMap);
    const asset = order.pipeline.rule.targetAsset.dexName;
    const symbol = `${asset}/${tradeAsset}`;

    const orderInfo = await this.scryptService.getOrderStatus(correlationId);
    if (!orderInfo) {
      this.logger.verbose(`No order info for id ${correlationId} at ${this.scryptService.name} found`);
      return false;
    }

    switch (orderInfo.status) {
      case ScryptOrderStatus.NEW:
      case ScryptOrderStatus.PARTIALLY_FILLED: {
        // Price tracking like Binance - update price if changed
        const currentPrice = await this.scryptService.getCurrentPrice(symbol, ScryptOrderSide.SELL);

        if (orderInfo.price && currentPrice !== orderInfo.price) {
          this.logger.verbose(
            `Order ${correlationId}: price changed ${orderInfo.price} -> ${currentPrice}, updating order`,
          );

          try {
            const newId = await this.scryptService.editOrder(
              correlationId,
              symbol,
              orderInfo.remainingQuantity,
              currentPrice,
            );
            order.updateCorrelationId(newId);
            await this.orderRepo.save(order);
            this.logger.verbose(`Order ${correlationId} updated to ${newId} with new price ${currentPrice}`);
          } catch (e) {
            // If edit fails, try to cancel and let it restart
            this.logger.verbose(`Could not update order ${correlationId}, attempting cancel: ${e.message}`);
            try {
              await this.scryptService.cancelOrder(correlationId, symbol);
            } catch (cancelError) {
              this.logger.verbose(`Cancel also failed: ${cancelError.message}`);
            }
          }
        } else {
          this.logger.verbose(`Order ${correlationId} open, price is still ${currentPrice}`);
        }
        return false;
      }

      case ScryptOrderStatus.CANCELLED: {
        const minAmount = await this.scryptService.getMinTradeAmount(symbol);
        const remaining = orderInfo.remainingQuantity;

        // If remaining amount is below minimum, consider complete
        if (remaining < minAmount) {
          this.logger.verbose(
            `Order ${correlationId} cancelled with remaining ${remaining} < minAmount ${minAmount}, marking complete`,
          );
          order.outputAmount = await this.aggregateSellOutput(order);
          return true;
        }

        // Restart order with remaining amount (like Binance)
        this.logger.verbose(`Order ${correlationId} cancelled, restarting with remaining ${remaining} ${asset}`);

        try {
          const newId = await this.scryptService.sell(asset, tradeAsset, remaining);
          order.updateCorrelationId(newId);
          await this.orderRepo.save(order);
          this.logger.verbose(`Order ${correlationId} restarted as ${newId}`);
          return false;
        } catch (e) {
          throw new OrderFailedException(`Order ${correlationId} cancelled and restart failed: ${e.message}`);
        }
      }

      case ScryptOrderStatus.FILLED: {
        // Aggregate output from all correlation IDs (in case of restarts)
        order.outputAmount = await this.aggregateSellOutput(order);
        return true;
      }

      case ScryptOrderStatus.REJECTED:
        throw new OrderFailedException(
          `Order ${correlationId} has been rejected: ${orderInfo.rejectReason ?? 'unknown reason'}`,
        );

      default:
        return false;
    }
  }

  private async aggregateSellOutput(order: LiquidityManagementOrder): Promise<number> {
    const correlationIds = order.allCorrelationIds;

    // Fetch all orders in parallel like Binance
    const orderResults = await Promise.allSettled(
      correlationIds.map((id) => this.scryptService.getOrderStatus(id)),
    );

    const orders = orderResults
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof this.scryptService.getOrderStatus>>> =>
        result.status === 'fulfilled' && result.value !== null)
      .map((result) => result.value!);

    // Log failures
    const failures = orderResults.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      this.logger.warn(
        `Order ${order.id}: Failed to fetch ${failures.length} of ${correlationIds.length} orders. ` +
          `Proceeding with ${orders.length} successful fetches.`,
      );
    }

    if (orders.length === 0) {
      throw new OrderFailedException(`Failed to fetch any orders for order ${order.id}`);
    }

    // For SELL: output is the proceeds (filledQuantity * avgPrice)
    return orders.reduce((sum, o) => {
      if (o.filledQuantity > 0) {
        const output = o.avgPrice ? o.filledQuantity * o.avgPrice : o.filledQuantity;
        return sum + output;
      }
      return sum;
    }, 0);
  }

  // --- PARAM VALIDATION --- //

  private validateWithdrawParams(params: Record<string, unknown>): boolean {
    try {
      this.parseWithdrawParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseWithdrawParams(params: Record<string, unknown>): {
    address: string;
    asset?: string;
    blockchain: Blockchain;
  } {
    const address = process.env[params.destinationAddress as string];
    const asset = params.asset as string | undefined;
    const blockchain = params.destinationBlockchain as Blockchain | undefined;

    if (!address || !blockchain) {
      throw new Error(`Params provided to ScryptAdapter.withdraw(...) command are invalid.`);
    }

    return { address, asset, blockchain };
  }

  private validateSellParams(params: Record<string, unknown>): boolean {
    try {
      this.parseSellParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseSellParams(params: Record<string, unknown>): {
    tradeAsset: string;
  } {
    const tradeAsset = params.tradeAsset as string | undefined;

    if (!tradeAsset) {
      throw new Error(`Params provided to ScryptAdapter.sell(...) command are invalid.`);
    }

    return { tradeAsset };
  }

  // --- HELPER METHODS --- //

  private isBalanceTooLowError(_e: Error): boolean {
    return false; // TODO: implement specific error check for Scrypt
  }
}
