import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TradeChangedException } from 'src/integration/exchange/exceptions/trade-changed.exception';
import { ExchangeService } from 'src/integration/exchange/services/exchange.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../../interfaces';
import { LiquidityManagementOrderRepository } from '../../../repositories/liquidity-management-order.repository';
import { LiquidityManagementAdapter } from './liquidity-management.adapter';

export interface CcxtExchangeWithdrawParams {
  destinationBlockchain: Blockchain;
  destinationAddress: string;
  destinationAddressKey: string;
}

export interface CcxtExchangeTradeParams {
  tradeAsset: string;
}

/**
 * @note
 * commands should be lower-case
 */
export enum CcxtExchangeAdapterCommands {
  WITHDRAW = 'withdraw',
  TRADE = 'trade',
}

export abstract class CcxtExchangeAdapter extends LiquidityManagementAdapter {
  private readonly logger = new DfxLogger(CcxtExchangeAdapter);

  protected commands = new Map<string, Command>();

  constructor(
    system: LiquidityManagementSystem,
    private readonly exchangeService: ExchangeService,
    private readonly dexService: DexService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
  ) {
    super(system);

    this.commands.set(CcxtExchangeAdapterCommands.WITHDRAW, this.withdraw.bind(this));
    this.commands.set(CcxtExchangeAdapterCommands.TRADE, this.trade.bind(this));
  }

  protected abstract mapBlockchainToCcxtNetwork(blockchain: Blockchain): string;

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case CcxtExchangeAdapterCommands.WITHDRAW:
        return this.checkWithdrawCompletion(order);

      case CcxtExchangeAdapterCommands.TRADE:
        return this.checkTradeCompletion(order);

      default:
        return false;
    }
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case CcxtExchangeAdapterCommands.WITHDRAW:
        return this.validateWithdrawParams(params);

      case CcxtExchangeAdapterCommands.TRADE:
        return this.validateTradeParams(params);

      default:
        throw new Error(`Command ${command} not supported by CcxtExchangeAdapter`);
    }
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  private async withdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { address, key, network } = this.parseWithdrawParams(order.action.paramMap);

    const token = order.pipeline.rule.targetAsset.dexName;

    const balance = await this.exchangeService.getBalance(token);
    if (order.amount > balance)
      throw new OrderNotProcessableException(`Not enough balance of ${token} (${order.amount} > ${balance})`);

    try {
      const response = await this.exchangeService.withdrawFunds(token, order.amount, address, key, network);

      return response.id;
    } catch (e) {
      if (['Insufficient funds', 'insufficient balance'].some((m) => e.message?.includes(m))) {
        throw new OrderNotProcessableException(e.message);
      }

      throw e;
    }
  }

  private async trade(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { tradeAsset } = this.parseTradeParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    const balance = await this.exchangeService.getBalance(asset);

    try {
      // small cap for price changes
      return await this.exchangeService.buy(tradeAsset, asset, order.amount * 1.01 - balance);
    } catch (e) {
      if (e.message?.includes('not enough balance')) {
        throw new OrderNotProcessableException(e.message);
      }

      throw e;
    }
  }

  // --- COMPLETION CHECKS --- //
  private async checkWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { targetAsset: asset },
      },
      action: { paramMap },
      correlationId,
    } = order;

    const withdrawal = await this.exchangeService.getWithdraw(correlationId, asset.dexName);
    if (!withdrawal?.txid) {
      this.logger.verbose(
        `No withdrawal id for id ${correlationId} and asset ${asset.uniqueName} at ${this.exchangeService.name} found`,
      );
      return false;
    }

    const blockchain = paramMap.destinationBlockchain as Blockchain;

    return this.dexService.checkTransferCompletion(withdrawal.txid, blockchain);
  }

  private async checkTradeCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { tradeAsset } = this.parseTradeParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    try {
      return await this.exchangeService.checkTrade(order.correlationId, tradeAsset, asset);
    } catch (e) {
      if (e instanceof TradeChangedException) {
        order.correlationId = e.id;
        await this.orderRepo.save(order);

        return false;
      }

      throw e;
    }
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

  private parseWithdrawParams(params: Record<string, unknown>): { address: string; key: string; network: string } {
    const address = process.env[params.destinationAddress as string];
    const key = process.env[params.destinationAddressKey as string];
    const network = this.mapBlockchainToCcxtNetwork(params.destinationBlockchain as Blockchain);

    if (!(address && key && network))
      throw new Error(`Params provided to CcxtExchangeAdapter.withdraw(...) command are invalid.`);

    return { address, key, network };
  }

  private validateTradeParams(params: Record<string, unknown>): boolean {
    try {
      this.parseTradeParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseTradeParams(params: Record<string, unknown>): { tradeAsset: string } {
    const tradeAsset = params.tradeAsset as string;

    if (!tradeAsset) throw new Error(`Params provided to CcxtExchangeAdapter.trade(...) command are invalid.`);

    return { tradeAsset };
  }
}
