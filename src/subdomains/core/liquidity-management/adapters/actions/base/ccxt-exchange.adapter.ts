import { InsufficientFunds } from 'ccxt';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TradeChangedException } from 'src/integration/exchange/exceptions/trade-changed.exception';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { ExchangeService } from 'src/integration/exchange/services/exchange.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderNotNecessaryException } from '../../../exceptions/order-not-necessary.exception';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../../interfaces';
import { LiquidityManagementOrderRepository } from '../../../repositories/liquidity-management-order.repository';
import { LiquidityActionAdapter } from './liquidity-action.adapter';

/**
 * @note
 * commands should be lower-case
 */
export enum CcxtExchangeAdapterCommands {
  WITHDRAW = 'withdraw',
  BUY = 'buy',
  SELL = 'sell',
  TRANSFER = 'transfer',
}

export abstract class CcxtExchangeAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(CcxtExchangeAdapter);

  protected commands = new Map<string, Command>();

  constructor(
    system: LiquidityManagementSystem,
    private readonly exchangeService: ExchangeService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly dexService: DexService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
  ) {
    super(system);

    this.commands.set(CcxtExchangeAdapterCommands.WITHDRAW, this.withdraw.bind(this));
    this.commands.set(CcxtExchangeAdapterCommands.BUY, this.buy.bind(this));
    this.commands.set(CcxtExchangeAdapterCommands.SELL, this.sell.bind(this));
    this.commands.set(CcxtExchangeAdapterCommands.TRANSFER, this.transfer.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case CcxtExchangeAdapterCommands.WITHDRAW:
        return this.checkWithdrawCompletion(order);

      case CcxtExchangeAdapterCommands.BUY:
        return this.checkBuyCompletion(order);

      case CcxtExchangeAdapterCommands.SELL:
        return this.checkSellCompletion(order);

      case CcxtExchangeAdapterCommands.TRANSFER:
        return this.checkTransferCompletion(order);

      default:
        return false;
    }
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case CcxtExchangeAdapterCommands.WITHDRAW:
        return this.validateWithdrawParams(params);

      case CcxtExchangeAdapterCommands.BUY:
        return this.validateBuyParams(params);

      case CcxtExchangeAdapterCommands.SELL:
        return this.validateSellParams(params);

      case CcxtExchangeAdapterCommands.TRANSFER:
        return this.validateTransferParams(params);

      default:
        throw new Error(`Command ${command} not supported by CcxtExchangeAdapter`);
    }
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  private async withdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { address, key, network, asset } = this.parseWithdrawParams(order.action.paramMap);

    const token = asset ?? order.pipeline.rule.targetAsset.dexName;

    const balance = await this.exchangeService.getAvailableBalance(token);
    if (order.minAmount > balance)
      throw new OrderNotProcessableException(
        `${this.exchangeService.name}: not enough balance for ${token} (balance: ${balance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );

    const amount = Util.floor(Math.min(order.maxAmount, balance), 6);

    order.inputAmount = amount;
    order.inputAsset = token;
    order.outputAsset = token;

    try {
      const response = await this.exchangeService.withdrawFunds(token, amount, address, key, network);

      return response.id;
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }

      throw e;
    }
  }

  private async buy(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { tradeAsset, minTradeAmount, fullTrade } = this.parseBuyParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    const balance = fullTrade ? 0 : await this.exchangeService.getAvailableBalance(asset);
    const minAmount = order.minAmount * 1.01 - balance; // small cap for price changes
    const maxAmount = order.maxAmount * 1.01 - balance;
    if (maxAmount <= 0) {
      // trade not necessary
      throw new OrderNotNecessaryException(
        `${asset} balance higher than required amount (${balance} > ${order.maxAmount})`,
      );
    }

    const price = await this.exchangeService.getCurrentPrice(tradeAsset, asset);

    const minSellAmount = minTradeAmount ?? Util.floor(minAmount * price, 6);
    const maxSellAmount = Util.floor(maxAmount * price, 6);

    const availableBalance = await this.exchangeService.getAvailableBalance(tradeAsset);
    if (minSellAmount > availableBalance)
      throw new OrderNotProcessableException(
        `${this.exchangeService.name}: not enough balance for ${tradeAsset} (balance: ${availableBalance}, min. requested: ${minSellAmount}, max. requested: ${maxSellAmount})`,
      );

    const amount = Math.min(maxSellAmount, availableBalance);

    order.inputAmount = amount;
    order.inputAsset = tradeAsset;
    order.outputAsset = asset;

    try {
      return await this.exchangeService.sell(tradeAsset, asset, amount);
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }

      if (e.message?.includes('Illegal characters found')) {
        throw new Error(`Invalid trade request, tried to sell ${tradeAsset} for ${amount} ${asset}: ${e.message}`);
      }

      throw e;
    }
  }

  private async sell(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { tradeAsset } = this.parseSellParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    const availableBalance = await this.exchangeService.getAvailableBalance(asset);
    if (order.minAmount > availableBalance)
      throw new OrderNotProcessableException(
        `${this.exchangeService.name}: not enough balance for ${tradeAsset} (balance: ${availableBalance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );

    const amount = Math.min(order.maxAmount, availableBalance);

    order.inputAmount = amount;
    order.inputAsset = asset;
    order.outputAsset = tradeAsset;

    try {
      return await this.exchangeService.sell(asset, tradeAsset, amount);
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }

      if (e.message?.includes('Illegal characters found')) {
        throw new Error(`Invalid trade request, tried to sell ${amount} ${asset} for ${tradeAsset}: ${e.message}`);
      }

      throw e;
    }
  }

  private async transfer(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { address, key, network, optimum } = this.parseTransferParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    const minAmount = Util.floor(order.minAmount, 6);
    const maxAmount = Util.floor(order.maxAmount + (optimum ?? 0), 6);

    const sourceBalance = await this.exchangeService.getAvailableBalance(asset);
    if (minAmount > sourceBalance)
      throw new OrderNotProcessableException(
        `${this.exchangeService.name}: not enough balance for ${asset} (balance: ${sourceBalance}, min. requested: ${minAmount}, max. requested: ${maxAmount})`,
      );

    const amount = Util.floor(Math.min(maxAmount, sourceBalance), 6);

    order.inputAmount = amount;
    order.inputAsset = asset;
    order.outputAsset = asset;

    try {
      const response = await this.exchangeService.withdrawFunds(asset, amount, address, key, network);

      return response.id;
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }

      throw e;
    }
  }

  // --- COMPLETION CHECKS --- //
  private async checkWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { targetAsset },
      },
      action: { paramMap },
      correlationId,
    } = order;

    const { asset } = this.parseWithdrawParams(paramMap);

    const token = asset ?? targetAsset.dexName;

    const withdrawal = await this.exchangeService.getWithdraw(correlationId, token);
    if (!withdrawal?.txid) {
      this.logger.verbose(
        `No withdrawal id for id ${correlationId} and asset ${token} at ${this.exchangeService.name} found`,
      );
      return false;
    }

    order.outputAmount = withdrawal.amount;

    const blockchain = paramMap.destinationBlockchain as Blockchain;
    return this.dexService.checkTransferCompletion(withdrawal.txid, blockchain);
  }

  private async checkBuyCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { tradeAsset } = this.parseBuyParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    const isComplete = await this.checkTradeCompletion(order, tradeAsset, asset);
    if (isComplete) {
      const trade = await this.exchangeService.getTrade(order.correlationId, tradeAsset, asset);

      order.inputAmount = trade.cost;
      order.outputAmount = trade.amount;
    }

    return isComplete;
  }

  private async checkSellCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { tradeAsset } = this.parseSellParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    const isComplete = await this.checkTradeCompletion(order, asset, tradeAsset);
    if (isComplete) {
      const trade = await this.exchangeService.getTrade(order.correlationId, asset, tradeAsset);

      order.inputAmount = trade.amount;
      order.outputAmount = trade.cost;
    }

    return isComplete;
  }

  private async checkTradeCompletion(order: LiquidityManagementOrder, from: string, to: string): Promise<boolean> {
    try {
      return await this.exchangeService.checkTrade(order.correlationId, from, to);
    } catch (e) {
      if (e instanceof TradeChangedException) {
        order.correlationId = e.id;
        await this.orderRepo.save(order);

        return false;
      } else if (e instanceof InsufficientFunds) {
        throw new OrderNotProcessableException(e.message);
      }

      throw e;
    }
  }

  private async checkTransferCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { targetAsset },
      },
      action: { paramMap },
      correlationId,
    } = order;

    const { target } = this.parseTransferParams(paramMap);

    const withdrawal = await this.exchangeService.getWithdraw(correlationId, targetAsset.dexName);
    if (!withdrawal?.txid) {
      this.logger.verbose(
        `No withdrawal id for id ${correlationId} and asset ${targetAsset.dexName} at ${this.exchangeService.name} found`,
      );
      return false;
    }

    order.outputAmount = withdrawal.amount;

    const targetExchange = this.exchangeRegistry.get(target);

    const deposit = await targetExchange
      .getDeposits(targetAsset.dexName, order.created)
      .then((deposits) => deposits.find((d) => d.txid === withdrawal.txid));

    return deposit && deposit.status === 'ok';
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
    key: string;
    network: string;
    asset?: string;
  } {
    const address = process.env[params.destinationAddress as string];
    const key = this.exchangeService.config.withdrawKeys?.get(params.destinationAddressKey as string);
    const network = this.exchangeService.mapNetwork(params.destinationBlockchain as Blockchain);
    const asset = params.asset as string | undefined;

    if (!(address && key && network))
      throw new Error(`Params provided to CcxtExchangeAdapter.withdraw(...) command are invalid.`);

    return { address, key, network, asset };
  }

  private validateBuyParams(params: Record<string, unknown>): boolean {
    try {
      this.parseBuyParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseBuyParams(params: Record<string, unknown>): {
    tradeAsset: string;
    minTradeAmount: number;
    fullTrade: boolean;
  } {
    const tradeAsset = params.tradeAsset as string | undefined;
    const minTradeAmount = params.minTradeAmount as number | undefined;
    const fullTrade = Boolean(params.fullTrade);

    if (!tradeAsset) throw new Error(`Params provided to CcxtExchangeAdapter.buy(...) command are invalid.`);

    return { tradeAsset, minTradeAmount, fullTrade };
  }

  private validateSellParams(params: Record<string, unknown>): boolean {
    try {
      this.parseSellParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseSellParams(params: Record<string, unknown>): { tradeAsset: string } {
    const tradeAsset = params.tradeAsset as string | undefined;

    if (!tradeAsset) throw new Error(`Params provided to CcxtExchangeAdapter.sell(...) command are invalid.`);

    return { tradeAsset };
  }

  private validateTransferParams(params: Record<string, unknown>): boolean {
    try {
      this.parseTransferParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseTransferParams(params: Record<string, unknown>): {
    address: string;
    key: string;
    network: string;
    target: string;
    optimum?: number;
  } {
    const address = process.env[params.destinationAddress as string];
    const key = this.exchangeService.config.withdrawKeys?.get(params.destinationAddressKey as string);
    const network = this.exchangeService.mapNetwork(params.destinationBlockchain as Blockchain);
    const target = params.targetExchange as string;
    const optimum = params.targetOptimum as number | undefined;

    if (!(address && key && network && target))
      throw new Error(`Params provided to CcxtExchangeAdapter.transfer(...) command are invalid.`);

    return { address, key, network, target, optimum };
  }

  // --- HELPER METHODS --- //
  private isBalanceTooLowError(e: Error): boolean {
    return ['Insufficient funds', 'insufficient balance', 'not enough balance'].some((m) => e.message?.includes(m));
  }
}
