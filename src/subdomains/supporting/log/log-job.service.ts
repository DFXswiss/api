import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { BlockchainTokenBalance } from 'src/integration/blockchain/shared/dto/blockchain-token-balance.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
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
import { DisabledProcess, Process, ProcessService } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { AmountType, Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import {
  LiquidityManagementBridges,
  LiquidityManagementExchanges,
} from 'src/subdomains/core/liquidity-management/enums';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { LiquidityManagementPipelineService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-pipeline.service';
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
  LogPairId,
  ManualLogPosition,
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
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly refRewardService: RefRewardService,
    private readonly tradingOrderService: TradingOrderService,
    private readonly payoutService: PayoutService,
    private readonly processService: ProcessService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.TRADING_LOG, timeout: 1800 })
  async saveTradingLog() {
    try {
      // trading log
      const tradingLog = await this.getTradingLog();

      // assets
      const assets = await this.assetService
        .getAllAssets()
        .then((l) => l.filter((a) => ![AssetType.CUSTOM, AssetType.PRESALE].includes(a.type)));

      // asset log
      const assetLog = await this.getAssetLog(assets);

      // balances grouped by financialType
      const balancesByFinancialType = this.getBalancesByFinancialType(assets, assetLog);

      // changes
      const changeLog = await this.getChangeLog();

      // total balances
      const plusBalanceChf = Util.sumObjValue(Object.values(balancesByFinancialType), 'plusBalanceChf');
      const minusBalanceChf = Util.sumObjValue(Object.values(balancesByFinancialType), 'minusBalanceChf');

      const totalBalanceChf = plusBalanceChf - minusBalanceChf;

      // safety module
      const minTotalBalanceChf = await this.settingService.getObj<number>('minTotalBalanceChf', 100000);
      if (!DisabledProcess(Process.SAFETY_MODULE))
        await this.processService.setSafetyModeActive(totalBalanceChf < minTotalBalanceChf);

      await this.logService.create({
        system: 'LogService',
        subsystem: 'FinancialDataLog',
        severity: LogSeverity.INFO,
        message: JSON.stringify({
          assets: assetLog,
          tradings: tradingLog,
          balancesByFinancialType,
          balancesTotal: {
            plusBalanceChf: this.getJsonValue(plusBalanceChf, AmountType.FIAT, true),
            minusBalanceChf: this.getJsonValue(minusBalanceChf, AmountType.FIAT, true),
            totalBalanceChf: this.getJsonValue(totalBalanceChf, AmountType.FIAT, true),
          },
          changes: changeLog,
        }),
        valid: null,
        category: null,
      });
    } catch (e) {
      await this.processService.setSafetyModeActive(true);
      this.logger.error('Error in logJobService financeLog', e);
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

      acc[financialType] = {
        plusBalance: this.getJsonValue(plusBalance, this.financialTypeAmountType(financialType), true),
        plusBalanceChf: this.getJsonValue(plusBalanceChf, AmountType.FIAT, true),
        minusBalance: this.getJsonValue(minusBalance, this.financialTypeAmountType(financialType), true),
        minusBalanceChf: this.getJsonValue(minusBalanceChf, AmountType.FIAT, true),
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
    const customAssetMap = Util.groupBy<Asset, Blockchain>(customAssets, 'blockchain');

    const customBalances = await Promise.all(
      Array.from(customAssetMap.entries()).map(async ([e, a]) => {
        const client = this.blockchainRegistryService.getClient(e);

        const balances = await this.getCustomBalances(client, a, Config.financialLog.customAddresses).then((b) =>
          b.flat(),
        );
        return { blockchain: e, balances };
      }),
    );

    // deposit address balance
    const paymentAssets = assets.filter(
      (a) => a.paymentEnabled && ![Blockchain.LIGHTNING, Blockchain.BITCOIN].includes(a.blockchain),
    );
    const paymentAssetMap = Util.groupBy<Asset, Blockchain>(paymentAssets, 'blockchain');

    const depositBalances = await Promise.all(
      Array.from(paymentAssetMap.entries()).map(async ([e, a]) => {
        const client = this.blockchainRegistryService.getClient(e);

        const balances: BlockchainTokenBalance[] =
          e === Blockchain.MONERO
            ? [{ owner: undefined, contractAddress: undefined, balance: await client.getNativeCoinBalance() }]
            : await this.getCustomBalances(client, a, [
                EvmUtil.createWallet({
                  seed: Config.payment.evmSeed,
                  index: 0,
                }).address,
              ]).then((b) => b.flat());
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
    const pendingOrders = await this.liquidityManagementPipelineService.getPendingTx();

    const pendingExchangeOrders = pendingOrders.filter((o) => LiquidityManagementExchanges.includes(o.action.system));
    const pendingBridgeOrders = pendingOrders.filter(
      (o) => LiquidityManagementBridges.includes(o.action.system) && ['withdraw', 'deposit'].includes(o.action.command),
    );
    const pendingPayIns = await this.payInService.getPendingPayIns();
    const pendingBuyFiat = await this.buyFiatService.getPendingTransactions();
    const pendingBuyCrypto = await this.buyCryptoService.getPendingTransactions();
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
          ],
        )
      : undefined;

    // pending internal balances
    // db requests
    const recentBankTxFromOlky = await this.bankTxService.getRecentBankToBankTx(olkyBank.iban, maerkiEurBank.iban);
    const recentKrakenBankTx = await this.bankTxService.getRecentExchangeTx(minBankTxId, BankTxType.KRAKEN);
    const recentKrakenExchangeTx = await this.exchangeTxService.getRecentExchangeTx(
      minExchangeTxId,
      ExchangeName.KRAKEN,
      [ExchangeTxType.DEPOSIT, ExchangeTxType.WITHDRAWAL],
    );

    // fixed sender and receiver data

    // CHF: Kraken -> Maerki
    const chfSenderExchangeTx = recentKrakenExchangeTx.filter(
      (k) =>
        k.type === ExchangeTxType.WITHDRAWAL &&
        k.method === 'Bank Frick (SIC) International' &&
        k.address === 'Maerki Baumann',
    );
    const chfReceiverBankTx = recentKrakenBankTx.filter(
      (b) => b.accountIban === maerkiChfBank.iban && b.creditDebitIndicator === BankTxIndicator.CREDIT,
    );

    // EUR: Kraken -> Maerki
    const eurSenderExchangeTx = recentKrakenExchangeTx.filter(
      (k) =>
        k.type === ExchangeTxType.WITHDRAWAL &&
        k.method === 'Bank Frick (SEPA) International' &&
        k.address === 'Maerki Baumann & Co. AG',
    );
    const eurReceiverBankTx = recentKrakenBankTx.filter(
      (b) => b.accountIban === maerkiEurBank.iban && b.creditDebitIndicator === BankTxIndicator.CREDIT,
    );

    // CHF: Maerki -> Kraken
    const chfSenderBankTx = recentKrakenBankTx.filter(
      (b) => b.accountIban === maerkiChfBank.iban && b.creditDebitIndicator === BankTxIndicator.DEBIT,
    );
    const chfReceiverExchangeTx = recentKrakenExchangeTx.filter(
      (k) =>
        k.type === ExchangeTxType.DEPOSIT &&
        k.method === 'Bank Frick (SIC) International' &&
        k.address === 'MAEBCHZZXXX',
    );

    // EUR: Maerki -> Kraken
    const eurSenderBankTx = recentKrakenBankTx.filter(
      (b) => b.accountIban === maerkiEurBank.iban && b.creditDebitIndicator === BankTxIndicator.DEBIT,
    );
    const eurReceiverExchangeTx = recentKrakenExchangeTx.filter(
      (k) =>
        k.type === ExchangeTxType.DEPOSIT &&
        k.method === 'Bank Frick (SEPA) International' &&
        k.address === 'MAEBCHZZXXX',
    );

    // sender and receiver data
    const { sender: recentChfKrakenMaerkiTx, receiver: recentChfKrakenBankTx } = this.filterSenderPendingList(
      chfSenderExchangeTx,
      chfReceiverBankTx,
    );
    const { sender: recentEurKrakenMaerkiTx, receiver: recentEurKrakenBankTx } = this.filterSenderPendingList(
      eurSenderExchangeTx,
      eurReceiverBankTx,
    );

    const { sender: recentChfMaerkiKrakenTx, receiver: recentChfBankTxKraken } = this.filterSenderPendingList(
      chfSenderBankTx,
      chfReceiverExchangeTx,
    );
    const { sender: recentEurMaerkiKrakenTx, receiver: recentEurBankTxKraken } = this.filterSenderPendingList(
      eurSenderBankTx,
      eurReceiverExchangeTx,
    );

    // assetLog
    return assets.reduce((prev, curr) => {
      const liquidityBalance = liqBalances.find((b) => b.asset.id === curr.id)?.amount;
      if (liquidityBalance == null && !curr.isActive) return prev;

      const customAddressBalances = customBalances
        .find((c) => c.blockchain === curr.blockchain)
        ?.balances.filter((b) => b.contractAddress === curr.chainId);

      const totalCustomBalance = customAddressBalances && Util.sumObjValue(customAddressBalances, 'balance');

      const depositBalance = depositBalances
        .find((c) => c.blockchain === curr.blockchain)
        ?.balances?.reduce(
          (sum, result) =>
            sum +
            (result.contractAddress === curr.chainId || curr.blockchain === Blockchain.MONERO ? result.balance : 0),
          0,
        );

      const manualLiqPosition = manualLiqPositions.find((p) => p.assetId === curr.id)?.value ?? 0;

      // plus
      const liquidity =
        (liquidityBalance ?? 0) + (totalCustomBalance ?? 0) + (depositBalance ?? 0) + (manualLiqPosition ?? 0);

      const cryptoInput = pendingPayIns.reduce((sum, tx) => sum + (tx.asset.id === curr.id ? tx.amount : 0), 0);
      const exchangeOrder = pendingExchangeOrders.reduce(
        (sum, tx) => sum + (tx.pipeline.rule.targetAsset.id === curr.id ? tx.inputAmount : 0),
        0,
      );
      const bridgeOrder = pendingBridgeOrders.reduce(
        (sum, tx) => sum + (tx.pipeline.rule.targetAsset.id === curr.id ? tx.inputAmount : 0),
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

      // filtered lists
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

      // unfiltered lists
      const pendingChfKrakenMaerkiPlusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        chfSenderExchangeTx.filter((t) => t.id >= financeLogPairIds.fromKraken.chf.exchangeTxId),
        ExchangeTxType.WITHDRAWAL,
        maerkiChfBank.iban,
      );
      const pendingEurKrakenMaerkiPlusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        eurSenderExchangeTx.filter((t) => t.id >= financeLogPairIds.fromKraken.eur.exchangeTxId),
        ExchangeTxType.WITHDRAWAL,
        maerkiEurBank.iban,
      );
      const pendingKrakenMaerkiMinusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        [
          ...eurReceiverBankTx.filter((t) => t.id >= financeLogPairIds.fromKraken.eur.bankTxId),
          ...chfReceiverBankTx.filter((t) => t.id >= financeLogPairIds.fromKraken.chf.bankTxId),
        ],
        BankTxType.KRAKEN,
      );

      // Maerki to Kraken

      // filtered lists
      const pendingMaerkiKrakenPlusAmount = this.getPendingBankAmount(
        [curr],
        [...recentChfMaerkiKrakenTx, ...eurSenderBankTx],
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

      // unfiltered lists
      const pendingMaerkiKrakenPlusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        [
          ...chfSenderBankTx.filter((t) => t.id >= financeLogPairIds.toKraken.chf.bankTxId),
          ...eurSenderBankTx.filter((t) => t.id >= financeLogPairIds.toKraken.eur.bankTxId),
        ],
        BankTxType.KRAKEN,
      );
      const pendingChfMaerkiKrakenMinusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        chfReceiverExchangeTx.filter((t) => t.id >= financeLogPairIds.toKraken.chf.exchangeTxId),
        ExchangeTxType.DEPOSIT,
        maerkiChfBank.iban,
      );
      const pendingEurMaerkiKrakenMinusAmountUnfiltered = this.getPendingBankAmount(
        [curr],
        eurReceiverExchangeTx.filter((t) => t.id >= financeLogPairIds.toKraken.eur.exchangeTxId),
        ExchangeTxType.DEPOSIT,
        maerkiEurBank.iban,
      );

      const fromKrakenUnfiltered =
        pendingChfKrakenMaerkiPlusAmountUnfiltered +
        pendingEurKrakenMaerkiPlusAmountUnfiltered +
        pendingKrakenMaerkiMinusAmountUnfiltered;
      const toKrakenUnfiltered =
        pendingMaerkiKrakenPlusAmountUnfiltered +
        pendingChfMaerkiKrakenMinusAmountUnfiltered +
        pendingEurMaerkiKrakenMinusAmountUnfiltered;

      let fromKraken =
        pendingChfKrakenMaerkiPlusAmount + pendingEurKrakenMaerkiPlusAmount + pendingKrakenMaerkiMinusAmount;
      let toKraken =
        pendingMaerkiKrakenPlusAmount + pendingChfMaerkiKrakenMinusAmount + pendingEurMaerkiKrakenMinusAmount;

      const errors = [];

      if (fromKraken !== fromKrakenUnfiltered) {
        errors.push(`fromKraken !== fromKrakenUnfiltered`);
        this.logger
          .verbose(`Error in financial log, fromKraken balance !== fromKrakenUnfiltered balance for asset: ${curr.id}, fromKrakenAmount: 
        ${fromKraken}, fromKrakenUnfilteredAmount: ${fromKrakenUnfiltered}`);
      }

      if (toKraken !== toKrakenUnfiltered) {
        errors.push(`toKraken !== toKrakenUnfiltered`);
        this.logger
          .verbose(`Error in financial log, toKraken balance !== toKrakenUnfiltered balance for asset: ${curr.id}, toKrakenAmount: 
        ${toKraken}, toKrakenUnfilteredAmount: ${toKrakenUnfiltered}`);
      }

      if (fromKraken < 0) {
        errors.push(`fromKraken < 0`);
        this.logger.verbose(`Error in financial log, fromKraken balance < 0 for asset: ${curr.id}, pendingPlusAmount: 
        ${pendingMaerkiKrakenPlusAmount}, pendingChfMinusAmount: ${pendingChfMaerkiKrakenMinusAmount}, 
        pendingEurMinusAmount: ${pendingEurMaerkiKrakenMinusAmount}`);
        fromKraken = 0;
      }
      if (toKraken < 0) {
        errors.push(`toKraken < 0`);
        this.logger.verbose(
          `Error in financial log, toKraken balance < 0 for asset: ${curr.id}, pendingPlusAmount: 
          ${pendingMaerkiKrakenPlusAmount}, pendingChfMinusAmount: ${pendingChfMaerkiKrakenMinusAmount}, 
          pendingEurMinusAmount: ${pendingEurMaerkiKrakenMinusAmount}`,
        );
        toKraken = 0;
      }

      // total pending balance
      const totalPlusPending =
        cryptoInput +
        exchangeOrder +
        bridgeOrder +
        pendingOlkyMaerkiAmount +
        (useUnfilteredTx ? fromKrakenUnfiltered : fromKraken) +
        (useUnfilteredTx ? toKrakenUnfiltered : toKraken);
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
          total: this.getJsonValue(totalPlus, amountType(curr), true),
          liquidity: this.getJsonValue(liquidity, amountType(curr)),
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
                fromOlky: this.getJsonValue(pendingOlkyMaerkiAmount, amountType(curr)),
                fromKraken: this.getJsonValue(useUnfilteredTx ? fromKrakenUnfiltered : fromKraken, amountType(curr)),
                toKraken: this.getJsonValue(useUnfilteredTx ? toKrakenUnfiltered : toKraken, amountType(curr)),
              }
            : undefined,
          monitoring: errors.length
            ? {
                fromKrakenBankTxIds: this.getTxIdMonitoringLog([...eurReceiverBankTx, ...chfReceiverBankTx]),
                fromKrakenExchangeTxIds: this.getTxIdMonitoringLog([...chfSenderExchangeTx, ...eurSenderExchangeTx]),
                toKrakenBankTxIds: this.getTxIdMonitoringLog([...chfSenderBankTx, ...recentEurMaerkiKrakenTx]),
                toKrakenExchangeTxIds: this.getTxIdMonitoringLog([...chfReceiverExchangeTx, ...eurReceiverExchangeTx]),
              }
            : undefined,
        },
        minusBalance: {
          total: this.getJsonValue(totalMinus, amountType(curr), true),
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
        error: errors.length ? errors.join(';') : undefined,
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
    const { fee: tradingOrderFee, profit: tradingOrderProfit } = await this.tradingOrderService.getTradingOrderYield(
      firstDayOfMonth,
    );

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
    const cryptoInputFee = await this.payInService.getPayInFee(firstDayOfMonth);
    const refRewards = await this.refRewardService.getRefRewardVolume(firstDayOfMonth);
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
    const totalPlus = buyCryptoFee + buyFiatFee + paymentLinkFee + tradingOrderProfit;
    const totalMinus = bankTxFee + totalKrakenFee + totalBinanceFee + totalRefReward;

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

  public filterSenderPendingList(
    senderTx: (BankTx | ExchangeTx)[],
    receiverTx: (BankTx | ExchangeTx)[] | undefined,
  ): { receiver: (BankTx | ExchangeTx)[]; sender: (BankTx | ExchangeTx)[] } {
    const before14Days = Util.daysBefore(14);
    const before21Days = Util.daysBefore(21);

    before14Days.setHours(0, 0, 0, 0);

    let filtered21SenderTx = senderTx.filter((s) => s.created > before21Days);
    let filtered14ReceiverTx = receiverTx.filter((r) => r.created > before14Days);

    if (!filtered21SenderTx.length) return { receiver: [], sender: [] };
    if (!filtered14ReceiverTx?.length) {
      const filtered21ReceiverTx = receiverTx.filter((r) => r.created > before21Days);

      const { receiverIndex: rawReceiverIndex } = this.findSenderReceiverPair(filtered21SenderTx, filtered21ReceiverTx);

      return {
        sender: filtered21SenderTx,
        receiver:
          rawReceiverIndex != null
            ? filtered21ReceiverTx.filter((r) => r.id >= filtered21ReceiverTx[rawReceiverIndex]?.id)
            : filtered14ReceiverTx,
      };
    }

    const { senderPair, receiverIndex } = this.findSenderReceiverPair(filtered21SenderTx, filtered14ReceiverTx);

    if (filtered21SenderTx[0] instanceof BankTx) {
      this.logger.verbose(
        `FinanceLog receiverTxId/date: ${filtered14ReceiverTx?.[receiverIndex]?.id}/${filtered14ReceiverTx?.[
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

    if (filtered14ReceiverTx.length > filtered21SenderTx.length) {
      const { senderPair } = this.findSenderReceiverPair(filtered21SenderTx, filtered14ReceiverTx, true);

      const senderTxLength = senderPair
        ? filtered21SenderTx.filter((s) => s.id <= senderPair.id).length
        : filtered14ReceiverTx.length;

      filtered14ReceiverTx = filtered14ReceiverTx.slice(filtered14ReceiverTx.length - senderTxLength);
    }

    return {
      receiver: filtered14ReceiverTx.filter((r) => r.id >= (filtered14ReceiverTx[receiverIndex]?.id ?? 0)),
      sender: filtered21SenderTx.sort((a, b) => a.id - b.id),
    };
  }

  private findSenderReceiverPair(
    senderTx: (BankTx | ExchangeTx)[],
    receiverTx: (BankTx | ExchangeTx)[] | undefined,
    reverseSearch = false,
  ): { senderPair: BankTx | ExchangeTx; receiverIndex: number } {
    if (!receiverTx.length) return { receiverIndex: undefined, senderPair: undefined };

    (senderTx[0] instanceof BankTx && !reverseSearch) || (!(senderTx[0] instanceof BankTx) && reverseSearch)
      ? senderTx.sort((a, b) => a.id - b.id)
      : senderTx.sort((a, b) => b.id - a.id);

    !reverseSearch ? receiverTx.sort((a, b) => a.id - b.id) : receiverTx.sort((a, b) => b.id - a.id);

    let receiverIndex = 0;

    do {
      const receiverAmount =
        receiverTx[receiverIndex] instanceof BankTx
          ? (receiverTx[receiverIndex] as BankTx).instructedAmount
          : receiverTx[receiverIndex].amount;

      const senderPair = senderTx.find((s) =>
        s instanceof BankTx
          ? s.instructedAmount === receiverAmount &&
            receiverTx[receiverIndex].created.toDateString() === s.valueDate.toDateString() &&
            receiverTx[receiverIndex].created > s.created
          : s.amount === receiverAmount && receiverTx[receiverIndex].created > s.created,
      );

      if (!senderPair) {
        receiverIndex++;
      } else {
        if (reverseSearch) {
          senderTx[0] instanceof BankTx ? senderTx.sort((a, b) => a.id - b.id) : senderTx.sort((a, b) => b.id - a.id);
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

  private getJsonValue(value: number | undefined, amountType: AmountType, returnZero = false): number | undefined {
    return (!returnZero && !value) || value < 0 ? undefined : Util.roundReadable(value, amountType, 8);
  }

  private financialTypeAmountType(financialType: string): AmountType {
    return ['EUR', 'USD', 'CHF'].includes(financialType) ? AmountType.FIAT : AmountType.ASSET;
  }
}
