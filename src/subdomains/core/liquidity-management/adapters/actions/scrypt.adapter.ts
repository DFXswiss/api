import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScryptOrderInfo, ScryptOrderSide, ScryptTransactionStatus } from 'src/integration/exchange/dto/scrypt.dto';
import { TradeChangedException } from 'src/integration/exchange/exceptions/trade-changed.exception';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityBalanceRepository } from '../../repositories/liquidity-balance.repository';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { LiquidityManagementRuleRepository } from '../../repositories/liquidity-management-rule.repository';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

export enum ScryptAdapterCommands {
  WITHDRAW = 'withdraw',
  SELL = 'sell',
  BUY = 'buy',
  SELL_IF_DEFICIT = 'sell-if-deficit',
}

@Injectable()
export class ScryptAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(ScryptAdapter);

  protected commands = new Map<string, Command>();

  constructor(
    private readonly scryptService: ScryptService,
    private readonly dexService: DexService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly balanceRepo: LiquidityBalanceRepository,
    @Inject(forwardRef(() => BuyCryptoService)) private readonly buyCryptoService: BuyCryptoService,
  ) {
    super(LiquidityManagementSystem.SCRYPT);

    this.commands.set(ScryptAdapterCommands.WITHDRAW, this.withdraw.bind(this));
    this.commands.set(ScryptAdapterCommands.SELL, this.sell.bind(this));
    this.commands.set(ScryptAdapterCommands.BUY, this.buy.bind(this));
    this.commands.set(ScryptAdapterCommands.SELL_IF_DEFICIT, this.sellIfDeficit.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case ScryptAdapterCommands.WITHDRAW:
        return this.checkWithdrawCompletion(order);

      case ScryptAdapterCommands.SELL:
        return this.checkSellCompletion(order);

      case ScryptAdapterCommands.BUY:
        return this.checkBuyCompletion(order);

      case ScryptAdapterCommands.SELL_IF_DEFICIT:
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
      case ScryptAdapterCommands.BUY:
        return this.validateTradeParams(params);

      case ScryptAdapterCommands.SELL_IF_DEFICIT:
        return this.validateSellIfDeficitParams(params);

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
    const { tradeAsset, maxPriceDeviation } = this.parseTradeParams(order.action.paramMap);

    const targetAsset = order.pipeline.rule.targetAsset;
    const tradeAssetEntity = await this.assetService.getAssetByUniqueName(`Scrypt/${tradeAsset}`);

    await this.getAndCheckTradePrice(targetAsset, tradeAssetEntity, maxPriceDeviation);

    const availableBalance = await this.scryptService.getAvailableBalance(targetAsset.dexName);
    const effectiveMax = Math.min(order.maxAmount, availableBalance);

    if (effectiveMax < order.minAmount) {
      throw new OrderNotProcessableException(
        `Scrypt: not enough balance for ${targetAsset.dexName} (balance: ${availableBalance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );
    }

    const amount = Util.floor(effectiveMax, 6);

    return this.executeSell(order, amount, targetAsset.dexName, tradeAsset);
  }

  private async buy(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { tradeAsset, maxPriceDeviation } = this.parseTradeParams(order.action.paramMap);

    const targetAssetEntity = order.pipeline.rule.targetAsset;
    const tradeAssetEntity = await this.assetService.getAssetByUniqueName(`Scrypt/${tradeAsset}`);

    const price = await this.getAndCheckTradePrice(tradeAssetEntity, targetAssetEntity, maxPriceDeviation);
    const minSellAmount = Util.floor(order.minAmount * price, 6);
    const maxSellAmount = Util.floor(order.maxAmount * price, 6);

    const availableBalance = await this.getAvailableTradeBalance(tradeAsset, targetAssetEntity.dexName);
    const effectiveMax = Math.min(maxSellAmount, availableBalance);

    if (effectiveMax < minSellAmount) {
      throw new OrderNotProcessableException(
        `Scrypt: not enough balance for ${tradeAsset} (balance: ${availableBalance}, min. requested: ${minSellAmount}, max. requested: ${maxSellAmount})`,
      );
    }

    const amount = Util.floor(effectiveMax, 6);

    order.inputAmount = amount;
    order.inputAsset = tradeAsset;
    order.outputAsset = targetAssetEntity.dexName;

    try {
      return await this.scryptService.sell(tradeAsset, targetAssetEntity.dexName, amount);
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }

      throw e;
    }
  }

  private async sellIfDeficit(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { tradeAsset, checkAssetId, maxPriceDeviation } = this.parseSellIfDeficitParams(order.action.paramMap);

    // Check if the referenced asset has a deficit or pending liquidity demand
    const checkRule = await this.ruleRepo.findOneBy({ targetAsset: { id: checkAssetId } });
    if (!checkRule) {
      throw new OrderNotProcessableException(`No rule found for asset ${checkAssetId}`);
    }

    const checkAsset = checkRule.targetAsset;
    const checkBalance = await this.balanceRepo.findOneBy({ asset: { id: checkAssetId } });

    // Convert pending demand from CHF to check asset
    const pendingDemandChf = await this.buyCryptoService.getPendingLiquidityDemandChf(checkAssetId);
    const chfPrice = await this.pricingService.getPrice(PriceCurrency.CHF, checkAsset, PriceValidity.VALID_ONLY);
    const pendingDemand = chfPrice.convert(pendingDemandChf, 8);

    const effectiveBalance = (checkBalance?.amount ?? 0) - pendingDemand;
    const hasDeficit = effectiveBalance < (checkRule.minimal ?? 0);

    if (!hasDeficit) {
      throw new OrderNotProcessableException(
        `No deficit for asset ${checkAssetId} (balance: ${checkBalance?.amount}, pending: ${pendingDemand}, effective: ${effectiveBalance}, minimal: ${checkRule.minimal})`,
      );
    }

    // Calculate how much of the trade asset is needed to reach optimal (accounting for pending demand)
    const deficitAmount = (checkRule.optimal ?? 0) - effectiveBalance;
    if (deficitAmount <= 0) {
      throw new OrderNotProcessableException(`No deficit to optimal for asset ${checkAssetId}`);
    }

    const targetAsset = order.pipeline.rule.targetAsset;
    const tradeAssetEntity = await this.assetService.getAssetByUniqueName(`Scrypt/${tradeAsset}`);

    const price = await this.getAndCheckTradePrice(targetAsset, tradeAssetEntity, maxPriceDeviation);
    const availableBalance = await this.scryptService.getAvailableBalance(targetAsset.dexName);

    // price = targetAsset per tradeAsset (e.g., EUR per BTC)
    const sellAmount = Util.floor(deficitAmount * price, 6);
    const amount = Util.floor(Math.min(sellAmount, order.maxAmount, availableBalance), 6);

    if (amount <= 0) {
      throw new OrderNotProcessableException(
        `Scrypt: insufficient amount for sell-if-deficit (needed: ${sellAmount}, available: ${availableBalance})`,
      );
    }

    return this.executeSell(order, amount, targetAsset.dexName, tradeAsset);
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
    const { tradeAsset } = this.parseTradeParams(order.action.paramMap);
    const asset = order.pipeline.rule.targetAsset.dexName;

    return this.checkTradeCompletion(order, asset, tradeAsset);
  }

  private async checkBuyCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { tradeAsset } = this.parseTradeParams(order.action.paramMap);
    const asset = order.pipeline.rule.targetAsset.dexName;

    return this.checkTradeCompletion(order, tradeAsset, asset);
  }

  private async checkTradeCompletion(order: LiquidityManagementOrder, from: string, to: string): Promise<boolean> {
    try {
      const isComplete = await this.scryptService.checkTrade(order.correlationId, from, to);

      if (isComplete) {
        order.outputAmount = await this.aggregateTradeOutput(order);
      }

      return isComplete;
    } catch (e) {
      if (e instanceof TradeChangedException) {
        order.updateCorrelationId(e.id);
        await this.orderRepo.save(order);
        return false;
      }

      throw new OrderFailedException(e.message);
    }
  }

  private async aggregateTradeOutput(order: LiquidityManagementOrder): Promise<number> {
    const correlationIds = order.allCorrelationIds;

    // Fetch all orders in parallel
    const orderResults = await Promise.allSettled(correlationIds.map((id) => this.scryptService.getOrderStatus(id)));

    const orders = orderResults
      .filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof this.scryptService.getOrderStatus>>> =>
          result.status === 'fulfilled' && result.value !== null,
      )
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

    return orders.reduce((sum, o) => sum + this.calculateOrderOutput(o), 0);
  }

  private calculateOrderOutput(order: ScryptOrderInfo): number {
    if (order.filledQuantity <= 0) return 0;

    if (order.side === ScryptOrderSide.BUY) {
      // BUY: output is base currency = filledQuantity
      return order.filledQuantity;
    } else {
      // SELL: output is quote currency = filledQuantity * avgPrice
      return order.avgPrice ? order.filledQuantity * order.avgPrice : order.filledQuantity;
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

  private validateTradeParams(params: Record<string, unknown>): boolean {
    try {
      this.parseTradeParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseTradeParams(params: Record<string, unknown>): {
    tradeAsset: string;
    maxPriceDeviation?: number;
  } {
    const tradeAsset = params.tradeAsset as string | undefined;
    const maxPriceDeviation = params.maxPriceDeviation as number | undefined;

    if (!tradeAsset) {
      throw new Error(`Params provided to ScryptAdapter trade command are invalid.`);
    }

    return { tradeAsset, maxPriceDeviation };
  }

  private validateSellIfDeficitParams(params: Record<string, unknown>): boolean {
    try {
      this.parseSellIfDeficitParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseSellIfDeficitParams(params: Record<string, unknown>): {
    tradeAsset: string;
    checkAssetId: number;
    maxPriceDeviation?: number;
  } {
    const { tradeAsset, maxPriceDeviation } = this.parseTradeParams(params);
    const checkAssetId = params.checkAssetId as number | undefined;

    if (!checkAssetId) {
      throw new Error('Params provided to ScryptAdapter sell-if-deficit command are missing checkAssetId.');
    }

    return { tradeAsset, checkAssetId, maxPriceDeviation };
  }

  // --- HELPER METHODS --- //

  private async executeSell(
    order: LiquidityManagementOrder,
    amount: number,
    fromAsset: string,
    toAsset: string,
  ): Promise<CorrelationId> {
    order.inputAmount = amount;
    order.inputAsset = fromAsset;
    order.outputAsset = toAsset;

    try {
      return await this.scryptService.sell(fromAsset, toAsset, amount);
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }
      throw e;
    }
  }

  private isBalanceTooLowError(e: Error): boolean {
    return ['Insufficient funds', 'insufficient balance', 'Insufficient position', 'not enough balance'].some((m) =>
      e.message?.toLowerCase().includes(m.toLowerCase()),
    );
  }

  private async getAvailableTradeBalance(from: string, to: string): Promise<number> {
    const availableBalance = await this.scryptService.getAvailableBalance(from);

    const { side } = await this.scryptService.getTradePair(from, to);
    // Reduce balance by 1% when buying to account for price changes
    return side === ScryptOrderSide.BUY ? availableBalance * 0.99 : availableBalance;
  }

  private async getAndCheckTradePrice(from: Asset, to: Asset, maxPriceDeviation = 0.05): Promise<number> {
    const price = await this.scryptService.getCurrentPrice(from.name, to.name);

    const checkPrice = await this.pricingService.getPrice(from, to, PriceValidity.VALID_ONLY);

    if (Math.abs((price - checkPrice.price) / checkPrice.price) > maxPriceDeviation) {
      throw new OrderFailedException(
        `Trade price out of range: exchange price ${price}, check price ${checkPrice.price}, max deviation ${maxPriceDeviation}`,
      );
    }

    return price;
  }
}
