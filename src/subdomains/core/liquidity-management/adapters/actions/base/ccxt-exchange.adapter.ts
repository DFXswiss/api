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
  TRADE = 'trade',
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
    this.commands.set(CcxtExchangeAdapterCommands.TRADE, this.trade.bind(this));
    this.commands.set(CcxtExchangeAdapterCommands.TRANSFER, this.transfer.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case CcxtExchangeAdapterCommands.WITHDRAW:
        return this.checkWithdrawCompletion(order);

      case CcxtExchangeAdapterCommands.TRADE:
        return this.checkTradeCompletion(order);

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

      case CcxtExchangeAdapterCommands.TRADE:
        return this.validateTradeParams(params);

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
    const amount = Util.round(order.amount * 1.01 - balance, 8); // small cap for price changes
    if (amount <= 0) {
      // trade not necessary
      throw new OrderNotNecessaryException(
        `${asset} balance higher than required amount (${balance} > ${order.amount})`,
      );
    }

    try {
      return await this.exchangeService.buy(tradeAsset, asset, amount);
    } catch (e) {
      if (e.message?.includes('not enough balance')) {
        throw new OrderNotProcessableException(e.message);
      }

      if (e.message?.includes('Illegal characters found')) {
        throw new Error(`Invalid trade request, tried to sell ${tradeAsset} for ${amount} ${asset}: ${e.message}`);
      }

      throw e;
    }
  }

  private async transfer(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { address, key, network, target, asset } = this.parseTransferParams(order.action.paramMap);

    const targetAsset = order.pipeline.rule.targetAsset.dexName;
    const token = asset ?? targetAsset;

    const targetExchange = this.exchangeRegistry.get(target);

    let requiredAmount = order.amount;
    if (token !== targetAsset) {
      const price = await targetExchange.getPrice(token, targetAsset);
      requiredAmount = price.invert().convert(order.amount);
    }

    const balance = await targetExchange.getBalance(token);
    const amount = Util.round(requiredAmount * 1.01 - balance, 8); // small cap for price changes

    const sourceBalance = await this.exchangeService.getBalance(token);
    if (amount > sourceBalance)
      throw new OrderNotProcessableException(`Not enough balance of ${token} (${amount} > ${sourceBalance})`);

    try {
      const response = await this.exchangeService.withdrawFunds(token, amount, address, key, network);

      return response.id;
    } catch (e) {
      if (['Insufficient funds', 'insufficient balance'].some((m) => e.message?.includes(m))) {
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

  private async checkTransferCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { targetAsset },
      },
      action: { paramMap },
      correlationId,
    } = order;

    const { target, asset } = this.parseTransferParams(paramMap);

    const token = asset ?? targetAsset.dexName;

    const withdrawal = await this.exchangeService.getWithdraw(correlationId, token);
    if (!withdrawal?.txid) {
      this.logger.verbose(
        `No withdrawal id for id ${correlationId} and asset ${token} at ${this.exchangeService.name} found`,
      );
      return false;
    }

    const targetExchange = this.exchangeRegistry.get(target);

    const deposit = await targetExchange
      .getDeposits(token, order.created)
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
    asset?: string;
  } {
    const address = process.env[params.destinationAddress as string];
    const key = this.exchangeService.config.withdrawKeys?.get(params.destinationAddressKey as string);
    const network = this.exchangeService.mapNetwork(params.destinationBlockchain as Blockchain);
    const target = params.targetExchange as string;
    const asset = params.asset as string | undefined;

    if (!(address && key && network && target))
      throw new Error(`Params provided to CcxtExchangeAdapter.transfer(...) command are invalid.`);

    return { address, key, network, target, asset };
  }
}
