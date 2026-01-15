import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
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

    const orderInfo = await this.scryptService.getOrderStatus(correlationId);
    if (!orderInfo) {
      this.logger.verbose(`No order info for id ${correlationId} at ${this.scryptService.name} found`);
      return false;
    }

    if ([ScryptOrderStatus.CANCELED, ScryptOrderStatus.REJECTED].includes(orderInfo.status)) {
      throw new OrderFailedException(
        `Order ${correlationId} has failed with status ${orderInfo.status}: ${orderInfo.rejectReason ?? 'unknown reason'}`,
      );
    }

    if (orderInfo.status === ScryptOrderStatus.FILLED) {
      order.outputAmount = orderInfo.filledQuantity;
      return true;
    }

    return false;
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
