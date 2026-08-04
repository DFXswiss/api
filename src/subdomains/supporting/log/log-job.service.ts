import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { BlockchainTokenBalance } from 'src/integration/blockchain/shared/dto/blockchain-token-balance.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { BlockchainClient } from 'src/integration/blockchain/shared/util/blockchain-client';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { ExchangeTxService } from 'src/integration/exchange/services/exchange-tx.service';
import { amountType } from 'src/shared/models/active';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process, ProcessService } from 'src/shared/services/process.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { AmountType, Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import {
  LiquidityManagementBridges,
  LiquidityManagementExchanges,
} from 'src/subdomains/core/liquidity-management/enums';
import { LiquidityManagementPipelineService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-pipeline.service';
import { PaymentBalanceService } from 'src/subdomains/core/payment-link/services/payment-balance.service';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TradingOrder } from 'src/subdomains/core/trading/entities/trading-order.entity';
import { TradingOrderService } from 'src/subdomains/core/trading/services/trading-order.service';
import { TradingRuleService } from 'src/subdomains/core/trading/services/trading-rule.service';
import { BankTxRepeat } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxRepeatService } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturn } from '../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTxReturnService } from '../bank-tx/bank-tx-return/bank-tx-return.service';
import {
  BankTx,
  BankTxIndicator,
  BankTxType,
  INTERNAL_TRANSFER_SETTLEMENT_DAYS,
} from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from '../bank/bank/bank.service';
import { IbanBankName } from '../bank/bank/dto/bank.dto';
import { CryptoInput } from '../payin/entities/crypto-input.entity';
import { PayInService } from '../payin/services/payin.service';
import { PayoutOrder, PayoutOrderContext } from '../payout/entities/payout-order.entity';
import { PayoutService } from '../payout/services/payout.service';
import {
  AssetLog,
  BalancesByFinancialType,
  BankExchangeType,
  ChangeLog,
  FinanceLog,
  LogPairId,
  ManualLogPosition,
  TradingLog,
} from './dto/log.dto';
import { LogSeverity } from './log.entity';
import { LogService } from './log.service';

// A transmitted payout normally settles within a few days (weekday seconds; up to ~111h over a
// weekend+holiday). Beyond this it is an abnormal stuck payout surfaced for manual reconciliation;
// equity stays correct meanwhile because the liability is still counted.
const SETTLEMENT_SLA_HOURS = 144;
const SETTLEMENT_SLA_MS = SETTLEMENT_SLA_HOURS * 60 * 60 * 1000;
const INTERNAL_TRANSFER_SETTLEMENT_WINDOW_MS = INTERNAL_TRANSFER_SETTLEMENT_DAYS * 24 * 60 * 60 * 1000;

// tolerance for comparing summed float balances (avoids false alarms on rounding)
const BALANCE_TOLERANCE = 0.01;

// Asset amounts in this log are rounded/displayed at 8 decimals (see AmountType.ASSET); below that,
// only float-summation residue can remain. BALANCE_TOLERANCE (a "cent") is fine for EUR/USD/CHF-valued
// balances but would be a material amount on a high-priced crypto asset, so non-fiat assets get a
// much tighter reporting tolerance (see financialTypeAmountType below for the fiat/asset distinction).
const ASSET_BALANCE_TOLERANCE = 1e-8;

// synthetic balancesByFinancialType key under which the open referral-credit liability is booked.
// Referral rewards are paid from DFX funds, so the accrued-but-unpaid credit is a real liability;
// booking it keeps totalBalanceChf at true equity and makes ref payouts balance-neutral.
const REF_CREDIT_FINANCIAL_TYPE = 'RefCredit';

@Injectable()
export class LogJobService {
  private readonly logger = new DfxLogger(LogJobService);

  private readonly unavailableClientWarningsLogged = new Set<Blockchain>();

  private readonly paymentBalanceCache = new AsyncCache<Map<number, BlockchainTokenBalance>>(
    CacheItemResetPeriod.EVERY_HOUR,
  );
  private readonly customBalanceCache = new AsyncCache<
    { blockchain: Blockchain; balances: BlockchainTokenBalance[] }[]
  >(CacheItemResetPeriod.EVERY_HOUR);

  constructor(
    private readonly tradingRuleService: TradingRuleService,
    private readonly assetService: AssetService,
    private readonly logService: LogService,
    private readonly payInService: PayInService,
    private readonly buyFiatService: BuyFiatService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly settingService: SettingService,
    private readonly bankTxService: BankTxService,
    private readonly bankTxRepeatService: BankTxRepeatService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly liquidityManagementPipelineService: LiquidityManagementPipelineService,
    private readonly exchangeTxService: ExchangeTxService,
    private readonly bankService: BankService,
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly refRewardService: RefRewardService,
    private readonly tradingOrderService: TradingOrderService,
    private readonly payoutService: PayoutService,
    private readonly processService: ProcessService,
    private readonly paymentBalanceService: PaymentBalanceService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.TRADING_LOG, timeout: 1800 })
  async saveTradingLog() {
    try {
      // trading log
      const tradingLog = await this.getTradingLog();

      // assets
      const assets = await this.assetService
        .getAssetsWith({ balance: true, bank: true })
        .then((l) => l.filter((a) => ![AssetType.CUSTOM, AssetType.PRESALE].includes(a.type)));

      // asset log
      const assetLog = await this.getAssetLog(assets);

      // balances grouped by financialType
      const balancesByFinancialType = this.getBalancesByFinancialType(assets, assetLog);

      // referral credit owed to referrers is a real liability, discharged on payout. Accrue the open
      // balance here so totalBalanceChf reflects true equity and ref payouts stay balance-neutral
      // (plus and minus drop together) instead of showing a phantom equity step (see BalancesTotal).
      const refCreditLiability = await this.getRefCreditLiability();
      if (refCreditLiability) balancesByFinancialType[REF_CREDIT_FINANCIAL_TYPE] = refCreditLiability;

      // total balances — customer flow is balance-neutral, so totalBalanceChf moves only on
      // operating profit, FX, or an error/realised loss (see BalancesTotal). Hence the guardrails below.
      const plusBalanceChf = Util.sumObjValue(Object.values(balancesByFinancialType), 'plusBalanceChf');
      const minusBalanceChf = Util.sumObjValue(Object.values(balancesByFinancialType), 'minusBalanceChf');

      const totalBalanceChf = plusBalanceChf - minusBalanceChf;

      // safety module
      const minTotalBalanceChf = await this.settingService.getObj<number>('minTotalBalanceChf', 100000);

      // fail closed: a non-finite total means the balance is unknown (e.g. a bucket aggregate could not
      // be summed), so activate the safety mode instead of silently leaving it off on a false comparison.
      const totalBalanceIsFinite = Number.isFinite(totalBalanceChf);
      if (!totalBalanceIsFinite)
        this.logger.error(`Total balance is not finite (${totalBalanceChf}); activating safety mode`);

      // fail closed on the threshold too: a non-finite minTotalBalanceChf (misconfigured setting) would
      // make every `totalBalanceChf < minTotalBalanceChf` comparison false (x < NaN === false) and thus
      // silently disable the safety net, so treat it as an error and activate the safety mode.
      const minTotalBalanceIsFinite = Number.isFinite(minTotalBalanceChf);
      if (!minTotalBalanceIsFinite)
        this.logger.error(`minTotalBalanceChf is not finite (${minTotalBalanceChf}); activating safety mode`);

      const safetyModeActive =
        !totalBalanceIsFinite || !minTotalBalanceIsFinite || totalBalanceChf < minTotalBalanceChf;
      await this.processService.setSafetyModeActive(safetyModeActive);

      const lastLog = await this.logService.maxEntity('LogService', 'FinancialDataLog', LogSeverity.INFO, true);
      const lastFinanceLog = JSON.parse(lastLog.message) as FinanceLog;
      const lastTotalBalance = lastFinanceLog.balancesTotal.totalBalanceChf;

      // price effect (FX P&L) of the open positions since the previous snapshot; undefined on the first
      // entry (no reference point). Pure arithmetic over already-parsed data (see getFxPnlChf), so it is
      // deliberately left outside any try/catch — it cannot throw and a wrapping catch would only mask a bug.
      const fxPnlChf = this.getFxPnlChf(lastFinanceLog, assetLog, assets);

      // Same source as balancesTotal.totalBalanceChf in the JSON below: the identical rounded
      // getJsonValue result. Collapsed to null on the (very rare) non-finite case so the column
      // matches what a reader of `message` would see — JSON has no NaN/Infinity, JSON.stringify
      // serialises both as null, so storing the raw NaN in a float8 column would silently diverge
      // from the JSON's own value.
      const totalBalanceChfColumn = Number.isFinite(totalBalanceChf)
        ? this.getJsonValue(totalBalanceChf, AmountType.FIAT, true, true)
        : null;

      // Same source as assets[btcAsset.id].priceChf in the JSON below: assetLog's raw
      // (unrounded) approxPriceChf value for the BTC asset — that field is never passed through
      // getJsonValue in the JSON path either, so this column is intentionally NOT rounded here.
      // null when there is no configured BTC asset, the BTC asset has no assetLog entry (e.g.
      // filtered out upstream), or the price is missing/non-finite.
      const btcAsset = await this.assetService.getBtcCoin();
      const btcAssetPriceChf = btcAsset ? assetLog[btcAsset.id]?.priceChf : undefined;
      const btcPriceChfColumn = btcAssetPriceChf != null && Number.isFinite(btcAssetPriceChf) ? btcAssetPriceChf : null;

      await this.logService.create({
        system: 'LogService',
        subsystem: 'FinancialDataLog',
        severity: LogSeverity.INFO,
        totalBalanceChf: totalBalanceChfColumn,
        btcPriceChf: btcPriceChfColumn,
        message: JSON.stringify({
          assets: assetLog,
          tradings: tradingLog,
          balancesByFinancialType,
          balancesTotal: {
            // keep negative totals as real numbers (returnNegativeValue): a genuinely negative
            // plus/minus/total must stay numeric so next run's lastTotalBalance is defined and the
            // change-limit comparison (Math.abs(total - last)) does not break on undefined.
            plusBalanceChf: this.getJsonValue(plusBalanceChf, AmountType.FIAT, true, true),
            minusBalanceChf: this.getJsonValue(minusBalanceChf, AmountType.FIAT, true, true),
            totalBalanceChf: this.getJsonValue(totalBalanceChf, AmountType.FIAT, true, true),
            // per-interval price effect vs. the previous snapshot, rounded like its neighbours (FIAT,
            // returnNegativeValue so a negative drift stays numeric). Left undefined when there is no
            // predecessor to diff against; JSON.stringify then drops the key (absence, not a false 0).
            fxPnlChf: fxPnlChf === undefined ? undefined : this.getJsonValue(fxPnlChf, AmountType.FIAT, true, true),
          },
        }),
        // jump vs. the last VALID entry (lastLog above), not the direct predecessor; must be
        // read as transient skew vs. persisting deviation -- see BalancesTotal in dto/log.dto.ts.
        // A non-finite total is never valid: the 15-minute clause would otherwise mark a long
        // incident entry valid and make its null total the baseline for later comparisons.
        valid:
          totalBalanceIsFinite &&
          (Math.abs(totalBalanceChf - lastTotalBalance) <= Config.financeLogTotalBalanceChangeLimit ||
            Util.minutesDiff(lastLog.created) > 15),
        category: null,
      });

      // The changeLog feeds only the informative FinancialChangesLog and is independent of the equity
      // path above, so it runs in its own try/catch: a reporting-price failure must not arm the equity
      // safety mode; the equity path above has already run and set it correctly. On failure we log the
      // error and omit this minute's changes entry (absence instead of a wrong value).
      try {
        const changeLog = await this.getChangeLog();

        await this.logService.create({
          system: 'LogService',
          subsystem: 'FinancialChangesLog',
          severity: LogSeverity.INFO,
          message: JSON.stringify({ changes: changeLog }),
          valid: null,
          category: null,
        });
      } catch (e) {
        this.logger.error("Failed to build the financial changes log; skipping this minute's changes entry", e);
      }
    } catch (e) {
      await this.processService.setSafetyModeActive(true);
      throw e;
    }
  }

  // --- LOG METHODS --- //

  private getBalancesByFinancialType(assets: Asset[], assetLog: AssetLog): BalancesByFinancialType {
    const financialTypeMap = Util.groupBy<Asset, string>(
      assets.filter((a) => a.financialType),
      'financialType',
    );

    return Array.from(financialTypeMap.entries()).reduce((acc, [financialType, assets]) => {
      const plusBalance = assets.reduce((prev, curr) => prev + (assetLog[curr.id]?.plusBalance?.total ?? 0), 0);
      const plusBalanceChf = assets.reduce(
        (prev, curr) =>
          prev + (assetLog[curr.id] ? assetLog[curr.id].plusBalance.total * assetLog[curr.id].priceChf : 0),
        0,
      );
      const minusBalance = assets.reduce((prev, curr) => prev + (assetLog[curr.id]?.minusBalance?.total ?? 0), 0);
      const minusBalanceChf = assets.reduce(
        (prev, curr) =>
          prev + (assetLog[curr.id] ? assetLog[curr.id].minusBalance.total * assetLog[curr.id].priceChf : 0),
        0,
      );

      // keep negative aggregates as real numbers (returnNegativeValue): a negative bucket total is a
      // genuine state (e.g. an overdrawn/blocked bank account) that must stay visible instead of being
      // nulled out, which also keeps the downstream sum numeric rather than turning into NaN.
      acc[financialType] = {
        plusBalance: this.getJsonValue(plusBalance, this.financialTypeAmountType(financialType), true, true),
        plusBalanceChf: this.getJsonValue(plusBalanceChf, AmountType.FIAT, true, true),
        minusBalance: this.getJsonValue(minusBalance, this.financialTypeAmountType(financialType), true, true),
        minusBalanceChf: this.getJsonValue(minusBalanceChf, AmountType.FIAT, true, true),
      };

      return acc;
    }, {});
  }

  // Per-interval price effect (FX P&L) of the open book: for each asset that carried a net position in the
  // previous snapshot, its previous net (plusBalance.total − minusBalance.total) times the change in its CHF
  // price since then. Equity drifts on open positions while orders are in flight (case 2 in BalancesTotal);
  // this isolates that FX component so ΔtotalBalanceChf can be split into transactional yield vs. FX vs. errors.
  //
  // Only assets with a financialType are counted (same filter as getBalancesByFinancialType). A position
  // absent from EITHER snapshot contributes no price effect: new positions enter the book via flows (which
  // are balance-neutral), not via FX, and a closed position has no mark left to move. Assets lacking a usable
  // price on either side are likewise skipped, as no price effect is derivable.
  //
  // Returns undefined when there is no predecessor snapshot, so the caller omits the field instead of writing
  // a false 0 for the very first entry. This is pure arithmetic over already-parsed data (the predecessor
  // FinanceLog and the freshly built assetLog), so it cannot throw and deliberately carries no try/catch — a
  // wrapping catch would only mask a logic error while adding nothing to the resilience of the log write.
  private getFxPnlChf(prevFinanceLog: FinanceLog | undefined, assetLog: AssetLog, assets: Asset[]): number | undefined {
    const prevAssets = prevFinanceLog?.assets;
    if (!prevAssets) return undefined;

    return assets
      .filter((a) => a.financialType)
      .reduce((sum, asset) => {
        const prev = prevAssets[asset.id];
        const now = assetLog[asset.id];
        if (!prev || !now) return sum;

        const pPrev = prev.priceChf;
        const pNow = now.priceChf;
        if (pPrev == null || pNow == null) return sum;

        const netPrev = (prev.plusBalance?.total ?? 0) - (prev.minusBalance?.total ?? 0);
        return sum + netPrev * (pNow - pPrev);
      }, 0);
  }

  // open referral-credit liability (EUR-denominated), booked as a synthetic financialType bucket so it
  // flows into minusBalanceChf/totalBalanceChf and reconciles like any other liability. Returns
  // undefined when nothing is owed, so no empty bucket is written.
  private async getRefCreditLiability(): Promise<BalancesByFinancialType[string] | undefined> {
    const { amountEur, amountChf } = await this.refRewardService.getOpenRefCreditLiability();
    if (!(amountChf > 0)) return undefined;

    return {
      plusBalance: 0,
      plusBalanceChf: 0,
      minusBalance: Util.roundReadable(amountEur, AmountType.FIAT, 8),
      minusBalanceChf: Util.roundReadable(amountChf, AmountType.FIAT, 8),
    };
  }

  private async getTradingLog(): Promise<TradingLog> {
    return this.tradingRuleService.getCurrentTradingOrders().then((t) =>
      t.reduce((prev, curr) => {
        prev[curr.tradingRule.id] = {
          price1: curr.price1,
          price2: curr.price2,
          price3: curr.price3,
        };

        return prev;
      }, {}),
    );
  }

  private async getAssetLog(assets: Asset[]): Promise<AssetLog> {
    // custom balance settings
    const customBalanceSettings = await this.settingService.getCustomBalanceSettings();
    const customAssets = assets.filter((a) => customBalanceSettings.assets.includes(a.uniqueName));
    const customAssetMap = Util.groupBy<Asset, Blockchain>(customAssets, 'blockchain');

    const liqAddresses = new Map(
      Object.values(Blockchain).map((blockchain) => {
        try {
          const liqAddress = this.blockchainRegistryService.getClient(blockchain)?.walletAddress;

          return [blockchain, liqAddress];
        } catch {
          return [blockchain, undefined];
        }
      }),
    );

    const customBalances = await this.customBalanceCache.get(
      'all',
      () =>
        Promise.all(
          Array.from(customAssetMap.entries()).map(async ([b, a]) => {
            try {
              const client = this.blockchainRegistryService.getClient(b);
              if (!client) {
                if (!this.unavailableClientWarningsLogged.has(b)) {
                  this.logger.warn(`Blockchain client not configured for ${b} - skipping custom balances`);
                  this.unavailableClientWarningsLogged.add(b);
                }
                return { blockchain: b, balances: [] };
              }

              const balances = await Util.timeout(
                this.getCustomBalances(client, a, customBalanceSettings.addresses).then((b) => b.flat()),
                30000,
              );
              return { blockchain: b, balances };
            } catch (e) {
              this.logger.error(`Error in FinanceLog customBalances for blockchain ${b}:`, e);
              return { blockchain: b, balances: [] };
            }
          }),
        ),
      undefined,
      true,
    );

    // payment deposit address balance (Monero/Lightning have no separated balance)
    const paymentDepositBalances = await this.paymentBalanceCache.get(
      'all',
      () => this.paymentBalanceService.getPaymentBalances(assets, true),
      undefined,
      true,
    );

    // banks
    const olkyBank = await this.bankService.getBankInternal(IbanBankName.OLKY, 'EUR');
    const yapealEurBank = await this.bankService.getBankInternal(IbanBankName.YAPEAL, 'EUR');
    const yapealChfBank = await this.bankService.getBankInternal(IbanBankName.YAPEAL, 'CHF');
    const frickChfBank = await this.bankService.getBankInternal(IbanBankName.FRICK, 'CHF');
    const frickEurBank = await this.bankService.getBankInternal(IbanBankName.FRICK, 'EUR');
    const eurBankIbans = [yapealEurBank.iban, olkyBank.iban, frickEurBank.iban];
    const chfBankIbans = [yapealChfBank.iban, frickChfBank.iban];
    const eurBankAssets = assets.filter(
      (a) => [Blockchain.OLKYPAY, Blockchain.YAPEAL, Blockchain.FRICK].includes(a.blockchain) && a.dexName === 'EUR',
    );

    // pending balances
    const pendingOrders = await this.liquidityManagementPipelineService.getPendingTx();

    const pendingExchangeOrders = pendingOrders.filter((o) => LiquidityManagementExchanges.includes(o.action.system));
    const pendingBridgeOrders = pendingOrders.filter(
      (o) => LiquidityManagementBridges.includes(o.action.system) && ['withdraw', 'deposit'].includes(o.action.command),
    );
    const pendingPayIns = await this.payInService.getPendingPayIns();
    const pendingBuyFiat = await this.buyFiatService.getPendingTransactions();
    const pendingBuyCrypto = await this.buyCryptoService.getPendingTransactions();
    const payoutSentBuyCryptoIds = await this.payoutService.getRecentPayoutSentCorrelationIds(
      PayoutOrderContext.BUY_CRYPTO,
    );
    const filteredPendingBuyCrypto = pendingBuyCrypto.filter((tx) => !payoutSentBuyCryptoIds.has(tx.id.toString()));
    const pendingBankTx = await this.bankTxService.getPendingTx();
    const pendingBankTxRepeat = await this.bankTxRepeatService.getPendingTx();
    const pendingBankTxReturn = await this.bankTxReturnService.getPendingTx();

    // manual balances
    const manualDebtPositions = await this.settingService.getObj<ManualLogPosition[]>('balanceLogDebtPositions', []);
    const manualLiqPositions = await this.settingService.getObj<ManualLogPosition[]>('balanceLogLiqPositions', []);

    const useUnfilteredTx = await this.settingService.getObj<boolean>('financeLogUnfilteredTx', false);
    const financeLogPairIds = await this.settingService.getObj<LogPairId>('financeLogPairIds', undefined);

    const minBankTxId = useUnfilteredTx
      ? Math.min(
          ...[
            financeLogPairIds?.fromKraken.chf.bankTxId,
            financeLogPairIds?.fromKraken.eur.bankTxId,
            financeLogPairIds?.toKraken.chf.bankTxId,
            financeLogPairIds?.toKraken.eur.bankTxId,
            financeLogPairIds?.toScrypt.chf.bankTxId,
            financeLogPairIds?.toScrypt.eur.bankTxId,
          ],
        )
      : undefined;
    const minExchangeTxId = useUnfilteredTx
      ? Math.min(
          ...[
            financeLogPairIds?.fromKraken.chf.exchangeTxId,
            financeLogPairIds?.fromKraken.eur.exchangeTxId,
            financeLogPairIds?.toKraken.chf.exchangeTxId,
            financeLogPairIds?.toKraken.eur.exchangeTxId,
            financeLogPairIds?.toScrypt.chf.exchangeTxId,
            financeLogPairIds?.toScrypt.eur.exchangeTxId,
          ],
        )
      : undefined;

    // pending internal balances
    // db requests
    const recentInternalBankTx = this.getUnsettledInternalBankTx(
      await this.bankTxService.getTrackedInternalTransfers(),
    );
    const recentKrakenBankTx = await this.bankTxService.getRecentExchangeTx(minBankTxId, BankTxType.KRAKEN);
    const recentKrakenExchangeTx = await this.exchangeTxService.getRecentExchangeTx(
      minExchangeTxId,
      ExchangeName.KRAKEN,
      [ExchangeTxType.DEPOSIT, ExchangeTxType.WITHDRAWAL],
    );
    const recentScryptBankTx = await this.bankTxService.getRecentExchangeTx(minBankTxId, BankTxType.SCRYPT);
    const recentScryptExchangeTx = await this.exchangeTxService.getRecentExchangeTx(
      minExchangeTxId,
      ExchangeName.SCRYPT,
      [ExchangeTxType.DEPOSIT, ExchangeTxType.WITHDRAWAL],
    );

    // fixed sender and receiver data

    // CHF: Kraken -> Yapeal
    const chfSenderExchangeTx = recentKrakenExchangeTx.filter(
      (k) =>
        k.type === ExchangeTxType.WITHDRAWAL &&
        k.method === 'Bank Frick (SIC) International' &&
        k.address === 'YAPEAL AG',
    );
    const chfReceiverBankTx = recentKrakenBankTx.filter(
      (b) => b.accountIban === yapealChfBank.iban && b.creditDebitIndicator === BankTxIndicator.CREDIT,
    );

    // EUR: Kraken -> Yapeal
    const eurSenderExchangeTx = recentKrakenExchangeTx.filter(
      (k) =>
        k.type === ExchangeTxType.WITHDRAWAL &&
        k.method === 'Bank Frick (SEPA) International' &&
        k.address === 'YAPEAL AG',
    );
    const eurReceiverBankTx = recentKrakenBankTx.filter(
      (b) => b.accountIban === yapealEurBank.iban && b.creditDebitIndicator === BankTxIndicator.CREDIT,
    );

    // CHF: Yapeal -> Kraken
    const chfSenderBankTx = recentKrakenBankTx.filter(
      (b) => b.accountIban === yapealChfBank.iban && b.creditDebitIndicator === BankTxIndicator.DEBIT,
    );
    const chfReceiverExchangeTx = recentKrakenExchangeTx.filter(
      (k) =>
        k.type === ExchangeTxType.DEPOSIT &&
        k.status !== 'pending' &&
        k.method === 'Bank Frick (SIC) International' &&
        k.address === yapealChfBank.bic.padEnd(11, 'XXX'),
    );

    // EUR: Yapeal -> Kraken
    const eurSenderBankTx = recentKrakenBankTx.filter(
      (b) => b.accountIban === yapealEurBank.iban && b.creditDebitIndicator === BankTxIndicator.DEBIT,
    );
    const eurReceiverExchangeTx = recentKrakenExchangeTx.filter(
      (k) =>
        k.type === ExchangeTxType.DEPOSIT &&
        k.status !== 'pending' &&
        k.method === 'Bank Frick (SEPA) International' &&
        k.address === yapealEurBank.bic.padEnd(11, 'XXX'),
    );

    // CHF: Bank (Yapeal/Frick) -> Scrypt
    const chfSenderScryptBankTx = recentScryptBankTx.filter(
      (b) => chfBankIbans.includes(b.accountIban) && b.creditDebitIndicator === BankTxIndicator.DEBIT,
    );
    const chfReceiverScryptExchangeTx = recentScryptExchangeTx.filter(
      (k) => k.type === ExchangeTxType.DEPOSIT && k.status === 'ok' && k.currency === 'CHF',
    );

    // sender and receiver data
    const { sender: recentChfKrakenYapealTx, receiver: recentChfKrakenBankTx } = this.filterSenderPendingList(
      chfSenderExchangeTx,
      chfReceiverBankTx,
    );
    const { sender: recentEurKrakenYapealTx, receiver: recentEurKrakenBankTx } = this.filterSenderPendingList(
      eurSenderExchangeTx,
      eurReceiverBankTx,
    );

    const { sender: recentChfYapealKrakenTx, receiver: recentChfBankTxKraken } = this.filterSenderPendingList(
      chfSenderBankTx,
      chfReceiverExchangeTx,
    );
    const { sender: recentEurYapealKrakenTx, receiver: recentEurBankTxKraken } = this.filterSenderPendingList(
      eurSenderBankTx,
      eurReceiverExchangeTx,
    );

    // EUR: Bank -> Scrypt
    const eurSenderScryptBankTx = recentScryptBankTx.filter(
      (b) =>
        eurBankIbans.includes(b.accountIban) &&
        b.creditDebitIndicator === BankTxIndicator.DEBIT &&
        b.instructedCurrency,
    );
    const eurReceiverScryptExchangeTx = recentScryptExchangeTx.filter(
      (k) => k.type === ExchangeTxType.DEPOSIT && k.status === 'ok' && k.currency === 'EUR',
    );

    // CHF: Scrypt -> Bank (Yapeal/Frick) — receiver list is matching-only; pending attribution stays Yapeal-targeted
    // (ExchangeTx has no bank destination field, so a per-currency target would double-count across CHF bank assets)
    const chfSenderScryptExchangeTx = recentScryptExchangeTx.filter(
      (k) => k.type === ExchangeTxType.WITHDRAWAL && k.status !== 'failed' && k.currency === 'CHF',
    );
    const chfReceiverScryptBankTx = recentScryptBankTx.filter(
      (b) => chfBankIbans.includes(b.accountIban) && b.creditDebitIndicator === BankTxIndicator.CREDIT,
    );

    // EUR: Scrypt -> Bank
    const eurSenderScryptExchangeTx = recentScryptExchangeTx.filter(
      (k) => k.type === ExchangeTxType.WITHDRAWAL && k.status !== 'failed' && k.currency === 'EUR',
    );
    const eurReceiverScryptBankTx = recentScryptBankTx.filter(
      (b) => eurBankIbans.includes(b.accountIban) && b.creditDebitIndicator === BankTxIndicator.CREDIT,
    );

    // Bank -> Scrypt: 1:1 matching, unmatched senders only
    const recentChfYapealScryptTx = this.getUnmatchedSenders(chfSenderScryptBankTx, chfReceiverScryptExchangeTx);
    const recentEurBankToScryptTx = this.getUnmatchedSenders(eurSenderScryptBankTx, eurReceiverScryptExchangeTx);

    // Scrypt -> Bank: 1:1 matching, unmatched senders only
    const recentChfScryptYapealTx = this.getUnmatchedSenders(chfSenderScryptExchangeTx, chfReceiverScryptBankTx);
    const recentEurScryptToBankTx = this.getUnmatchedSenders(eurSenderScryptExchangeTx, eurReceiverScryptBankTx);

    // assetLog
    return assets.reduce<AssetLog>((prev, curr) => {
      if ((curr.balance?.amount == null && !curr.isActive) || (curr.balance && !curr.balance.isDfxOwned)) return prev;

      const liqAddress = liqAddresses?.get(curr.blockchain);

      const customAddressBalances = customBalances
        .find((c) => c.blockchain === curr.blockchain)
        ?.balances.filter((b) => b.contractAddress === curr.chainId);

      const totalCustomBalance = customAddressBalances && Util.sumObjValue(customAddressBalances, 'balance');

      const paymentDepositBalance = paymentDepositBalances.get(curr.id)?.balance;

      const manualLiqPosition = manualLiqPositions.find((p) => p.assetId === curr.id)?.value ?? 0;

      // plus
      const liquidity = (curr.balance?.amount ?? 0) + (paymentDepositBalance ?? 0) + (manualLiqPosition ?? 0);

      const cryptoInput = [Blockchain.MONERO, Blockchain.LIGHTNING, Blockchain.ZANO].includes(curr.blockchain)
        ? 0
        : pendingPayIns.reduce((sum, tx) => sum + (tx.asset.id === curr.id ? tx.amount : 0), 0);
      const rawExchangeOrder = pendingExchangeOrders.reduce((sum, tx) => {
        if (tx.pipeline.rule.targetAsset.id !== curr.id) return sum;

        // for transfer/deposit: only count when action.system matches the target asset's exchange
        // (funds leaving this exchange, balance decreased). Skip when funds arrive from another
        // exchange, as the destination balance already reflects those funds before order completion.
        if (tx.action.command !== 'withdraw' && tx.action.system !== (curr.blockchain as string)) return sum;

        return sum + tx.inputAmount;
      }, 0);

      // Deduct locked exchange funds from exchangeOrder to avoid double-counting:
      // amount includes locked funds (e.g. Scrypt pending withdrawals) that may also
      // appear as exchangeOrder. For exchanges without such overlap (e.g. XT trading
      // orders), lockedAmount > exchangeOrder so this just clamps to 0.
      const lockedAmount = (curr.balance?.amount ?? 0) - (curr.balance?.availableAmount ?? curr.balance?.amount ?? 0);
      const exchangeOrder = Math.max(0, rawExchangeOrder - lockedAmount);
      const bridgeOrder = pendingBridgeOrders.reduce(
        (sum, tx) => sum + (tx.pipeline.rule.targetAsset.id === curr.id ? tx.inputAmount : 0),
        0,
      );

      // EUR Scrypt pending: aggregated under Scrypt/EUR instead of per-bank
      const isEurBankAsset =
        [Blockchain.OLKYPAY, Blockchain.YAPEAL, Blockchain.FRICK].includes(curr.blockchain) && curr.dexName === 'EUR';
      const isScryptEurAsset = (curr.blockchain as string) === ExchangeName.SCRYPT && curr.dexName === 'EUR';

      // Transfers between DFX-owned bank accounts remain part of plus balance while in transit.
      const pendingInternalBankAmount = this.getPendingBankAmount([curr], recentInternalBankTx, BankTxType.INTERNAL);

      // Kraken to Yapeal //

      // filtered lists
      const pendingChfKrakenYapealPlusAmount = this.getPendingBankAmount(
        [curr],
        recentChfKrakenYapealTx,
        ExchangeTxType.WITHDRAWAL,
        yapealChfBank.iban,
      );
      const pendingEurKrakenYapealPlusAmount = this.getPendingBankAmount(
        [curr],
        recentEurKrakenYapealTx,
        ExchangeTxType.WITHDRAWAL,
        yapealEurBank.iban,
      );
      const pendingKrakenYapealMinusAmount = this.getPendingBankAmount(
        [curr],
        [...recentEurKrakenBankTx, ...recentChfKrakenBankTx],
        BankTxType.KRAKEN,
      );

      // unfiltered lists
      const pendingChfKrakenYapealPlusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        chfSenderExchangeTx.filter((t) => t.id >= financeLogPairIds.fromKraken.chf.exchangeTxId),
        ExchangeTxType.WITHDRAWAL,
        yapealChfBank.iban,
      );
      const pendingEurKrakenYapealPlusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        eurSenderExchangeTx.filter((t) => t.id >= financeLogPairIds.fromKraken.eur.exchangeTxId),
        ExchangeTxType.WITHDRAWAL,
        yapealEurBank.iban,
      );
      const pendingKrakenYapealMinusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        [
          ...eurReceiverBankTx.filter((t) => t.id >= financeLogPairIds.fromKraken.eur.bankTxId),
          ...chfReceiverBankTx.filter((t) => t.id >= financeLogPairIds.fromKraken.chf.bankTxId),
        ],
        BankTxType.KRAKEN,
      );

      // Yapeal to Kraken //

      // filtered lists
      const pendingYapealKrakenPlusAmount = this.getPendingBankAmount(
        [curr],
        [...recentChfYapealKrakenTx, ...recentEurYapealKrakenTx],
        BankTxType.KRAKEN,
      );
      const pendingChfYapealKrakenMinusAmount = this.getPendingBankAmount(
        [curr],
        recentChfBankTxKraken,
        ExchangeTxType.DEPOSIT,
        yapealChfBank.iban,
      );
      const pendingEurYapealKrakenMinusAmount = this.getPendingBankAmount(
        [curr],
        recentEurBankTxKraken,
        ExchangeTxType.DEPOSIT,
        yapealEurBank.iban,
      );

      // unfiltered lists
      const pendingYapealKrakenPlusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        [
          ...chfSenderBankTx.filter((t) => t.id >= financeLogPairIds.toKraken.chf.bankTxId),
          ...eurSenderBankTx.filter((t) => t.id >= financeLogPairIds.toKraken.eur.bankTxId),
        ],
        BankTxType.KRAKEN,
      );
      const pendingChfYapealKrakenMinusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        chfReceiverExchangeTx.filter((t) => t.id >= financeLogPairIds.toKraken.chf.exchangeTxId),
        ExchangeTxType.DEPOSIT,
        yapealChfBank.iban,
      );
      const pendingEurYapealKrakenMinusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        eurReceiverExchangeTx.filter((t) => t.id >= financeLogPairIds.toKraken.eur.exchangeTxId),
        ExchangeTxType.DEPOSIT,
        yapealEurBank.iban,
      );

      // Bank to Scrypt //

      // filtered lists
      const pendingBankScryptPlusAmount = isScryptEurAsset
        ? this.getPendingBankAmount(eurBankAssets, recentEurBankToScryptTx, BankTxType.SCRYPT)
        : isEurBankAsset
          ? 0
          : this.getPendingBankAmount(
              [curr],
              [...recentChfYapealScryptTx, ...recentEurBankToScryptTx],
              BankTxType.SCRYPT,
            );
      // With 1:1 matching, matched receivers are already excluded from sender lists — no minus needed
      const pendingChfBankScryptMinusAmount = 0;
      const pendingEurBankScryptMinusAmount = 0;

      // unfiltered lists (1:1 matching)
      const pendingBankScryptPlusAmountUnfiltered = isScryptEurAsset
        ? this.getPendingBankAmount(
            eurBankAssets,
            this.getUnmatchedSenders(
              eurSenderScryptBankTx.filter((t) => t.id >= financeLogPairIds?.toScrypt?.eur?.bankTxId),
              eurReceiverScryptExchangeTx.filter((t) => t.id >= financeLogPairIds?.toScrypt?.eur?.exchangeTxId),
            ),
            BankTxType.SCRYPT,
          )
        : isEurBankAsset
          ? 0
          : this.getPendingBankAmount(
              [curr],
              [
                ...this.getUnmatchedSenders(
                  chfSenderScryptBankTx.filter((t) => t.id >= financeLogPairIds?.toScrypt?.chf?.bankTxId),
                  chfReceiverScryptExchangeTx.filter((t) => t.id >= financeLogPairIds?.toScrypt?.chf?.exchangeTxId),
                ),
                ...this.getUnmatchedSenders(
                  eurSenderScryptBankTx.filter((t) => t.id >= financeLogPairIds?.toScrypt?.eur?.bankTxId),
                  eurReceiverScryptExchangeTx.filter((t) => t.id >= financeLogPairIds?.toScrypt?.eur?.exchangeTxId),
                ),
              ],
              BankTxType.SCRYPT,
            );
      const pendingChfBankScryptMinusAmountUnfiltered = 0;
      const pendingEurBankScryptMinusAmountUnfiltered = 0;

      // Scrypt to Bank //

      // filtered lists
      const pendingChfScryptBankPlusAmount = this.getPendingBankAmount(
        [curr],
        recentChfScryptYapealTx,
        ExchangeTxType.WITHDRAWAL,
        yapealChfBank.iban,
      );
      const pendingEurScryptBankPlusAmount = isScryptEurAsset
        ? this.getPendingBankAmount([curr], recentEurScryptToBankTx, ExchangeTxType.WITHDRAWAL)
        : isEurBankAsset
          ? 0
          : this.getPendingBankAmount([curr], recentEurScryptToBankTx, ExchangeTxType.WITHDRAWAL, yapealEurBank.iban);
      const pendingScryptBankMinusAmount = 0;

      // unfiltered lists (1:1 matching)
      const pendingChfScryptBankPlusAmountUnfiltered = financeLogPairIds?.fromScrypt?.chf?.exchangeTxId
        ? this.getPendingBankAmount(
            [curr],
            this.getUnmatchedSenders(
              chfSenderScryptExchangeTx.filter((t) => t.id >= financeLogPairIds.fromScrypt.chf.exchangeTxId),
              chfReceiverScryptBankTx.filter((t) => t.id >= financeLogPairIds.fromScrypt.chf.bankTxId),
            ),
            ExchangeTxType.WITHDRAWAL,
            yapealChfBank.iban,
          )
        : 0;
      const pendingEurScryptBankPlusAmountUnfiltered = isScryptEurAsset
        ? financeLogPairIds?.fromScrypt?.eur?.exchangeTxId
          ? this.getPendingBankAmount(
              [curr],
              this.getUnmatchedSenders(
                eurSenderScryptExchangeTx.filter((t) => t.id >= financeLogPairIds.fromScrypt.eur.exchangeTxId),
                eurReceiverScryptBankTx.filter((t) => t.id >= financeLogPairIds.fromScrypt.eur.bankTxId),
              ),
              ExchangeTxType.WITHDRAWAL,
            )
          : 0
        : isEurBankAsset
          ? 0
          : financeLogPairIds?.fromScrypt?.eur?.exchangeTxId
            ? this.getPendingBankAmount(
                [curr],
                this.getUnmatchedSenders(
                  eurSenderScryptExchangeTx.filter((t) => t.id >= financeLogPairIds.fromScrypt.eur.exchangeTxId),
                  eurReceiverScryptBankTx.filter((t) => t.id >= financeLogPairIds.fromScrypt.eur.bankTxId),
                ),
                ExchangeTxType.WITHDRAWAL,
                yapealEurBank.iban,
              )
            : 0;
      const pendingScryptBankMinusAmountUnfiltered = 0;

      const fromKrakenUnfiltered =
        pendingChfKrakenYapealPlusAmountUnfiltered +
        pendingEurKrakenYapealPlusAmountUnfiltered +
        pendingKrakenYapealMinusAmountUnfiltered;
      const toKrakenUnfiltered =
        pendingYapealKrakenPlusAmountUnfiltered +
        pendingChfYapealKrakenMinusAmountUnfiltered +
        pendingEurYapealKrakenMinusAmountUnfiltered;

      let fromKraken =
        pendingChfKrakenYapealPlusAmount + pendingEurKrakenYapealPlusAmount + pendingKrakenYapealMinusAmount;
      let toKraken =
        pendingYapealKrakenPlusAmount + pendingChfYapealKrakenMinusAmount + pendingEurYapealKrakenMinusAmount;

      let fromScrypt = pendingChfScryptBankPlusAmount + pendingEurScryptBankPlusAmount + pendingScryptBankMinusAmount;
      let toScrypt = pendingBankScryptPlusAmount + pendingChfBankScryptMinusAmount + pendingEurBankScryptMinusAmount;

      const fromScryptUnfiltered =
        pendingChfScryptBankPlusAmountUnfiltered +
        pendingEurScryptBankPlusAmountUnfiltered +
        pendingScryptBankMinusAmountUnfiltered;
      const toScryptUnfiltered =
        pendingBankScryptPlusAmountUnfiltered +
        pendingChfBankScryptMinusAmountUnfiltered +
        pendingEurBankScryptMinusAmountUnfiltered;

      // getAssetLog only ever sees Asset entities, never Fiat entities, so amountType(curr) (an
      // instanceof-Fiat check) can never resolve to FIAT here. The financialType-based helper below
      // (also used for rounding, see getBalancesByFinancialType) is this log's established way to tell
      // EUR/USD/CHF-denominated bank positions apart from priced crypto assets.
      const reportTolerance =
        this.financialTypeAmountType(curr.financialType) === AmountType.FIAT
          ? BALANCE_TOLERANCE
          : ASSET_BALANCE_TOLERANCE;

      const errors = [];

      // Float-summation residues from aggregating large pending amounts (bank/exchange legs) can leave
      // sub-cent differences between filtered and unfiltered sums, or nudge a balance minimally negative.
      // Only material deviations (beyond reportTolerance) indicate a real reconciliation anomaly; the
      // clamp to 0 below still applies to every negative value, regardless of whether it gets reported.
      if (Math.abs(fromKraken - fromKrakenUnfiltered) > reportTolerance) {
        errors.push(`fromKraken !== fromKrakenUnfiltered`);
        this.logger
          .verbose(`Error in financial log, fromKraken balance !== fromKrakenUnfiltered balance for asset: ${curr.id}, fromKrakenAmount:
        ${fromKraken}, fromKrakenUnfilteredAmount: ${fromKrakenUnfiltered}`);
      }

      if (Math.abs(toKraken - toKrakenUnfiltered) > reportTolerance) {
        errors.push(`toKraken !== toKrakenUnfiltered`);
        this.logger
          .verbose(`Error in financial log, toKraken balance !== toKrakenUnfiltered balance for asset: ${curr.id}, toKrakenAmount:
        ${toKraken}, toKrakenUnfilteredAmount: ${toKrakenUnfiltered}`);
      }

      if (Math.abs(fromScrypt - fromScryptUnfiltered) > reportTolerance) {
        errors.push(`fromScrypt !== fromScryptUnfiltered`);
        this.logger.verbose(
          `Error in financial log, fromScrypt balance !== fromScryptUnfiltered balance for asset: ${curr.id}, fromScryptAmount: ${fromScrypt}, fromScryptUnfilteredAmount: ${fromScryptUnfiltered}`,
        );
      }

      if (Math.abs(toScrypt - toScryptUnfiltered) > reportTolerance) {
        errors.push(`toScrypt !== toScryptUnfiltered`);
        this.logger.verbose(
          `Error in financial log, toScrypt balance !== toScryptUnfiltered balance for asset: ${curr.id}, toScryptAmount: ${toScrypt}, toScryptUnfilteredAmount: ${toScryptUnfiltered}`,
        );
      }

      if (fromKraken < 0) {
        if (fromKraken < -reportTolerance) {
          errors.push(`fromKraken < 0`);
          this.logger.verbose(`Error in financial log, fromKraken balance < 0 for asset: ${curr.id}, pendingPlusAmount:
        ${pendingYapealKrakenPlusAmount}, pendingChfMinusAmount: ${pendingChfYapealKrakenMinusAmount},
        pendingEurMinusAmount: ${pendingEurYapealKrakenMinusAmount}`);
        }
        fromKraken = 0;
      }
      if (toKraken < 0) {
        if (toKraken < -reportTolerance) {
          errors.push(`toKraken < 0`);
          this.logger.verbose(
            `Error in financial log, toKraken balance < 0 for asset: ${curr.id}, pendingPlusAmount:
          ${pendingYapealKrakenPlusAmount}, pendingChfMinusAmount: ${pendingChfYapealKrakenMinusAmount},
          pendingEurMinusAmount: ${pendingEurYapealKrakenMinusAmount}`,
          );
        }
        toKraken = 0;
      }

      if (toScrypt < 0) {
        if (toScrypt < -reportTolerance) {
          errors.push(`toScrypt < 0`);
          this.logger.verbose(
            `Error in financial log, toScrypt balance < 0 for asset: ${curr.id}, pendingPlusAmount:
          ${pendingBankScryptPlusAmount}, pendingChfMinusAmount: ${pendingChfBankScryptMinusAmount},
          pendingEurMinusAmount: ${pendingEurBankScryptMinusAmount}`,
          );
        }
        toScrypt = 0;
      }

      if (fromScrypt < 0) {
        if (fromScrypt < -reportTolerance) {
          errors.push(`fromScrypt < 0`);
          this.logger.verbose(
            `Error in financial log, fromScrypt balance < 0 for asset: ${curr.id}, pendingChfPlusAmount:
          ${pendingChfScryptBankPlusAmount}, pendingEurPlusAmount: ${pendingEurScryptBankPlusAmount},
          pendingMinusAmount: ${pendingScryptBankMinusAmount}`,
          );
        }
        fromScrypt = 0;
      }

      // total pending balance
      let totalPlusPending =
        cryptoInput +
        exchangeOrder +
        bridgeOrder +
        pendingInternalBankAmount +
        (useUnfilteredTx ? fromKrakenUnfiltered : fromKraken) +
        (useUnfilteredTx ? toKrakenUnfiltered : toKraken) +
        (useUnfilteredTx ? fromScryptUnfiltered : fromScrypt) +
        (useUnfilteredTx ? toScryptUnfiltered : toScrypt);

      // Clamp totalPlusPending to prevent negative plus balances
      // This catches any negative values from unfiltered Kraken/Scrypt or other components
      if (totalPlusPending < 0) {
        if (totalPlusPending < -reportTolerance) {
          errors.push(`totalPlusPending < 0`);
          this.logger.verbose(
            `Error in financial log, totalPlusPending < 0 for asset: ${curr.id}, totalPlusPending: ${totalPlusPending}. ` +
              `Components: cryptoInput=${cryptoInput}, exchangeOrder=${exchangeOrder}, bridgeOrder=${bridgeOrder}, ` +
              `internal=${pendingInternalBankAmount}, kraken=${useUnfilteredTx ? fromKrakenUnfiltered : fromKraken}+${useUnfilteredTx ? toKrakenUnfiltered : toKraken}, ` +
              `scrypt=${useUnfilteredTx ? fromScryptUnfiltered : fromScrypt}+${useUnfilteredTx ? toScryptUnfiltered : toScrypt}`,
          );
        }
        totalPlusPending = 0;
      }

      const totalPlus = liquidity + totalPlusPending + (totalCustomBalance ?? 0);

      // minus
      const manualDebtPosition = manualDebtPositions.find((p) => p.assetId === curr.id)?.value ?? 0;

      const { input: buyFiat, output: buyFiatPass } = this.getPendingAmounts([curr], pendingBuyFiat);

      // fail-closed regression tripwire for the settlement-anchored sell liability (see BuyFiat.pendingOutputAmount).
      // Runs only for bank assets, where transmitted-but-unsettled payouts must remain counted in buyFiatPass.
      if (curr.bank != null) {
        // independent re-computation of the liability that MUST be present for transmitted-but-unsettled payouts —
        // deliberately NOT routed through pendingOutputAmount, so a re-introduced early drop cannot hide here too
        const transmittedUnsettledTxs = pendingBuyFiat.filter(
          (tx) =>
            tx.outputAmount &&
            tx.fiatOutput?.bank?.name === curr.bank?.name &&
            curr.dexName === tx.sell?.fiat?.name &&
            tx.fiatOutput?.isTransmittedDate &&
            !tx.fiatOutput?.outputDate,
        );
        const transmittedUnsettled = transmittedUnsettledTxs.reduce((sum, tx) => sum + tx.outputAmount, 0);

        // Deliberately escalates to error (vs this method's existing verbose anomalies): a missing liability
        // silently overstates equity, so this must never fire in normal operation and signals a code regression.
        // If the transmitted-unsettled liability is missing from buyFiatPass, a code change has re-introduced a
        // premature (transmit-time) drop that silently overstates equity -> alarm loudly instead of emitting a wrong total.
        if (transmittedUnsettled - buyFiatPass > BALANCE_TOLERANCE) {
          this.logger.error(
            `FinanceLog liability suppression on asset ${curr.id} (${curr.bank?.name}/${curr.dexName}): ` +
              `transmitted-unsettled payouts ${transmittedUnsettled} exceed counted buyFiatPass ${buyFiatPass}`,
          );
        }

        // settlement-SLA tripwire: a transmitted payout that never settles would keep a liability forever ->
        // surface it for manual reconciliation rather than carrying a silent phantom. This is an ops-reconciliation
        // signal (equity stays correct while a payout is stuck), so it warns rather than escalating to error.
        const staleTransmitted = transmittedUnsettledTxs
          .filter((tx) => Date.now() - tx.fiatOutput.isTransmittedDate.getTime() > SETTLEMENT_SLA_MS)
          .reduce((sum, tx) => sum + tx.outputAmount, 0);

        if (staleTransmitted > BALANCE_TOLERANCE) {
          this.logger.warn(
            `FinanceLog stale transmitted-unsettled payouts on asset ${curr.id} (${curr.bank?.name}/${curr.dexName}): ` +
              `${staleTransmitted} past settlement SLA (${SETTLEMENT_SLA_HOURS}h)`,
          );
        }
      }

      const { input: buyCrypto, output: buyCryptoPass } = this.getPendingAmounts([curr], filteredPendingBuyCrypto);

      const bankTxNull = this.getPendingAmounts(
        [curr],
        pendingBankTx.filter((b) => !b.type),
      ).input;
      const bankTxPending = this.getPendingAmounts(
        [curr],
        pendingBankTx.filter((b) => b.type === BankTxType.PENDING),
      ).input;
      const bankTxUnknown = this.getPendingAmounts(
        [curr],
        pendingBankTx.filter((b) => b.type === BankTxType.UNKNOWN),
      ).input;
      const bankTxGSheet = this.getPendingAmounts(
        [curr],
        pendingBankTx.filter((b) => b.type === BankTxType.GSHEET),
      ).input;

      const bankTxRepeat = this.getPendingAmounts([curr], pendingBankTxRepeat).input;
      const bankTxReturn = this.getPendingAmounts([curr], pendingBankTxReturn).input;

      const totalMinusPending =
        buyFiat +
        buyFiatPass +
        buyCrypto +
        buyCryptoPass +
        bankTxNull +
        bankTxPending +
        bankTxUnknown +
        bankTxGSheet +
        bankTxRepeat +
        bankTxReturn;
      const totalMinus = manualDebtPosition + totalMinusPending;

      prev[curr.id] = {
        priceChf: curr.approxPriceChf,
        plusBalance: {
          total: this.getJsonValue(totalPlus, amountType(curr), true, true),
          liquidity: liquidity
            ? {
                total: this.getJsonValue(liquidity, amountType(curr), true, true),
                liquidityBalance: curr.balance?.amount
                  ? {
                      total: this.getJsonValue(curr.balance?.amount, amountType(curr), false, true),
                      [liqAddress]: liqAddress
                        ? this.getJsonValue(curr.balance?.amount, amountType(curr), false, true)
                        : undefined,
                    }
                  : undefined,
                paymentDepositBalance: paymentDepositBalance
                  ? { total: this.getJsonValue(paymentDepositBalance, amountType(curr)) }
                  : undefined,
                manualLiqPosition: manualLiqPosition
                  ? { total: this.getJsonValue(manualLiqPosition, amountType(curr), false, true) }
                  : undefined,
              }
            : undefined,
          custom: totalCustomBalance
            ? {
                total: this.getJsonValue(totalCustomBalance, amountType(curr), true),
                ...Util.aggregate(
                  customAddressBalances.map((b) => ({ ...b, balance: this.getJsonValue(b.balance, amountType(curr)) })),
                  'owner',
                  'balance',
                ),
              }
            : undefined,
          pending: totalPlusPending
            ? {
                total: this.getJsonValue(totalPlusPending, amountType(curr), true),
                cryptoInput: this.getJsonValue(cryptoInput, amountType(curr)),
                exchangeOrder: this.getJsonValue(exchangeOrder, amountType(curr)),
                bridgeOrder: this.getJsonValue(bridgeOrder, amountType(curr)),
                internal: this.getJsonValue(pendingInternalBankAmount, amountType(curr)),
                fromKraken: this.getJsonValue(
                  useUnfilteredTx ? fromKrakenUnfiltered : fromKraken,
                  amountType(curr),
                  false,
                  true,
                ),
                toKraken: this.getJsonValue(
                  useUnfilteredTx ? toKrakenUnfiltered : toKraken,
                  amountType(curr),
                  false,
                  true,
                ),
                fromScrypt: this.getJsonValue(
                  useUnfilteredTx ? fromScryptUnfiltered : fromScrypt,
                  amountType(curr),
                  false,
                  true,
                ),
                toScrypt: this.getJsonValue(
                  useUnfilteredTx ? toScryptUnfiltered : toScrypt,
                  amountType(curr),
                  false,
                  true,
                ),
              }
            : undefined,
          // monitoring: errors.length
          //   ? {
          //       fromKrakenBankTxIds: this.getTxIdMonitoringLog([...eurReceiverBankTx, ...chfReceiverBankTx]),
          //       fromKrakenExchangeTxIds: this.getTxIdMonitoringLog([...chfSenderExchangeTx, ...eurSenderExchangeTx]),
          //       toKrakenBankTxIds: this.getTxIdMonitoringLog([...chfSenderBankTx, ...recentEurYapealKrakenTx]),
          //       toKrakenExchangeTxIds: this.getTxIdMonitoringLog([...chfReceiverExchangeTx, ...eurReceiverExchangeTx]),
          //     }
          //   : undefined,
        },
        minusBalance: {
          // returnNegativeValue like the plus side: a negative minus total (possible via a negative
          // manual debt position) must stay numeric, or the CHF multiplication turns it into NaN
          total: this.getJsonValue(totalMinus, amountType(curr), true, true),
          debt: this.getJsonValue(manualDebtPosition, amountType(curr)),
          pending: totalMinusPending
            ? {
                total: this.getJsonValue(totalMinusPending, amountType(curr), true),
                buyFiat: this.getJsonValue(buyFiat, amountType(curr)),
                buyFiatPass: this.getJsonValue(buyFiatPass, amountType(curr)),
                buyCrypto: this.getJsonValue(buyCrypto, amountType(curr)),
                buyCryptoPass: this.getJsonValue(buyCryptoPass, amountType(curr)),
                bankTxNull: this.getJsonValue(bankTxNull, amountType(curr)),
                bankTxPending: this.getJsonValue(bankTxPending, amountType(curr)),
                bankTxUnknown: this.getJsonValue(bankTxUnknown, amountType(curr)),
                bankTxGSheet: this.getJsonValue(bankTxGSheet, amountType(curr)),
                bankTxRepeat: this.getJsonValue(bankTxRepeat, amountType(curr)),
                bankTxReturn: this.getJsonValue(bankTxReturn, amountType(curr)),
              }
            : undefined,
        },
        // error: errors.length ? errors.join(';') : undefined,
      };

      return prev;
    }, {});
  }

  private async getChangeLog(): Promise<ChangeLog> {
    const firstDayOfMonth = Util.firstDayOfMonth();

    // plus amounts
    const buyFiats = await this.buyFiatService.getBuyFiat(firstDayOfMonth, {
      cryptoInput: { paymentLinkPayment: true },
    });
    const buyCryptos = await this.buyCryptoService.getBuyCrypto(firstDayOfMonth, {
      cryptoInput: { paymentLinkPayment: true },
    });
    const { fee: tradingOrderFee, profit: tradingOrderProfit } =
      await this.tradingOrderService.getTradingOrderYield(firstDayOfMonth);

    const buyFiatFee = this.getFeeAmount(buyFiats.filter((b) => !b.cryptoInput.paymentLinkPayment));
    const paymentLinkFee = this.getFeeAmount([
      ...buyFiats.filter((p) => p.cryptoInput.paymentLinkPayment),
      ...buyCryptos.filter((p) => p.cryptoInput?.paymentLinkPayment),
    ]);
    const buyCryptoFee = this.getFeeAmount(buyCryptos.filter((b) => !b.cryptoInput?.paymentLinkPayment));

    // minus amounts
    const exchangeTx = await this.exchangeTxService.getExchangeTx(firstDayOfMonth);
    const payoutOrders = await this.payoutService.getPayoutOrders(firstDayOfMonth);

    const bankTxFee = await this.bankTxService.getBankTxFee(firstDayOfMonth);
    const krakenTxWithdrawFee = this.getFeeAmount(
      exchangeTx.filter((e) => e.exchange === ExchangeName.KRAKEN && e.type === ExchangeTxType.WITHDRAWAL),
    );
    const krakenTxTradingFee = this.getFeeAmount(
      exchangeTx.filter((e) => e.exchange === ExchangeName.KRAKEN && e.type === ExchangeTxType.TRADE),
    );
    const binanceTxWithdrawFee = this.getFeeAmount(
      exchangeTx.filter((e) => e.exchange === ExchangeName.BINANCE && e.type === ExchangeTxType.WITHDRAWAL),
    );
    const binanceTxTradingFee = this.getFeeAmount(
      exchangeTx.filter((e) => e.exchange === ExchangeName.BINANCE && e.type === ExchangeTxType.TRADE),
    );
    const scryptTxWithdrawFee = this.getFeeAmount(
      exchangeTx.filter((e) => e.exchange === ExchangeName.SCRYPT && e.type === ExchangeTxType.WITHDRAWAL),
    );
    const scryptTxTradingFee = this.getFeeAmount(
      exchangeTx.filter((e) => e.exchange === ExchangeName.SCRYPT && e.type === ExchangeTxType.TRADE),
    );
    const mexcTxWithdrawFee = this.getFeeAmount(
      exchangeTx.filter((e) => e.exchange === ExchangeName.MEXC && e.type === ExchangeTxType.WITHDRAWAL),
    );
    const mexcTxTradingFee = this.getFeeAmount(
      exchangeTx.filter((e) => e.exchange === ExchangeName.MEXC && e.type === ExchangeTxType.TRADE),
    );
    const cryptoInputFee = await this.payInService.getPayInFee(firstDayOfMonth);
    const refRewards = await this.refRewardService.getRefRewardVolume(firstDayOfMonth);
    const payoutOrderRefFee = this.getFeeAmount(
      payoutOrders.filter((p) => p.context === PayoutOrderContext.REF_PAYOUT),
    );
    const payoutOrderFee = this.getFeeAmount(payoutOrders.filter((p) => p.context !== PayoutOrderContext.REF_PAYOUT));

    const totalKrakenFee = krakenTxWithdrawFee + krakenTxTradingFee;
    const totalBinanceFee = binanceTxWithdrawFee + binanceTxTradingFee;
    const totalScryptFee = scryptTxWithdrawFee + scryptTxTradingFee;
    const totalMexcFee = mexcTxWithdrawFee + mexcTxTradingFee;

    const totalRefReward = refRewards + payoutOrderRefFee;
    const totalTxFee = cryptoInputFee + payoutOrderFee;
    const totalBlockchainFee = totalTxFee + tradingOrderFee;

    // total amounts
    const totalPlus = buyCryptoFee + buyFiatFee + paymentLinkFee + tradingOrderProfit;
    const totalMinus =
      bankTxFee +
      totalKrakenFee +
      totalBinanceFee +
      totalScryptFee +
      totalMexcFee +
      totalRefReward +
      totalBlockchainFee;

    return {
      total: totalPlus - totalMinus,
      plus: {
        total: totalPlus,
        buyCrypto: buyCryptoFee || undefined,
        buyFiat: buyFiatFee || undefined,
        paymentLink: paymentLinkFee || undefined,
        trading: tradingOrderProfit || undefined,
      },
      minus: {
        total: totalMinus,
        bank: bankTxFee || undefined,
        kraken: totalKrakenFee
          ? {
              total: totalKrakenFee,
              withdraw: krakenTxWithdrawFee || undefined,
              trading: krakenTxTradingFee || undefined,
            }
          : undefined,
        binance: totalBinanceFee
          ? {
              total: totalBinanceFee,
              withdraw: binanceTxWithdrawFee || undefined,
              trading: binanceTxTradingFee || undefined,
            }
          : undefined,
        scrypt: totalScryptFee
          ? {
              total: totalScryptFee,
              withdraw: scryptTxWithdrawFee || undefined,
              trading: scryptTxTradingFee || undefined,
            }
          : undefined,
        mexc: totalMexcFee
          ? {
              total: totalMexcFee,
              withdraw: mexcTxWithdrawFee || undefined,
              trading: mexcTxTradingFee || undefined,
            }
          : undefined,
        blockchain: totalBlockchainFee
          ? {
              total: totalBlockchainFee,
              tx: totalTxFee
                ? {
                    total: totalTxFee,
                    in: cryptoInputFee || undefined,
                    out: payoutOrderFee || undefined,
                  }
                : undefined,
              trading: tradingOrderFee || undefined,
              lm: undefined,
            }
          : undefined,
        ref: totalRefReward
          ? {
              total: totalRefReward,
              amount: refRewards || undefined,
              fee: payoutOrderRefFee || undefined,
            }
          : undefined,
      },
    };
  }

  // --- HELPER METHODS --- //

  private getTxIdMonitoringLog(tx: (BankTx | ExchangeTx)[]): string | undefined {
    return tx.length ? tx.map((t) => t.id).join(';') : undefined;
  }

  private getFeeAmount(
    tx: (BuyCrypto | BuyFiat | BankTx | ExchangeTx | RefReward | TradingOrder | CryptoInput | PayoutOrder)[],
  ): number {
    return tx.reduce((sum, tx) => sum + (tx.feeAmountChf ?? 0), 0);
  }

  private getPendingAmounts(
    assets: Asset[],
    pendingTx: (BuyCrypto | BuyFiat | BankTx | BankTxReturn | BankTxRepeat)[],
  ): { input: number; output: number } {
    return {
      input: assets.reduce(
        (prev, curr) => prev + pendingTx.reduce((sum, tx) => sum + tx.pendingInputAmount(curr), 0),
        0,
      ),
      output: assets.reduce(
        (prev, curr) => prev + pendingTx.reduce((sum, tx) => sum + tx.pendingOutputAmount(curr), 0),
        0,
      ),
    };
  }

  private getPendingBankAmount(
    assets: Asset[],
    pendingTx: (BankTx | ExchangeTx)[],
    type: BankExchangeType,
    source?: string,
    target?: string,
  ): number {
    return assets.reduce(
      (prev, curr) => prev + pendingTx.reduce((sum, tx) => sum + tx.pendingBankAmount(curr, type, source, target), 0),
      0,
    );
  }

  private getUnsettledInternalBankTx(transactions: BankTx[]): BankTx[] {
    const debits = transactions
      .filter((tx) => tx.creditDebitIndicator === BankTxIndicator.DEBIT)
      .sort((a, b) => this.getInternalTransferTime(a) - this.getInternalTransferTime(b) || a.id - b.id);
    const availableCredits = new Set(transactions.filter((tx) => tx.creditDebitIndicator === BankTxIndicator.CREDIT));
    const unsettled = new Set(debits);

    const settleUnique = (
      predicate: (debit: BankTx, credit: BankTx) => boolean,
      enforceSettlementWindow = true,
    ): void => {
      let settledInPass: boolean;

      do {
        settledInPass = false;

        for (const debit of [...unsettled]) {
          const matchingCredits = [...availableCredits].filter(
            (credit) =>
              this.isInternalTransferCounterEntry(debit, credit, enforceSettlementWindow) && predicate(debit, credit),
          );
          if (matchingCredits.length !== 1) continue;

          const [credit] = matchingCredits;
          const matchingDebits = [...unsettled].filter(
            (candidate) =>
              this.isInternalTransferCounterEntry(candidate, credit, enforceSettlementWindow) &&
              predicate(candidate, credit),
          );
          if (matchingDebits.length !== 1) continue;

          unsettled.delete(debit);
          availableCredits.delete(credit);
          settledInPass = true;
        }
      } while (settledInPass);
    };

    // Stable end-to-end IDs are stronger than free-text remittance information.
    settleUnique((debit, credit) => {
      const debitReference = this.getInternalEndToEndId(debit);
      return Boolean(debitReference) && debitReference === this.getInternalEndToEndId(credit);
    }, false);

    settleUnique((debit, credit) => {
      const debitReference = this.getInternalRemittanceInfo(debit);
      return (
        !this.hasConflictingInternalEndToEndIds(debit, credit) &&
        Boolean(debitReference) &&
        debitReference === this.getInternalRemittanceInfo(credit)
      );
    });

    // Same-currency entries are interchangeable for the aggregate plus balance when their
    // fee-adjusted principals agree to half a cent. A maximum matching safely handles repeated
    // equal transfers and partial arrival without guessing a different remaining amount.
    const sameCurrencyMatches = this.getMaximumInternalTransferMatches(
      [...unsettled],
      [...availableCredits],
      (debit, credit) => {
        if (this.hasConflictingInternalEndToEndIds(debit, credit)) return false;
        if (!debit.currency || debit.currency !== credit.currency) return false;
        const debitAmount = debit.internalTransferAmount();
        const creditAmount = credit.internalTransferAmount();
        if (typeof debitAmount !== 'number' || typeof creditAmount !== 'number') return false;
        return (
          Number.isFinite(debitAmount) && Number.isFinite(creditAmount) && Math.abs(debitAmount - creditAmount) < 0.005
        );
      },
    );
    for (const [credit, debit] of sameCurrencyMatches) {
      unsettled.delete(debit);
      availableCredits.delete(credit);
    }

    const settleSafeFxGroups = (predicate: (debit: BankTx, credit: BankTx) => boolean): void => {
      const visitedDebits = new Set<BankTx>();
      const visitedCredits = new Set<BankTx>();

      for (const startDebit of [...unsettled]) {
        if (visitedDebits.has(startDebit)) continue;

        const componentDebits = new Set<BankTx>();
        const componentCredits = new Set<BankTx>();
        const debitQueue = [startDebit];

        while (debitQueue.length) {
          const debit = debitQueue.shift();
          if (!debit || visitedDebits.has(debit)) continue;
          visitedDebits.add(debit);
          componentDebits.add(debit);

          for (const credit of availableCredits) {
            if (!this.isInternalTransferCounterEntry(debit, credit) || !predicate(debit, credit)) continue;
            componentCredits.add(credit);
            if (visitedCredits.has(credit)) continue;
            visitedCredits.add(credit);

            for (const candidateDebit of unsettled) {
              if (
                !visitedDebits.has(candidateDebit) &&
                this.isInternalTransferCounterEntry(candidateDebit, credit) &&
                predicate(candidateDebit, credit)
              )
                debitQueue.push(candidateDebit);
            }
          }
        }

        if (!componentCredits.size) continue;

        const matches = this.getMaximumInternalTransferMatches([...componentDebits], [...componentCredits], predicate);
        const principals = [...componentDebits].map((debit) => debit.internalTransferAmount());
        const firstPrincipal = principals[0];
        const equalPrincipals =
          typeof firstPrincipal === 'number' &&
          principals.every(
            (principal) => typeof principal === 'number' && Math.abs(principal - firstPrincipal) < 0.005,
          );

        if (new Set(matches.values()).size !== componentDebits.size && !equalPrincipals) continue;

        for (const [credit, debit] of matches) {
          unsettled.delete(debit);
          availableCredits.delete(credit);
        }
      }
    };

    // Optional ISO amount details can identify a partial FX arrival without being used for
    // per-account attribution. A connected group is settled only if fully covered or if all
    // source principals are equal, so an ambiguous partial arrival cannot change plus balance.
    settleSafeFxGroups((debit, credit) => {
      if (this.hasConflictingInternalEndToEndIds(debit, credit)) return false;
      if (!debit.currency || !credit.currency || debit.currency === credit.currency) return false;
      const creditAmount = credit.internalTransferAmount();
      if (typeof creditAmount !== 'number' || !Number.isFinite(creditAmount)) return false;

      return this.getInternalTargetAmounts(debit).some(
        ({ amount, currency }) => currency === credit.currency && Math.abs(amount - creditAmount) < 0.005,
      );
    });

    // FX amounts are incomparable. Settle a connected candidate group only when every debit is
    // covered, or when every debit principal is equal and the remaining aggregate is independent
    // of which individual transfer arrived.
    settleSafeFxGroups(
      (debit, credit) =>
        !this.hasConflictingInternalEndToEndIds(debit, credit) &&
        Boolean(debit.currency && credit.currency && debit.currency !== credit.currency),
    );

    return debits.filter((debit) => unsettled.has(debit));
  }

  private getMaximumInternalTransferMatches(
    debits: BankTx[],
    credits: BankTx[],
    predicate: (debit: BankTx, credit: BankTx) => boolean,
  ): Map<BankTx, BankTx> {
    const matches = new Map<BankTx, BankTx>();

    const assign = (debit: BankTx, visited: Set<BankTx>): boolean => {
      const candidates = credits
        .filter((credit) => this.isInternalTransferCounterEntry(debit, credit) && predicate(debit, credit))
        .sort(
          (a, b) =>
            Math.abs(this.getInternalTransferTime(a) - this.getInternalTransferTime(debit)) -
              Math.abs(this.getInternalTransferTime(b) - this.getInternalTransferTime(debit)) || a.id - b.id,
        );

      for (const credit of candidates) {
        if (visited.has(credit)) continue;
        visited.add(credit);

        const currentDebit = matches.get(credit);
        if (!currentDebit || assign(currentDebit, visited)) {
          matches.set(credit, debit);
          return true;
        }
      }

      return false;
    };

    for (const debit of debits) assign(debit, new Set());
    return matches;
  }

  private isInternalTransferCounterEntry(debit: BankTx, credit: BankTx, enforceSettlementWindow = true): boolean {
    const sourceIban = BankService.normalizeIban(debit.accountIban);
    const targetIban = BankService.normalizeIban(debit.iban);
    if (!sourceIban || !targetIban) return false;
    if (sourceIban !== BankService.normalizeIban(credit.iban)) return false;
    if (targetIban !== BankService.normalizeIban(credit.accountIban)) return false;

    const timeDifference = this.getInternalTransferTime(credit) - this.getInternalTransferTime(debit);
    return (
      timeDifference >= -24 * 60 * 60 * 1000 &&
      (!enforceSettlementWindow || timeDifference <= INTERNAL_TRANSFER_SETTLEMENT_WINDOW_MS)
    );
  }

  private getInternalTargetAmounts(tx: BankTx): { amount: number; currency: string }[] {
    return [
      { amount: tx.instructedAmount, currency: tx.instructedCurrency },
      { amount: tx.txAmount, currency: tx.txCurrency },
    ].filter(
      (entry): entry is { amount: number; currency: string } =>
        typeof entry.amount === 'number' &&
        Number.isFinite(entry.amount) &&
        entry.amount > 0 &&
        Boolean(entry.currency),
    );
  }

  private getInternalEndToEndId(tx: BankTx): string | undefined {
    return this.normalizeInternalTransferReference(tx.endToEndId);
  }

  private getInternalRemittanceInfo(tx: BankTx): string | undefined {
    return this.normalizeInternalTransferReference(tx.remittanceInfo);
  }

  private hasConflictingInternalEndToEndIds(debit: BankTx, credit: BankTx): boolean {
    const debitReference = this.getInternalEndToEndId(debit);
    const creditReference = this.getInternalEndToEndId(credit);
    return Boolean(debitReference && creditReference && debitReference !== creditReference);
  }

  private normalizeInternalTransferReference(reference: string | null | undefined): string | undefined {
    const normalized = reference?.trim().toLowerCase().replace(/\s+/g, ' ');
    return normalized && !['notprovided', 'not provided', 'n/a', 'unknown'].includes(normalized)
      ? normalized
      : undefined;
  }

  private getInternalTransferTime(tx: BankTx): number {
    return (tx.valueDate ?? tx.bookingDate ?? tx.created)?.getTime() ?? 0;
  }

  public getUnmatchedSenders(
    senderTx: (BankTx | ExchangeTx)[],
    receiverTx: (BankTx | ExchangeTx)[],
  ): (BankTx | ExchangeTx)[] {
    const before7Days = Util.daysBefore(7);
    const recentSenders = senderTx.filter((s) => s.created > before7Days);

    if (!recentSenders.length || !receiverTx.length) return [...recentSenders];

    // Pass 1 — reference matching (unchanged): retire senders whose reference is present on a receiver.
    const receiverRefs = new Set<string>();
    for (const r of receiverTx) {
      const ref = this.getTxReference(r);
      if (ref) receiverRefs.add(ref);
    }

    // A receiver counts as consumed as soon as its reference matches ANY known sender, including
    // senders that already dropped out of the 7-day reporting window. Deriving this from the recent
    // senders alone would let a receiver whose own sender has aged out re-enter the amount+date
    // fallback below and retire an unrelated sender whose money is still genuinely in transit.
    const consumedRefs = new Set<string>();
    for (const sender of senderTx) {
      const ref = this.getTxReference(sender);
      if (ref && receiverRefs.has(ref)) consumedRefs.add(ref);
    }

    const unmatchedByRef = recentSenders.filter((s) => {
      const ref = this.getTxReference(s);
      return !ref || !receiverRefs.has(ref);
    });

    // Pass 2 — amount+date fallback for receivers that are not yet consumed. A receiver counts
    // as consumed as soon as its reference matches ANY known sender in the full senderTx array —
    // regardless of whether that sender is still inside the 7-day recency window and regardless
    // of whether it was the sender actually retired by pass 1. Only truly unconsumed receivers
    // (ref-less OR referenced-but-matching-no-sender) take part in the fallback below.
    // Date window: 7 days in ms — mirrors the existing sender recency window.
    const DATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

    const availableReceivers = receiverTx.filter((r) => {
      const ref = this.getTxReference(r);
      return !ref || !consumedRefs.has(ref);
    });
    if (!unmatchedByRef.length || !availableReceivers.length) return unmatchedByRef;

    // Maximum-cardinality bipartite matching (Kuhn's augmenting-path algorithm).
    // Plain greedy consumption of globally cost-sorted edges can strand a matchable
    // sender: its only in-tolerance receiver may be claimed by another sender with a
    // lower-cost edge to that same receiver, even though a different global assignment
    // would retire both. Kuhn guarantees maximum cardinality; per-sender candidate
    // sort keeps exact/cheap matches preferred when multiple assignments have equal size.
    type SenderCandidate = {
      receiver: BankTx | ExchangeTx;
      amountDiff: number;
      dateDiff: number;
    };

    const candidatesBySender = new Map<BankTx | ExchangeTx, SenderCandidate[]>();

    for (const sender of unmatchedByRef) {
      const senderAmount = this.getTransferAmount(sender);
      const senderCurrency = this.getTransferCurrency(sender);
      const senderDate = this.getTransferDate(sender);

      // null/undefined/NaN amounts must not participate (TypeORM nullable → null at runtime).
      if (!Number.isFinite(senderAmount) || !senderCurrency) continue;

      const senderCandidates: SenderCandidate[] = [];

      for (const receiver of availableReceivers) {
        const receiverAmount = this.getTransferAmount(receiver);
        const receiverCurrency = this.getTransferCurrency(receiver);
        const receiverDate = this.getTransferDate(receiver);

        if (!Number.isFinite(receiverAmount) || !receiverCurrency) continue;
        if (senderCurrency !== receiverCurrency) continue;

        // Amount tolerance: 1% relative, minimum 1.0 absolute — covers FX/rounding noise
        // between instructed and settled amounts without false matches on similar sizes.
        const amountTolerance = Math.max(1.0, 0.01 * Math.max(Math.abs(senderAmount), Math.abs(receiverAmount)));
        const amountDiff = Math.abs(senderAmount - receiverAmount);
        if (amountDiff > amountTolerance) continue;

        const dateDiff = Math.abs(senderDate.getTime() - receiverDate.getTime());
        if (dateDiff > DATE_WINDOW_MS) continue;

        senderCandidates.push({ receiver, amountDiff, dateDiff });
      }

      if (!senderCandidates.length) continue;

      // Exact/closer matches first for this sender.
      senderCandidates.sort((a, b) => {
        if (a.amountDiff !== b.amountDiff) return a.amountDiff - b.amountDiff;
        if (a.dateDiff !== b.dateDiff) return a.dateDiff - b.dateDiff;
        return a.receiver.id - b.receiver.id;
      });

      candidatesBySender.set(sender, senderCandidates);
    }

    // Senders holding an exact/near-exact match get first crack at claiming it.
    const sendersToProcess = [...candidatesBySender.keys()].sort((a, b) => {
      const bestA = candidatesBySender.get(a)![0];
      const bestB = candidatesBySender.get(b)![0];
      if (bestA.amountDiff !== bestB.amountDiff) return bestA.amountDiff - bestB.amountDiff;
      if (bestA.dateDiff !== bestB.dateDiff) return bestA.dateDiff - bestB.dateDiff;
      return a.id - b.id;
    });

    const matchOfReceiver = new Map<BankTx | ExchangeTx, BankTx | ExchangeTx>();

    const tryAssign = (sender: BankTx | ExchangeTx, visited: Set<BankTx | ExchangeTx>): boolean => {
      for (const { receiver } of candidatesBySender.get(sender)!) {
        if (visited.has(receiver)) continue;
        visited.add(receiver);

        const currentMatch = matchOfReceiver.get(receiver);
        if (!currentMatch || tryAssign(currentMatch, visited)) {
          matchOfReceiver.set(receiver, sender);
          return true;
        }
      }
      return false;
    };

    for (const sender of sendersToProcess) {
      tryAssign(sender, new Set());
    }

    const retiredSenders = new Set(matchOfReceiver.values());

    return unmatchedByRef.filter((s) => !retiredSenders.has(s));
  }

  private getTransferAmount(tx: BankTx | ExchangeTx): number | null | undefined {
    return tx instanceof BankTx ? tx.instructedAmount : tx.amount;
  }

  private getTransferCurrency(tx: BankTx | ExchangeTx): string | undefined {
    const currency = tx instanceof BankTx ? tx.instructedCurrency : tx.currency;
    return currency || undefined;
  }

  private getTransferDate(tx: BankTx | ExchangeTx): Date {
    return tx instanceof BankTx ? (tx.valueDate ?? tx.created) : (tx.externalCreated ?? tx.created);
  }

  private getTxReference(tx: BankTx | ExchangeTx): string | undefined {
    const raw = tx instanceof BankTx ? tx.remittanceInfo?.trim() : tx.txId?.trim();
    if (!raw) return undefined;

    // Automated references start with a letter and carry the payout id as a trailing
    // >= 4 digit run (sender "DFX Payout 81398", receiver "DEPOSIT-81398"/"E2E-81398").
    // Manual references start with a digit (date-style, e.g. "21.05.2026", "12.06.2026.A")
    // and must NOT be parsed as a payout id: their trailing run is a year and would
    // collide across unrelated transfers, silently hiding in-transit money.
    if (/^[a-z]/i.test(raw)) {
      const payoutId = raw.match(/(\d{4,})$/);
      if (payoutId) return payoutId[1];
    }

    // Manual transfers (and any letter-prefixed reference without a trailing payout id)
    // pair on the normalized full reference, which is identical on both sides.
    return raw.toLowerCase().replace(/\s+/g, ' ');
  }

  public filterSenderPendingList(
    senderTx: (BankTx | ExchangeTx)[],
    receiverTx: (BankTx | ExchangeTx)[] | undefined,
  ): { receiver: (BankTx | ExchangeTx)[]; sender: (BankTx | ExchangeTx)[] } {
    const before21Days = Util.daysBefore(21);

    let filtered21SenderTx = senderTx.filter((s) => s.created > before21Days);
    let filtered21ReceiverTx = receiverTx.filter((r) => r.created > before21Days);

    if (!filtered21SenderTx.length) return { receiver: [], sender: [] };
    if (!filtered21ReceiverTx?.length) {
      return {
        sender: filtered21SenderTx,
        receiver: [],
      };
    }

    const { senderPair, receiverIndex } = this.findSenderReceiverPair(filtered21SenderTx, filtered21ReceiverTx);

    if (filtered21SenderTx[0] instanceof BankTx) {
      this.logger.verbose(
        `FinanceLog receiverTxId/date: ${filtered21ReceiverTx?.[receiverIndex]?.id}/${filtered21ReceiverTx?.[
          receiverIndex
        ]?.created.toDateString()}; senderTx[0] id/date: ${
          filtered21SenderTx[0]?.id
        }/${filtered21SenderTx[0].valueDate.toDateString()}; senderPair id/date: ${senderPair?.id}/${
          senderPair && senderPair instanceof BankTx
            ? senderPair.valueDate.toDateString()
            : senderPair?.created.toDateString()
        }; senderTx length: ${filtered21SenderTx.length}`,
      );
    }

    filtered21SenderTx = senderPair ? filtered21SenderTx.filter((s) => s.id >= senderPair.id) : filtered21SenderTx;

    if (filtered21ReceiverTx.length > filtered21SenderTx.length) {
      const { senderPair } = this.findSenderReceiverPair(filtered21SenderTx, filtered21ReceiverTx, true);

      const senderTxLength = senderPair
        ? filtered21SenderTx.filter((s) => s.id <= senderPair.id).length
        : filtered21ReceiverTx.length;

      filtered21ReceiverTx = filtered21ReceiverTx.slice(filtered21ReceiverTx.length - senderTxLength);
    }

    return {
      receiver: filtered21ReceiverTx.filter((r) => r.id >= (filtered21ReceiverTx[receiverIndex]?.id ?? 0)),
      sender: filtered21SenderTx.sort((a, b) => a.id - b.id),
    };
  }

  private findSenderReceiverPair(
    senderTx: (BankTx | ExchangeTx)[],
    receiverTx: (BankTx | ExchangeTx)[] | undefined,
    reverseSearch = false,
  ): { senderPair: BankTx | ExchangeTx; receiverIndex: number } {
    if (!receiverTx.length) return { receiverIndex: undefined, senderPair: undefined };

    if ((senderTx[0] instanceof BankTx && !reverseSearch) || (!(senderTx[0] instanceof BankTx) && reverseSearch)) {
      senderTx.sort((a, b) => a.id - b.id);
    } else {
      senderTx.sort((a, b) => b.id - a.id);
    }

    if (!reverseSearch) {
      receiverTx.sort((a, b) => a.id - b.id);
    } else {
      receiverTx.sort((a, b) => b.id - a.id);
    }

    let receiverIndex = 0;

    do {
      const receiverAmount =
        receiverTx[receiverIndex] instanceof BankTx
          ? (receiverTx[receiverIndex] as BankTx).instructedAmount
          : receiverTx[receiverIndex].amount;

      const senderPair = senderTx.find((s) => {
        const receiverCreated = receiverTx[receiverIndex].created;
        const senderDate = s instanceof BankTx ? s.valueDate : s.created;
        const daysDiff = Math.abs(Util.daysDiff(senderDate, receiverCreated));

        return s instanceof BankTx
          ? s.instructedAmount === receiverAmount && daysDiff <= 5 && receiverCreated > s.created
          : s.amount === receiverAmount && receiverCreated > s.created;
      });

      if (!senderPair) {
        receiverIndex++;
      } else {
        if (reverseSearch) {
          if (senderTx[0] instanceof BankTx) {
            senderTx.sort((a, b) => a.id - b.id);
          } else {
            senderTx.sort((a, b) => b.id - a.id);
          }
          receiverTx.sort((a, b) => a.id - b.id);
        }

        return { senderPair, receiverIndex };
      }
    } while (receiverTx.length > receiverIndex);

    return { receiverIndex: undefined, senderPair: undefined };
  }

  private async getCustomBalances(
    client: BlockchainClient,
    assets: Asset[],
    addresses: string[],
  ): Promise<BlockchainTokenBalance[][]> {
    return Util.asyncMap(addresses, (a) => client.getTokenBalances(assets, a));
  }

  private getJsonValue(
    value: number | undefined,
    amountType: AmountType,
    returnZero = false,
    returnNegativeValue = false,
  ): number | undefined {
    return (!returnZero && !value) || (value < 0 && !returnNegativeValue)
      ? undefined
      : Util.roundReadable(value, amountType, 8);
  }

  private financialTypeAmountType(financialType: string): AmountType {
    return ['EUR', 'USD', 'CHF'].includes(financialType) ? AmountType.FIAT : AmountType.ASSET;
  }
}
