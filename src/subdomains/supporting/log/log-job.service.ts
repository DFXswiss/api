import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmTokenBalance } from 'src/integration/blockchain/shared/evm/dto/evm-token-balance.dto';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { ExchangeTxService } from 'src/integration/exchange/services/exchange-tx.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { LiquidityManagementPipelineService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-pipeline.service';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { RefRewardService } from 'src/subdomains/core/referral/reward/ref-reward.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TradingOrder } from 'src/subdomains/core/trading/entities/trading-order.entity';
import { TradingOrderService } from 'src/subdomains/core/trading/services/trading-order.service';
import { TradingRuleService } from 'src/subdomains/core/trading/services/trading-rule.service';
import { BankTxRepeat } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxRepeatService } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturn } from '../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTxReturnService } from '../bank-tx/bank-tx-return/bank-tx-return.service';
import { BankTx, BankTxIndicator, BankTxType } from '../bank-tx/bank-tx/entities/bank-tx.entity';
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
  ManualDebtPosition,
  TradingLog,
} from './dto/log.dto';
import { LogSeverity } from './log.entity';
import { LogService } from './log.service';

@Injectable()
export class LogJobService {
  private readonly logger = new DfxLogger(LogJobService);

  constructor(
    private readonly tradingRuleService: TradingRuleService,
    private readonly assetService: AssetService,
    private readonly liqManagementBalanceService: LiquidityManagementBalanceService,
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
    private readonly evmRegistryService: EvmRegistryService,
    private readonly refRewardService: RefRewardService,
    private readonly tradingOrderService: TradingOrderService,
    private readonly payoutService: PayoutService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async saveTradingLog() {
    if (DisabledProcess(Process.TRADING_LOG)) return;

    // trading log
    const tradingLog = await this.getTradingLog();

    // assets
    const assets = await this.assetService.getAllAssets().then((l) => l.filter((a) => a.type !== AssetType.CUSTOM));

    // asset log
    const assetLog = await this.getAssetLog(assets);

    // balances grouped by financialType
    const balancesByFinancialType = this.getBalancesByFinancialType(assets, assetLog);

    // changes
    //TODO reactivate
    //const changeLog = await this.getChangeLog();

    const plusBalanceChf = Util.sumObjValue(Object.values(balancesByFinancialType), 'plusBalanceChf');
    const minusBalanceChf = Util.sumObjValue(Object.values(balancesByFinancialType), 'minusBalanceChf');

    await this.logService.create({
      system: 'LogService',
      subsystem: 'FinancialDataLog',
      severity: LogSeverity.INFO,
      message: JSON.stringify({
        assets: assetLog,
        tradings: tradingLog,
        balancesByFinancialType,
        balancesTotal: {
          plusBalanceChf: this.getJsonValue(plusBalanceChf, true),
          minusBalanceChf: this.getJsonValue(minusBalanceChf, true),
          totalBalanceChf: plusBalanceChf - minusBalanceChf,
        },
        //TODO reactivate
        //changes: changeLog,
      }),
      valid: null,
      category: null,
    });
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

      acc[financialType] = {
        plusBalance: this.getJsonValue(plusBalance, true),
        plusBalanceChf: this.getJsonValue(plusBalanceChf, true),
        minusBalance: this.getJsonValue(minusBalance, true),
        minusBalanceChf: this.getJsonValue(minusBalanceChf, true),
      };

      return acc;
    }, {});
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
    // custom balance
    const customAssets = assets.filter((a) => Config.financialLog.customAssets?.includes(a.uniqueName));
    const assetMap = Util.groupBy<Asset, Blockchain>(customAssets, 'blockchain');

    const customBalances = await Promise.all(
      Array.from(assetMap.entries()).map(async ([e, a]) => {
        const client = this.evmRegistryService.getClient(e);
        const balances = await this.getCustomBalances(client, a).then((b) => b.flat());
        return { blockchain: e, balances };
      }),
    );

    // banks
    const olkyBank = await this.bankService.getBankInternal(IbanBankName.OLKY, 'EUR');
    const maerkiEurBank = await this.bankService.getBankInternal(IbanBankName.MAERKI, 'EUR');
    const maerkiChfBank = await this.bankService.getBankInternal(IbanBankName.MAERKI, 'CHF');

    // liq balances
    const liqBalances = await this.liqManagementBalanceService.getAllLiqBalancesForAssets(assets.map((a) => a.id));

    // pending balances
    const pendingExchangeOrders = await this.liquidityManagementPipelineService.getPendingExchangeTx();
    const pendingPayIns = await this.payInService.getPendingPayIns();
    const pendingBuyFiat = await this.buyFiatService.getPendingTransactions();
    const pendingBuyCrypto = await this.buyCryptoService.getPendingTransactions();
    const pendingBankTx = await this.bankTxService.getPendingTx();
    const pendingBankTxRepeat = await this.bankTxRepeatService.getPendingTx();
    const pendingBankTxReturn = await this.bankTxReturnService.getPendingTx();

    // debt balances
    const manualDebtPositions = await this.settingService.getObj<ManualDebtPosition[]>('balanceLogDebtPositions', []);

    // pending internal balances
    // db requests
    const recentBankTxFromOlky = await this.bankTxService.getRecentBankToBankTx(olkyBank.iban, maerkiEurBank.iban);
    const recentKrakenBankTx = await this.bankTxService.getRecentExchangeTx(BankTxType.KRAKEN);
    const recentKrakenExchangeTx = await this.exchangeTxService.getRecentExchangeTx(ExchangeName.KRAKEN, [
      ExchangeTxType.DEPOSIT,
      ExchangeTxType.WITHDRAWAL,
    ]);

    const before14Days = Util.daysBefore(14);
    const before21Days = Util.daysBefore(21);

    before14Days.setHours(0, 0, 0, 0);

    // sender and receiver data
    const { sender: recentChfKrakenMaerkiTx, receiver: recentChfKrakenBankTx } = this.filterSenderPendingList(
      recentKrakenExchangeTx.filter(
        (k) =>
          k.type === ExchangeTxType.WITHDRAWAL &&
          k.method === 'Bank Frick (SIC) International' &&
          k.address === 'Maerki Baumann' &&
          k.created > before21Days,
      ),
      recentKrakenBankTx.filter(
        (b) =>
          b.accountIban === maerkiChfBank.iban &&
          b.creditDebitIndicator === BankTxIndicator.CREDIT &&
          b.created > before14Days,
      ),
    );
    const { sender: recentEurKrakenMaerkiTx, receiver: recentEurKrakenBankTx } = this.filterSenderPendingList(
      recentKrakenExchangeTx.filter(
        (k) =>
          k.type === ExchangeTxType.WITHDRAWAL &&
          k.method === 'Bank Frick (SEPA) International' &&
          k.address === 'Maerki Baumann & Co. AG' &&
          k.created > before21Days,
      ),
      recentKrakenBankTx.filter(
        (b) =>
          b.accountIban === maerkiEurBank.iban &&
          b.creditDebitIndicator === BankTxIndicator.CREDIT &&
          b.created > before14Days,
      ),
    );

    const { sender: recentChfMaerkiKrakenTx, receiver: recentChfBankTxKraken } = this.filterSenderPendingList(
      recentKrakenBankTx.filter(
        (b) =>
          b.accountIban === maerkiChfBank.iban &&
          b.creditDebitIndicator === BankTxIndicator.DEBIT &&
          b.created > before21Days,
      ),
      recentKrakenExchangeTx.filter(
        (k) =>
          k.type === ExchangeTxType.DEPOSIT &&
          k.method === 'Bank Frick (SIC) International' &&
          k.address === 'MAEBCHZZXXX' &&
          k.created > before14Days,
      ),
    );
    const { sender: recentEurMaerkiKrakenTx, receiver: recentEurBankTxKraken } = this.filterSenderPendingList(
      recentKrakenBankTx.filter(
        (b) =>
          b.accountIban === maerkiEurBank.iban &&
          b.creditDebitIndicator === BankTxIndicator.DEBIT &&
          b.created > before21Days,
      ),
      recentKrakenExchangeTx.filter(
        (k) =>
          k.type === ExchangeTxType.DEPOSIT &&
          k.method === 'Bank Frick (SEPA) International' &&
          k.address === 'MAEBCHZZXXX' &&
          k.created > before14Days,
      ),
    );

    // assetLog
    return assets.reduce((prev, curr) => {
      const liquidityBalance = liqBalances.find((b) => b.asset.id === curr.id)?.amount;
      if (liquidityBalance == null && !curr.isActive) return prev;

      const customBalance = customBalances
        .find((c) => c.blockchain === curr.blockchain)
        ?.balances?.reduce((sum, result) => sum + (result.contractAddress === curr.chainId ? result.balance : 0), 0);

      // plus
      const liquidity = (liquidityBalance ?? 0) + (customBalance ?? 0);

      const cryptoInput = pendingPayIns.reduce((sum, tx) => sum + (tx.asset.id === curr.id ? tx.amount : 0), 0);
      const exchangeOrder = pendingExchangeOrders.reduce(
        (sum, tx) => sum + (tx.pipeline.rule.targetAsset.id === curr.id ? tx.amount : 0),
        0,
      );

      // Olky to Maerki
      const pendingOlkyMaerkiAmount = this.getPendingBankAmount(
        [curr],
        recentBankTxFromOlky,
        BankTxType.INTERNAL,
        olkyBank.iban,
        maerkiEurBank.iban,
      );

      // Kraken to Maerki
      const pendingChfKrakenMaerkiPlusAmount = this.getPendingBankAmount(
        [curr],
        recentChfKrakenMaerkiTx,
        ExchangeTxType.WITHDRAWAL,
        maerkiChfBank.iban,
      );
      const pendingEurKrakenMaerkiPlusAmount = this.getPendingBankAmount(
        [curr],
        recentEurKrakenMaerkiTx,
        ExchangeTxType.WITHDRAWAL,
        maerkiEurBank.iban,
      );
      const pendingKrakenMaerkiMinusAmount = this.getPendingBankAmount(
        [curr],
        [...recentEurKrakenBankTx, ...recentChfKrakenBankTx],
        BankTxType.KRAKEN,
      );

      // Maerki to Kraken
      const pendingMaerkiKrakenPlusAmount = this.getPendingBankAmount(
        [curr],
        [...recentChfMaerkiKrakenTx, ...recentEurMaerkiKrakenTx],
        BankTxType.KRAKEN,
      );
      const pendingChfMaerkiKrakenMinusAmount = this.getPendingBankAmount(
        [curr],
        recentChfBankTxKraken,
        ExchangeTxType.DEPOSIT,
        maerkiChfBank.iban,
      );
      const pendingEurMaerkiKrakenMinusAmount = this.getPendingBankAmount(
        [curr],
        recentEurBankTxKraken,
        ExchangeTxType.DEPOSIT,
        maerkiEurBank.iban,
      );

      let fromKraken =
        pendingChfKrakenMaerkiPlusAmount + pendingEurKrakenMaerkiPlusAmount + pendingKrakenMaerkiMinusAmount;
      let toKraken =
        pendingMaerkiKrakenPlusAmount + pendingChfMaerkiKrakenMinusAmount + pendingEurMaerkiKrakenMinusAmount;

      if (fromKraken < 0) {
        this.logger.error(`Error in financial log, fromKraken balance < 0 for asset: ${curr.id}, pendingPlusAmount: 
        ${pendingMaerkiKrakenPlusAmount}, pendingChfMinusAmount: ${pendingChfMaerkiKrakenMinusAmount}, 
        pendingEurMinusAmount: ${pendingEurMaerkiKrakenMinusAmount}`);
        fromKraken = 0;
      }
      if (toKraken < 0) {
        this.logger.error(
          `Error in financial log, toKraken balance < 0 for asset: ${curr.id}, pendingPlusAmount: 
          ${pendingMaerkiKrakenPlusAmount}, pendingChfMinusAmount: ${pendingChfMaerkiKrakenMinusAmount}, 
          pendingEurMinusAmount: ${pendingEurMaerkiKrakenMinusAmount}`,
        );
        toKraken = 0;
      }

      // total pending balance
      const totalPlusPending = cryptoInput + exchangeOrder + pendingOlkyMaerkiAmount + fromKraken + toKraken;
      const totalPlus = liquidity + totalPlusPending;

      // minus
      const manualDebtPosition = manualDebtPositions.find((p) => p.assetId === curr.id)?.value ?? 0;

      const { input: buyFiat, output: buyFiatPass } = this.getPendingAmounts([curr], pendingBuyFiat);
      const { input: buyCrypto, output: buyCryptoPass } = this.getPendingAmounts([curr], pendingBuyCrypto);

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
          total: this.getJsonValue(totalPlus, true),
          liquidity: this.getJsonValue(liquidity),
          pending: totalPlusPending
            ? {
                total: this.getJsonValue(totalPlusPending, true),
                cryptoInput: this.getJsonValue(cryptoInput),
                exchangeOrder: this.getJsonValue(exchangeOrder),
                fromOlky: this.getJsonValue(pendingOlkyMaerkiAmount),
                fromKraken: this.getJsonValue(fromKraken),
                toKraken: this.getJsonValue(toKraken),
              }
            : undefined,
        },
        minusBalance: {
          total: this.getJsonValue(totalMinus, true),
          debt: this.getJsonValue(manualDebtPosition),
          pending: totalMinusPending
            ? {
                total: this.getJsonValue(totalMinusPending, true),
                buyFiat: this.getJsonValue(buyFiat),
                buyFiatPass: this.getJsonValue(buyFiatPass),
                buyCrypto: this.getJsonValue(buyCrypto),
                buyCryptoPass: this.getJsonValue(buyCryptoPass),
                bankTxNull: this.getJsonValue(bankTxNull),
                bankTxPending: this.getJsonValue(bankTxPending),
                bankTxUnknown: this.getJsonValue(bankTxUnknown),
                bankTxGSheet: this.getJsonValue(bankTxGSheet),
                bankTxRepeat: this.getJsonValue(bankTxRepeat),
                bankTxReturn: this.getJsonValue(bankTxReturn),
              }
            : undefined,
        },
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
    const tradingOrders = await this.tradingOrderService.getTradingOrder(firstDayOfMonth);

    const buyFiatFee = this.getFeeAmount(buyFiats.filter((b) => !b.cryptoInput.paymentLinkPayment));
    const paymentLinkFee = this.getFeeAmount(buyFiats.filter((p) => p.cryptoInput.paymentLinkPayment));
    const buyCryptoFee = await this.buyCryptoService.getBuyCrypto(firstDayOfMonth).then((b) => this.getFeeAmount(b));
    const tradingOrderProfits = Util.sumObjValue(tradingOrders, 'profitChf');

    // minus amounts
    const exchangeTx = await this.exchangeTxService.getExchangeTx(firstDayOfMonth);
    const payoutOrders = await this.payoutService.getPayoutOrders(firstDayOfMonth);

    const bankTxFee = await this.bankTxService.getBankTx(firstDayOfMonth).then((b) => this.getFeeAmount(b));
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
    const cryptoInputFee = await this.payInService.getPayIn(firstDayOfMonth).then((c) => this.getFeeAmount(c));
    const tradingOrderFee = this.getFeeAmount(tradingOrders);
    const refRewards = await this.refRewardService.getRefReward(firstDayOfMonth).then((r) => this.getFeeAmount(r));
    const payoutOrderRefFee = this.getFeeAmount(
      payoutOrders.filter((p) => p.context === PayoutOrderContext.REF_PAYOUT),
    );
    const payoutOrderFee = this.getFeeAmount(payoutOrders.filter((p) => p.context !== PayoutOrderContext.REF_PAYOUT));

    const totalKrakenFee = krakenTxWithdrawFee + krakenTxTradingFee;
    const totalBinanceFee = binanceTxWithdrawFee + binanceTxTradingFee;

    const totalRefReward = refRewards + payoutOrderRefFee;
    const totalTxFee = cryptoInputFee + payoutOrderFee;
    const totalBlockchainFee = totalTxFee + tradingOrderFee;

    // total amounts
    const totalPlus = buyCryptoFee + buyFiatFee + paymentLinkFee + tradingOrderProfits;
    const totalMinus = bankTxFee + totalKrakenFee + totalBinanceFee + totalRefReward;

    return {
      plus: {
        total: totalPlus,
        buyCrypto: buyCryptoFee || undefined,
        buyFiat: buyFiatFee || undefined,
        paymentLink: paymentLinkFee || undefined,
        trading: tradingOrderProfits || undefined,
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

  private filterSenderPendingList(
    senderTx: (BankTx | ExchangeTx)[],
    receiverTx: (BankTx | ExchangeTx)[] | undefined,
  ): { receiver: (BankTx | ExchangeTx)[]; sender: (BankTx | ExchangeTx)[] } {
    if (!receiverTx?.length) return { sender: senderTx, receiver: receiverTx };
    let receiverIndex = 0;
    let senderPair = undefined;

    if (senderTx.length > 1)
      senderTx[0] instanceof BankTx ? senderTx.sort((a, b) => a.id - b.id) : senderTx.sort((a, b) => b.id - a.id);
    if (receiverTx.length > 1) receiverTx.sort((a, b) => a.id - b.id);

    do {
      const receiverAmount =
        receiverTx[receiverIndex] instanceof BankTx
          ? (receiverTx[receiverIndex] as BankTx).instructedAmount
          : receiverTx[receiverIndex].amount;

      senderPair = senderTx.find((s) =>
        s instanceof BankTx
          ? s.instructedAmount === receiverAmount &&
            receiverTx[receiverIndex].created.toDateString() === s.valueDate.toDateString() &&
            receiverTx[receiverIndex].created > s.created
          : s.amount === receiverAmount && receiverTx[receiverIndex].created > s.created,
      );

      if (!senderPair) receiverIndex++;
    } while (!senderPair && receiverTx.length > receiverIndex);

    if (senderTx[0] instanceof BankTx) {
      this.logger.verbose(
        `FinanceLog receiverTxId/date: ${receiverTx?.[receiverIndex]?.id}/${receiverTx?.[
          receiverIndex
        ]?.created.toDateString()}; senderTx[0] id/date: ${
          senderTx[0]?.id
        }/${senderTx[0].valueDate.toDateString()}; senderPair id/date: ${senderPair?.id}/${
          senderPair && senderPair instanceof BankTx
            ? senderPair.valueDate.toDateString()
            : senderPair?.created.toDateString()
        }; senderTx length: ${senderTx.length}`,
      );
    }

    return {
      receiver: receiverTx.filter((r) => r.id >= receiverTx[receiverIndex]?.id ?? 0),
      sender: (senderPair ? senderTx.filter((s) => s.id >= senderPair.id) : senderTx).sort((a, b) => a.id - b.id),
    };
  }

  private async getCustomBalances(client: EvmClient, assets: Asset[]): Promise<EvmTokenBalance[][]> {
    return Util.asyncMap(Config.financialLog.customAddresses, (a) => client.getTokenBalances(assets, a));
  }

  private getJsonValue(value: number | undefined, returnZero = false): number | undefined {
    return (!returnZero && !value) || value < 0 ? undefined : value;
  }
}
