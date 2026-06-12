import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { BankTxConsumer } from './consumers/bank-tx.consumer';
import { BuyCryptoConsumer } from './consumers/buy-crypto.consumer';
import { BuyFiatConsumer } from './consumers/buy-fiat.consumer';
import { CryptoInputConsumer } from './consumers/crypto-input.consumer';
import { ExchangeTxConsumer } from './consumers/exchange-tx.consumer';
import { LiquidityMgmtConsumer } from './consumers/liquidity-mgmt.consumer';
import { LiquidityOrderDexConsumer } from './consumers/liquidity-order-dex.consumer';
import { PayoutOrderConsumer } from './consumers/payout-order.consumer';
import { TradingOrderConsumer } from './consumers/trading-order.consumer';

// watermark helpers live in a consumer-free file to keep the job-service↔consumer import graph acyclic (§11.3)
export { getLedgerWatermark, LedgerWatermark, setLedgerWatermark } from './consumers/ledger-watermark.helper';

const CUTOVER_LOG_ID_KEY = 'ledgerCutoverLogId';

/**
 * Holds the shared cutover-gate (§4-header Blocker R1-6) and registers the @DfxCron wrappers for the consumers.
 * Each booking consumer is one @DfxCron method with its own Process.LEDGER_BOOKING_* kill-switch (Hard
 * Constraint #5). Every wrapper guards on `isLedgerReady()` (no-op until the cutover set `ledgerCutoverLogId`)
 * and is failure-isolated by the lock layer (`dfx-cron.service` lock try/catch). Further stages register their
 * own consumers (PayoutOrder/BuyCrypto/BuyFiat/LiquidityMgmt/TradingOrder/LiquidityOrderDex) here.
 */
@Injectable()
export class LedgerBookingJobService {
  private readonly logger = new DfxLogger(LedgerBookingJobService);

  constructor(
    private readonly settingService: SettingService,
    private readonly bankTxConsumer: BankTxConsumer,
    private readonly exchangeTxConsumer: ExchangeTxConsumer,
    private readonly cryptoInputConsumer: CryptoInputConsumer,
    private readonly payoutOrderConsumer: PayoutOrderConsumer,
    private readonly buyCryptoConsumer: BuyCryptoConsumer,
    private readonly buyFiatConsumer: BuyFiatConsumer,
    private readonly liquidityMgmtConsumer: LiquidityMgmtConsumer,
    private readonly liquidityOrderDexConsumer: LiquidityOrderDexConsumer,
    private readonly tradingOrderConsumer: TradingOrderConsumer,
  ) {}

  // cutover-gate (Blocker R1-6): no consumer books before bootstrap+opening set the ready marker
  async isLedgerReady(): Promise<boolean> {
    return (await this.settingService.get(CUTOVER_LOG_ID_KEY)) != null;
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LEDGER_BOOKING_BANK_TX, timeout: 1800 })
  async runBankTx(): Promise<void> {
    if (!(await this.isLedgerReady())) return;
    await this.bankTxConsumer.process();
  }

  // ExchangeTx + ExchangeTrade are ONE @DfxCron method → one flag (Minor R8-1): deposit/withdrawal then trade
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LEDGER_BOOKING_EXCHANGE_TX, timeout: 1800 })
  async runExchangeTx(): Promise<void> {
    if (!(await this.isLedgerReady())) return;
    await this.exchangeTxConsumer.process();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LEDGER_BOOKING_CRYPTO_INPUT, timeout: 1800 })
  async runCryptoInput(): Promise<void> {
    if (!(await this.isLedgerReady())) return;
    await this.cryptoInputConsumer.process();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LEDGER_BOOKING_PAYOUT, timeout: 1800 })
  async runPayoutOrder(): Promise<void> {
    if (!(await this.isLedgerReady())) return;
    await this.payoutOrderConsumer.process();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LEDGER_BOOKING_BUY_CRYPTO, timeout: 1800 })
  async runBuyCrypto(): Promise<void> {
    if (!(await this.isLedgerReady())) return;
    await this.buyCryptoConsumer.process();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LEDGER_BOOKING_BUY_FIAT, timeout: 1800 })
  async runBuyFiat(): Promise<void> {
    if (!(await this.isLedgerReady())) return;
    await this.buyFiatConsumer.process();
  }

  // §4.8 — bridge-only (skips exchange/DfxDex movements booked by their authoritative consumers)
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LEDGER_BOOKING_LIQ_MGMT, timeout: 1800 })
  async runLiquidityMgmt(): Promise<void> {
    if (!(await this.isLedgerReady())) return;
    await this.liquidityMgmtConsumer.process();
  }

  // §4.8a — DfxDex purchase/sell on-chain swaps (own flag, Hard Constraint #5)
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LEDGER_BOOKING_LIQUIDITY_ORDER, timeout: 1800 })
  async runLiquidityOrderDex(): Promise<void> {
    if (!(await this.isLedgerReady())) return;
    await this.liquidityOrderDexConsumer.process();
  }

  // §4.9 — arbitrage swaps (own flag, Hard Constraint #5)
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LEDGER_BOOKING_TRADING_ORDER, timeout: 1800 })
  async runTradingOrder(): Promise<void> {
    if (!(await this.isLedgerReady())) return;
    await this.tradingOrderConsumer.process();
  }
}
