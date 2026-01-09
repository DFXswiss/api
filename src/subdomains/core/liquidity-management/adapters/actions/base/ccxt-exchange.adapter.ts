import { InsufficientFunds, Order } from 'ccxt';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TradeChangedException } from 'src/integration/exchange/exceptions/trade-changed.exception';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { ExchangeService, OrderSide } from 'src/integration/exchange/services/exchange.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PriceValidity, PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderFailedException } from '../../../exceptions/order-failed.exception';
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
    protected readonly exchangeService: ExchangeService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly dexService: DexService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
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
    const { asset, tradeAsset, minTradeAmount, fullTrade } = this.parseBuyParams(order.action.paramMap);

    const targetAssetEntity = asset
      ? await this.assetService.getAssetByUniqueName(asset)
      : order.pipeline.rule.targetAsset;
    const tradeAssetEntity = await this.assetService.getAssetByUniqueName(`${this.exchangeService.name}/${tradeAsset}`);

    const balance = fullTrade ? 0 : await this.exchangeService.getAvailableBalance(targetAssetEntity.name);
    const minAmount = order.minAmount * 1.01 - balance; // small cap for price changes
    const maxAmount = order.maxAmount * 1.01 - balance;
    if (maxAmount <= 0) {
      // trade not necessary
      throw new OrderNotNecessaryException(
        `${targetAssetEntity.name} balance higher than required amount (${balance} > ${order.maxAmount})`,
      );
    }

    const price = await this.getAndCheckTradePrice(tradeAssetEntity, targetAssetEntity);

    const minSellAmount = minTradeAmount ?? Util.floor(minAmount * price, 6);
    const maxSellAmount = Util.floor(maxAmount * price, 6);

    const availableBalance = await this.getAvailableTradeBalance(tradeAsset, targetAssetEntity.name);
    if (minSellAmount > availableBalance)
      throw new OrderNotProcessableException(
        `${this.exchangeService.name}: not enough balance for ${tradeAsset} (balance: ${availableBalance}, min. requested: ${minSellAmount}, max. requested: ${maxSellAmount})`,
      );

    const amount = Math.min(maxSellAmount, availableBalance);

    order.inputAmount = amount;
    order.inputAsset = tradeAsset;
    order.outputAsset = targetAssetEntity.name;

    try {
      return await this.exchangeService.sell(tradeAsset, targetAssetEntity.name, amount);
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }

      if (e.message?.includes('Illegal characters found')) {
        throw new Error(
          `Invalid trade request, tried to sell ${tradeAsset} for ${amount} ${targetAssetEntity.name}: ${e.message}`,
        );
      }

      throw e;
    }
  }

  private async sell(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { tradeAsset } = this.parseSellParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    const tradeAssetEntity = await this.assetService.getAssetByUniqueName(`${this.exchangeService.name}/${tradeAsset}`);
    await this.getAndCheckTradePrice(order.pipeline.rule.targetAsset, tradeAssetEntity);

    const availableBalance = await this.getAvailableTradeBalance(asset, tradeAsset);
    if (order.minAmount > availableBalance)
      throw new OrderNotProcessableException(
        `${this.exchangeService.name}: not enough balance for ${asset} (balance: ${availableBalance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
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

  private async getAndCheckTradePrice(from: Asset, to: Asset): Promise<number> {
    const price = await this.exchangeService.getCurrentPrice(from.name, to.name);

    // price fetch should already throw error if out of range
    const checkPrice = await this.pricingService.getPrice(from, to, PriceValidity.VALID_ONLY);

    if (Math.abs((price - checkPrice.price) / checkPrice.price) > 0.05)
      throw new OrderFailedException(
        `Trade price out of range: exchange price ${price}, check price ${checkPrice.price}`,
      );

    return price;
  }

  private async getAvailableTradeBalance(from: string, to: string): Promise<number> {
    const availableBalance = await this.exchangeService.getAvailableBalance(from);

    const { direction } = await this.exchangeService.getTradePair(from, to);
    return direction === OrderSide.BUY ? availableBalance * 0.99 : availableBalance;
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
    } else if (withdrawal.status === 'failed') {
      throw new OrderFailedException(`Withdrawal TX ${withdrawal.txid} has failed`);
    }

    order.outputAmount = withdrawal.amount;

    const blockchain = paramMap.destinationBlockchain as Blockchain;
    return this.dexService.checkTransferCompletion(withdrawal.txid, blockchain);
  }

  private async checkBuyCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { asset, tradeAsset } = this.parseBuyParams(order.action.paramMap);

    const token = asset ?? order.pipeline.rule.targetAsset.dexName;

    const isComplete = await this.checkTradeCompletion(order, tradeAsset, token);
    if (isComplete) {
      const { cost, amount } = await this.aggregateTradeAmounts(order, tradeAsset, token);

      order.inputAmount = cost;
      order.outputAmount = amount;
    }

    return isComplete;
  }

  private async checkSellCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { tradeAsset } = this.parseSellParams(order.action.paramMap);

    const asset = order.pipeline.rule.targetAsset.dexName;

    const isComplete = await this.checkTradeCompletion(order, asset, tradeAsset);
    if (isComplete) {
      const { cost, amount } = await this.aggregateTradeAmounts(order, asset, tradeAsset);

      order.inputAmount = amount;
      order.outputAmount = cost;
    }

    return isComplete;
  }

  private async aggregateTradeAmounts(
    order: LiquidityManagementOrder,
    from: string,
    to: string,
  ): Promise<{ cost: number; amount: number }> {
    const correlationIds = order.allCorrelationIds;

    const tradeResults = await Promise.allSettled(
      correlationIds.map((id) => this.exchangeService.getTrade(id, from, to)),
    );

    const trades = tradeResults
      .filter((result): result is PromiseFulfilledResult<Order> => result.status === 'fulfilled')
      .map((result) => result.value);

    // log failures
    const failures = tradeResults.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      this.logger.warn(
        `Order ${order.id}: Failed to fetch ${failures.length} of ${correlationIds.length} trades. ` +
          `Proceeding with ${trades.length} successful fetches.`,
      );
    }

    if (trades.length === 0) {
      throw new OrderFailedException(`Failed to fetch any trades for order ${order.id}`);
    }

    const cost = Util.sumObjValue(trades, 'cost');
    const amount = trades.reduce((sum, trade) => sum + (trade.filled ?? trade.amount), 0);

    return { cost, amount };
  }

  private async checkTradeCompletion(order: LiquidityManagementOrder, from: string, to: string): Promise<boolean> {
    try {
      return await this.exchangeService.checkTrade(order.correlationId, from, to);
    } catch (e) {
      if (e instanceof TradeChangedException) {
        order.updateCorrelationId(e.id);
        await this.orderRepo.save(order);

        return false;
      } else if (e instanceof InsufficientFunds) {
        throw new OrderNotProcessableException(e.message);
      }

      this.logger.error(`Error checking trade completion for order ${order.id}:`, e);
      throw new OrderFailedException(e.message);
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
    } else if (withdrawal.status === 'failed') {
      throw new OrderFailedException(`Withdrawal TX ${withdrawal.txid} has failed`);
    }

    order.outputAmount = withdrawal.amount;

    const targetExchange = this.exchangeRegistry.get(target);

    const blockchain = paramMap.destinationBlockchain as Blockchain;
    const network = targetExchange.mapNetwork(blockchain);
    if (!network) throw new Error(`Target exchange ${target} does not support transfer network ${blockchain}`);

    const deposit = await targetExchange
      .getDeposits(targetAsset.dexName, order.created, network)
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
    network?: string;
    asset?: string;
  } {
    const address = process.env[params.destinationAddress as string];
    const key = this.exchangeService.config.withdrawKeys?.get(params.destinationAddressKey as string);
    const network = this.exchangeService.mapNetwork(params.destinationBlockchain as Blockchain);
    const asset = params.asset as string | undefined;

    if (!(address && key && network != null))
      throw new Error(`Params provided to CcxtExchangeAdapter.withdraw(...) command are invalid.`);

    return { address, key, network: network || undefined, asset };
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
    asset?: string;
    tradeAsset: string;
    minTradeAmount: number;
    fullTrade: boolean;
  } {
    const asset = params.asset as string | undefined;
    const tradeAsset = params.tradeAsset as string | undefined;
    const minTradeAmount = params.minTradeAmount as number | undefined;
    const fullTrade = Boolean(params.fullTrade); // use full trade for directly triggered actions

    if (!tradeAsset) throw new Error(`Params provided to CcxtExchangeAdapter.buy(...) command are invalid.`);

    return { asset, tradeAsset, minTradeAmount, fullTrade };
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
    network?: string;
    target: string;
    optimum?: number;
  } {
    const address = process.env[params.destinationAddress as string];
    const key = this.exchangeService.config.withdrawKeys?.get(params.destinationAddressKey as string);
    const network = this.exchangeService.mapNetwork(params.destinationBlockchain as Blockchain);
    const target = params.targetExchange as string;
    const optimum = params.targetOptimum as number | undefined;

    if (!(address && key && network != null && target))
      throw new Error(`Params provided to CcxtExchangeAdapter.transfer(...) command are invalid.`);

    return { address, key, network: network || undefined, target, optimum };
  }

  // --- HELPER METHODS --- //
  private isBalanceTooLowError(e: Error): boolean {
    return ['Insufficient funds', 'insufficient balance', 'Insufficient position', 'not enough balance'].some((m) =>
      e.message?.includes(m),
    );
  }
}
