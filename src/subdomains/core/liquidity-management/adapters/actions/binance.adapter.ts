import { Injectable } from '@nestjs/common';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { LndInvoiceState } from 'src/integration/lightning/dto/lnd.dto';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { CorrelationId } from '../../interfaces';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

export enum BinanceAdapterCommands {
  LIGHTNING_WITHDRAW = 'lightning-withdraw',
}

// Binance Lightning withdrawal limit
const BINANCE_LIGHTNING_MAX_WITHDRAWAL_BTC = 0.00999;

@Injectable()
export class BinanceAdapter extends CcxtExchangeAdapter {
  private readonly lightningClient: LightningClient;

  constructor(
    binanceService: BinanceService,
    exchangeRegistry: ExchangeRegistryService,
    dexService: DexService,
    liquidityOrderRepo: LiquidityManagementOrderRepository,
    pricingService: PricingService,
    assetService: AssetService,
    private readonly http: HttpService,
  ) {
    super(
      LiquidityManagementSystem.BINANCE,
      binanceService,
      exchangeRegistry,
      dexService,
      liquidityOrderRepo,
      pricingService,
      assetService,
    );

    this.lightningClient = new LightningClient(http);
    this.commands.set(BinanceAdapterCommands.LIGHTNING_WITHDRAW, this.lightningWithdraw.bind(this));
  }

  // --- LIGHTNING WITHDRAW --- //

  private async lightningWithdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const balance = await this.exchangeService.getAvailableBalance('BTC');

    // Calculate amount respecting Binance Lightning limit (0.00999 BTC max per withdrawal)
    // If more is needed, subsequent cronjob runs will handle the rest
    const amount = Util.floor(Math.min(order.maxAmount, balance, BINANCE_LIGHTNING_MAX_WITHDRAWAL_BTC), 8);

    if (amount <= 0) {
      throw new OrderNotProcessableException(
        `Binance: not enough BTC balance for Lightning withdraw (balance: ${balance})`,
      );
    }
    const amountSats = LightningHelper.btcToSat(amount);

    // Generate invoice via LnBits
    const invoice = await this.lightningClient.getLnBitsWalletPayment({
      amount: amountSats,
      memo: `LM Order ${order.id}`,
      expirySec: 1800, // 30 min (Binance limit)
    });

    order.inputAmount = amount;
    order.inputAsset = 'BTC';
    order.outputAsset = 'BTC';

    // Send invoice to Binance for withdrawal
    const response = await this.exchangeService.withdrawFunds('BTC', amount, invoice.pr, undefined, 'LIGHTNING');

    return response.id;
  }

  // --- COMPLETION CHECK --- //

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    if (order.action.command === BinanceAdapterCommands.LIGHTNING_WITHDRAW) {
      return this.checkLightningWithdrawCompletion(order);
    }
    return super.checkCompletion(order);
  }

  private async checkLightningWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const withdrawal = await this.exchangeService.getWithdraw(order.correlationId, 'BTC');
    if (!withdrawal) return false;

    if (withdrawal.status === 'failed') {
      throw new OrderFailedException(`Lightning withdrawal ${order.correlationId} failed on Binance`);
    }

    // For Lightning, txid = payment_hash (hex)
    const paymentHash = withdrawal.txid;
    if (!paymentHash) return false;

    try {
      const invoice = await this.lightningClient.lookupInvoice(paymentHash);
      const isComplete = invoice.state === LndInvoiceState.SETTLED;

      if (isComplete) {
        order.outputAmount = LightningHelper.satToBtc(+invoice.amt_paid_sat);
      }

      return isComplete;
    } catch {
      // Invoice not found = not yet received
      return false;
    }
  }

  // --- VALIDATION --- //

  validateParams(command: string, params: Record<string, unknown>): boolean {
    if (command === BinanceAdapterCommands.LIGHTNING_WITHDRAW) {
      return true; // No params needed for lightning-withdraw
    }
    return super.validateParams(command, params);
  }
}
