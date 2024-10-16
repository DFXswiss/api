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
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { LiquidityManagementPipelineService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-pipeline.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { TradingRuleService } from 'src/subdomains/core/trading/services/trading-rule.service';
import { BankTxRepeat } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxRepeatService } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturn } from '../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTxReturnService } from '../bank-tx/bank-tx-return/bank-tx-return.service';
import { BankTx, BankTxIndicator, BankTxType } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from '../bank/bank/bank.service';
import { IbanBankName } from '../bank/bank/dto/bank.dto';
import { PayInService } from '../payin/services/payin.service';
import { LogSeverity } from './log.entity';
import { LogService } from './log.service';

export type BankExchangeType = ExchangeTxType | BankTxType;

type BalancesByFinancialType = {
  [financialType: string]: {
    plusBalance: number;
    plusBalanceChf: number;
    minusBalance: number;
    minusBalanceChf: number;
  };
};

type ManualDebtPosition = {
  assetId: number;
  value: number;
};

@Injectable()
export class LogJobService {
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
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async saveTradingLog() {
    if (DisabledProcess(Process.TRADING_LOG)) return;

    // trading log
    const tradingLog = await this.tradingRuleService.getCurrentTradingOrders().then((t) =>
      t.reduce((prev, curr) => {
        prev[curr.tradingRule.id] = {
          price1: curr.price1,
          price2: curr.price2,
          price3: curr.price3,
        };

        return prev;
      }, {}),
    );

    // assets
    const assets = await this.assetService.getAllAssets().then((l) => l.filter((a) => a.type !== AssetType.CUSTOM));

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
    const pendingExchangeOrders = await this.liquidityManagementPipelineService.getPendingTx();
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

    // receiver data
    const recentEurKrakenBankTx = recentKrakenBankTx.filter(
      (b) =>
        b.accountIban === maerkiEurBank.iban &&
        b.creditDebitIndicator === BankTxIndicator.CREDIT &&
        b.created > Util.daysBefore(14),
    );
    const recentChfKrakenBankTx = recentKrakenBankTx.filter(
      (b) =>
        b.accountIban === maerkiChfBank.iban &&
        b.creditDebitIndicator === BankTxIndicator.CREDIT &&
        b.created > Util.daysBefore(14),
    );
    const recentChfBankTxKraken = recentKrakenExchangeTx.filter(
      (k) =>
        k.type === ExchangeTxType.DEPOSIT &&
        k.method === 'Bank Frick (SIC) International' &&
        k.address === 'MAEBCHZZXXX' &&
        k.created > Util.daysBefore(14),
    );

    // sender data
    const recentKrakenExchangeTxFiltered = [
      ...this.filterSenderPendingList(
        recentKrakenExchangeTx.filter(
          (k) =>
            k.type === ExchangeTxType.WITHDRAWAL &&
            k.method === 'Bank Frick (SEPA) International' &&
            k.address === 'Maerki Baumann & Co. AG' &&
            k.created > Util.daysBefore(21),
        ),
        recentEurKrakenBankTx?.[0],
      ),
      ...this.filterSenderPendingList(
        recentKrakenExchangeTx.filter(
          (k) =>
            k.type === ExchangeTxType.WITHDRAWAL &&
            k.method === 'Bank Frick (SIC) International' &&
            k.address === 'Maerki Baumann' &&
            k.created > Util.daysBefore(21),
        ),
        recentChfKrakenBankTx?.[0],
      ),
    ];
    const recentChfMaerkiKrakenTx = this.filterSenderPendingList(
      recentKrakenBankTx.filter(
        (b) =>
          b.accountIban === maerkiChfBank.iban &&
          b.creditDebitIndicator === BankTxIndicator.DEBIT &&
          b.created > Util.daysBefore(21),
      ),
      recentChfBankTxKraken[0],
    );

    // asset log
    const assetLog = assets.reduce((prev, curr) => {
      const liquidityBalance = liqBalances.find((b) => b.asset.id === curr.id)?.amount;
      if (liquidityBalance == null && !curr.isActive) return prev;

      const customBalance = customBalances
        .find((c) => c.blockchain === curr.blockchain)
        ?.balances?.reduce((sum, result) => (sum + result.contractAddress === curr.chainId ? result.balance : 0), 0);

      // plus
      const liquidity = (liquidityBalance ?? 0) + (customBalance ?? 0);

      const cryptoInput = pendingPayIns.reduce((sum, tx) => (sum + tx.asset.id === curr.id ? tx.amount : 0), 0);
      const exchangeOrder = pendingExchangeOrders.reduce(
        (sum, tx) => (sum + tx.pipeline.rule.targetAsset.id === curr.id ? tx.amount : 0),
        0,
      );

      // Olky to Maerki
      const pendingOlkyMaerkiAmount = this.getPendingBankAmounts(
        [curr],
        recentBankTxFromOlky,
        BankTxType.INTERNAL,
        olkyBank.iban,
        maerkiEurBank.iban,
      );

      // Kraken to Maerki
      const pendingKrakenMaerkiMinusAmount = this.getPendingBankAmounts(
        [curr],
        recentKrakenExchangeTxFiltered,
        ExchangeTxType.WITHDRAWAL,
      );
      const pendingKrakenMaerkiPlusAmount = this.getPendingBankAmounts(
        [curr],
        [...recentEurKrakenBankTx, ...recentChfKrakenBankTx],
        BankTxType.KRAKEN,
      );

      // Maerki to Kraken
      const pendingMaerkiKrakenPlusAmount = this.getPendingBankAmounts(
        [curr],
        recentChfMaerkiKrakenTx,
        BankTxType.KRAKEN,
      );
      const pendingMaerkiKrakenMinusAmount = this.getPendingBankAmounts(
        [curr],
        recentChfBankTxKraken,
        ExchangeTxType.DEPOSIT,
        maerkiChfBank.iban,
      );

      // total pending balance
      const totalPlusPending =
        cryptoInput +
        exchangeOrder +
        pendingOlkyMaerkiAmount +
        pendingKrakenMaerkiMinusAmount +
        pendingKrakenMaerkiPlusAmount +
        pendingMaerkiKrakenPlusAmount +
        pendingMaerkiKrakenMinusAmount;
      const totalPlus = liquidityBalance + totalPlusPending;

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
          total: totalPlus,
          liquidity: liquidity || undefined,
          pending: totalPlusPending
            ? {
                total: totalPlusPending,
                cryptoInput: cryptoInput || undefined,
                exchangeOrder: exchangeOrder || undefined,
                fromOlky: pendingOlkyMaerkiAmount || undefined,
                fromKraken: pendingKrakenMaerkiMinusAmount + pendingKrakenMaerkiPlusAmount || undefined,
                toKraken: pendingMaerkiKrakenPlusAmount + pendingMaerkiKrakenMinusAmount || undefined,
              }
            : undefined,
        },
        minusBalance: {
          total: totalMinus,
          debt: manualDebtPosition || undefined,
          pending: totalMinusPending
            ? {
                total: totalMinusPending,
                buyFiat: buyFiat || undefined,
                buyFiatPass: buyFiatPass || undefined,
                buyCrypto: buyCrypto || undefined,
                buyCryptoPass: buyCryptoPass || undefined,
                bankTxNull: bankTxNull || undefined,
                bankTxPending: bankTxPending || undefined,
                bankTxUnknown: bankTxUnknown || undefined,
                bankTxGSheet: bankTxGSheet || undefined,
                bankTxRepeat: bankTxRepeat || undefined,
                bankTxReturn: bankTxReturn || undefined,
              }
            : undefined,
        },
      };

      return prev;
    }, {});

    const financialTypeMap = Util.groupBy<Asset, string>(
      assets.filter((a) => a.financialType),
      'financialType',
    );

    const balancesByFinancialType: BalancesByFinancialType = Array.from(financialTypeMap.entries()).reduce(
      (acc, [financialType, assets]) => {
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
          plusBalance,
          plusBalanceChf,
          minusBalance,
          minusBalanceChf,
        };

        return acc;
      },
      {},
    );

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
          plusBalanceChf,
          minusBalanceChf,
          totalBalanceChf: plusBalanceChf - minusBalanceChf,
        },
      }),
    });
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

  private getPendingBankAmounts(
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
    receiverTx: BankTx | ExchangeTx | undefined,
  ): (BankTx | ExchangeTx)[] {
    if (!receiverTx) return senderTx;
    const senderPair = senderTx.find(
      (s) =>
        (s instanceof BankTx ? s.instructedAmount : s.amount) ===
        (receiverTx instanceof BankTx ? receiverTx.instructedAmount : receiverTx.amount),
    );
    return senderPair ? senderTx.filter((s) => s.id >= senderPair.id) : senderTx;
  }

  private async getCustomBalances(client: EvmClient, assets: Asset[]): Promise<EvmTokenBalance[][]> {
    return Util.asyncMap(Config.financialLog.customAddresses, (a) => client.getTokenBalances(assets, a));
  }
}
